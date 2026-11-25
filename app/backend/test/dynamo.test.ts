/**
 * The same behaviour as the in-memory tests, against a real DynamoDB engine (DynamoDB Local
 * in Docker): the Table contract, then the project's concurrency properties through the
 * whole stack. This is the evidence that the atomicity arguments in the class comments hold
 * on DynamoDB and not only on the fake.
 *
 * Needs Docker. `npm run test:unit` (SKIP_DYNAMO=1) skips this file.
 */
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { DynamoTable } from '../src/store/DynamoTable';
import type { Table } from '../src/store/Table';
import { makeWorld } from './helpers';
import { describeTableContract } from './tableContract';

const skip = process.env.SKIP_DYNAMO === '1';
let container: StartedTestContainer | undefined;
let client: DynamoDBClient | undefined;
let table: Table;
let run = 0;

beforeAll(async () => {
  if (skip) {
    return;
  }
  container = await new GenericContainer('amazon/dynamodb-local:latest').withExposedPorts(8000).start();
  client = new DynamoDBClient({
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8000)}`,
    region: 'us-west-2',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  // Same key schema as template.yaml.
  await client.send(
    new CreateTableCommand({
      TableName: 'dore-test',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  const documents = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  table = new DynamoTable(documents, 'dore-test', 2); // page size 2, so every query pages
});

afterAll(async () => {
  client?.destroy();
  await container?.stop();
});

describe.skipIf(skip)('on DynamoDB Local', () => {
  describeTableContract('DynamoTable', () => table);

  /** A backend on the shared table; a fresh ID prefix keeps runs apart. */
  const world = () => makeWorld({ table, idPrefix: `d${Date.now()}x${++run}` });

  it('concurrency_createAccountLetsExactlyOneOfManyConcurrentSignupsWin', async () => {
    const { services } = world();
    const address = `race${Date.now()}@example.com`;
    const ids = await Promise.all(Array.from({ length: 16 }, () => services.accountModel.createAccount(address, 'pw')));
    expect(ids.filter((id) => id !== undefined)).toHaveLength(1);
  });

  it('concurrency_R_HOME_23_manyConcurrentConfirmationsYieldExactlyOneChat', async () => {
    const w = world();
    const me = await w.join(`me${Date.now()}@example.com`);
    const you = await w.join(`you${Date.now()}@example.com`);
    const taste = new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.5));
    await w.services.matchModel.updateUser(me.userId, taste, w.clock.now);
    await w.services.matchModel.updateUser(you.userId, taste, w.clock.now);
    // other runs share the table's POOL partition, so look the match up rather than assume it
    let match = await w.services.matchModel.findMatch(me.userId, w.clock.now);
    while (match !== undefined && match.userA !== you.userId && match.userB !== you.userId) {
      match = await w.services.matchModel.findMatch(me.userId, w.clock.now);
    }
    expect(match).toBeDefined();
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, i) => w.services.matches.confirmMatch(match!.matchId, i % 2 === 0 ? me.userId : you.userId)),
    );
    expect(new Set(results.filter((id) => id !== undefined)).size).toBe(1);
    expect(await w.services.chats.getChatLog(me.userId)).toHaveLength(1);
    expect(await w.services.chats.getChatLog(you.userId)).toHaveLength(1);
    expect(await w.services.matchModel.isMutual(match!.matchId)).toBe(true);
  });

  it('concurrency_concurrentMessagesFromBothUsersAreAllStoredInOrder', async () => {
    const w = world();
    const [amy, bob] = [w.random.id(), w.random.id()];
    const chatIds = await Promise.all([w.services.chats.openChat(amy, bob), w.services.chats.openChat(bob, amy)]);
    expect(chatIds[0]).toBe(chatIds[1]);
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        w.services.chatModel.addMessage(chatIds[0]!, { senderId: i % 2 ? amy : bob, text: `m${i}`, timestamp: w.clock.now + ((i * 5) % 24) }),
      ),
    );
    const { messages } = await w.services.chats.getChat(chatIds[0]!, amy);
    expect(messages.map((m) => m.seq)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(new Set(messages.map((m) => m.text)).size).toBe(24);
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i]!.timestamp).toBeGreaterThanOrEqual(messages[i - 1]!.timestamp);
    }
    const cut = messages[19]!.timestamp;
    const later = (await w.services.chats.getChat(chatIds[0]!, bob, cut)).messages;
    expect(later.map((m) => m.seq)).toEqual(messages.filter((m) => m.timestamp > cut).map((m) => m.seq));
  });

  it('concurrency_aSwipeSentSeveralTimesCountsOnce', async () => {
    const w = world();
    const user = w.random.id();
    const current = await w.services.songs.getCurrentSong(user);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => w.services.songs.submitFeedback(user, current.id, 'LIKE', 20)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await w.services.tasteModel.getRecentSongs(user)).toHaveLength(1);
  });

  // The whole user journey through the HTTP layer, on DynamoDB.
  it('endToEnd_signUpVerifyLogInSwipeAndChat', async () => {
    const w = world();
    const amy = await w.join(`amy${Date.now()}@example.com`);
    const bob = await w.join(`bob${Date.now()}@example.com`);
    const picture = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    expect((await w.call('PUT', '/api/users/me/picture', { token: amy.token, raw: picture })).status).toBe(204);
    const profile = (await w.call('GET', '/api/users/me', { token: amy.token })).body as { profilePictureUrl: string };
    expect(w.pictures.saved.get(profile.profilePictureUrl)!.type).toBe('image/jpeg');

    const current = (await w.call('GET', '/api/songs/current', { token: amy.token })).body as { id: string };
    const swipe = { swipe: 'LIKE', secondsListened: 10 };
    expect((await w.call('POST', `/api/songs/${current.id}/feedback`, { token: amy.token, body: swipe })).status).toBe(200);
    const undone = (await w.call('POST', '/api/songs/undo', { token: amy.token, body: {} })).body;
    expect(undone).toMatchObject({ song: { id: current.id }, liked: false, canUndo: false });
    expect(((await w.call('GET', '/api/songs/taste', { token: amy.token })).body as { taste: number[] }).taste).toEqual(
      new Array(FEATURE_COUNT).fill(0.5),
    );

    const chatId = await w.services.chats.openChat(amy.userId, bob.userId);
    expect((await w.call('POST', `/api/chats/${chatId}/messages`, { token: amy.token, body: { text: 'hello' } })).status).toBe(201);
    const history = await w.call('GET', `/api/chats/${chatId}/messages`, { token: bob.token });
    expect(history.body).toMatchObject({ otherUserOnline: true, messages: [{ messageId: '1', text: 'hello' }] });
    expect((await w.call('POST', `/api/chats/${chatId}/report`, { token: bob.token, body: {} })).status).toBe(204);
    expect(await w.services.chatModel.isFlagged(chatId)).toBe(true);
  });
});
