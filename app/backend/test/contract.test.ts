/**
 * Contract test: the frontend's real HTTP client (frontend/src/api/httpApi.ts, the code the
 * app runs once VITE_API_BASE_URL is set) driving this backend through docs/project/api.md.
 * Only the network is replaced: `fetch` hands each request straight to createApi. If the
 * client and server disagree on a path, method, body or response shape, these tests fail.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../frontend/src/api/apiErrors';
import type { Api } from '../../frontend/src/api/client';
import { createHttpApi } from '../../frontend/src/api/httpApi';
import { createApi } from '../src/http/api';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { linkIn, makeWorld, type World } from './helpers';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A frontend Api whose fetch calls the backend in-process. */
function clientFor(world: World): { api: Api; setToken(token: string | null): void; unauthorized: () => number } {
  const backend = createApi(world.services, () => undefined);
  let token: string | null = null;
  let unauthorized = 0;
  const fetchFn = (async (input: unknown, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]));
    let body: Uint8Array | undefined;
    if (typeof init.body === 'string') {
      body = new TextEncoder().encode(init.body);
    } else if (init.body !== undefined) {
      body = new Uint8Array(await (init.body as Blob).arrayBuffer());
    }
    const response = await backend({
      method: init.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), { status: response.status });
  }) as unknown as typeof fetch;
  const api = createHttpApi({
    baseUrl: 'https://app.example/api/',
    getToken: () => token,
    onUnauthorized: () => void unauthorized++,
    fetchFn,
  });
  return { api, setToken: (value) => void (token = value), unauthorized: () => unauthorized };
}

/** Signs a user up, verifies and logs in, all through the frontend client. */
async function join(world: World, email: string) {
  const client = clientFor(world);
  expect(await client.api.account.createAccount(email, 'pw-12345', 'pw-12345')).toBe('PENDING_VERIFICATION');
  const link = linkIn(world.email.sent.findLast((message) => message.to === email)!);
  expect(await client.api.account.confirmEmail(link.userId, link.token)).toBe(true);
  const login = await client.api.account.login(email, 'pw-12345');
  if (login.result !== 'SUCCESS') {
    throw new Error(`login failed: ${login.result}`);
  }
  client.setToken(login.token);
  return { ...client, userId: login.userId };
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error) => (error instanceof ApiError ? error.code : `not an ApiError: ${error}`),
  );

describe('frontend client against the backend: accounts', () => {
  it('R_ACC_01_R_ACC_02_R_ACC_08_R_SEC_01_R_SEC_02_R_SEC_03_signUpVerifyAndLogIn', async () => {
    const world = makeWorld();
    const { api } = clientFor(world);
    expect(await api.account.createAccount('nope', 'long-enough', 'long-enough')).toBe('INVALID_EMAIL');
    expect(await codeOf(api.account.createAccount('ada@example.com', 'short', 'short'))).toBe('BAD_REQUEST'); // under 8 characters
    expect(await api.account.createAccount('ada@example.com', 'long-enough', 'different')).toBe('PASSWORDS_DO_NOT_MATCH');
    expect(await api.account.createAccount('ada@example.com', 'right-pw', 'right-pw')).toBe('PENDING_VERIFICATION');
    expect(await api.account.createAccount('ada@example.com', 'right-pw', 'right-pw')).toBe('EMAIL_IN_USE');

    // the popup's poll, before and after the link is opened
    expect(await api.account.isVerified('ada@example.com')).toBe(false);
    expect(await api.account.isVerified('nobody@example.com')).toBe(false);
    expect(await api.account.login('ada@example.com', 'right-pw')).toEqual({ result: 'NOT_VERIFIED' });
    const link = linkIn(world.email.sent[0]!);
    expect(world.email.sent[0]!.text).toContain('https://app.example/verify?userId='); // the /verify page's URL
    expect(await api.account.confirmEmail(link.userId, 'wrong')).toBe(false);
    expect(await api.account.confirmEmail(link.userId, link.token)).toBe(true);
    expect(await api.account.isVerified('ada@example.com')).toBe(true);

    expect(await api.account.login('ada@example.com', 'wrong')).toEqual({ result: 'WRONG_PASSWORD' });
    // an unknown email looks exactly like a wrong password (OPEN-16)
    expect(await api.account.login('nobody@example.com', 'right-pw')).toEqual({ result: 'WRONG_PASSWORD' });
    const login = await api.account.login('ada@example.com', 'right-pw');
    expect(login).toEqual({ result: 'SUCCESS', userId: link.userId, token: expect.any(String) });
  });

  it('R_ACC_09_profilesUsernamesAndPictures', async () => {
    const world = makeWorld();
    const ada = await join(world, 'ada@example.com');
    expect(await ada.api.account.getProfile(ada.userId)).toEqual({ userId: ada.userId, username: '', profilePictureUrl: null, isAdmin: false });
    await ada.api.account.updateUsername(ada.userId, 'Ada');
    await ada.api.account.updateProfilePicture(ada.userId, new Blob([JPEG], { type: 'image/jpeg' }));
    const profile = await ada.api.account.getProfile(ada.userId);
    expect(profile.username).toBe('Ada');
    expect(world.pictures.saved.get(profile.profilePictureUrl!)).toEqual({ bytes: JPEG, type: 'image/jpeg' });

    expect(await codeOf(ada.api.account.updateUsername(ada.userId, ''))).toBe('BAD_REQUEST');
    const tooBig = new Blob([JPEG, new Uint8Array(4 * 1024 * 1024)], { type: 'image/jpeg' });
    expect(await codeOf(ada.api.account.updateProfilePicture(ada.userId, tooBig))).toBe('PICTURE_TOO_LARGE');
    const notImage = new Blob(['hello'], { type: 'image/png' }); // the claimed type is not trusted
    expect(await codeOf(ada.api.account.updateProfilePicture(ada.userId, notImage))).toBe('BAD_REQUEST');
  });

  it('security_anEndedSessionSendsTheClientBackToLogin', async () => {
    const world = makeWorld();
    const ada = await join(world, 'ada@example.com');
    ada.setToken('forged-token');
    expect(await codeOf(ada.api.songs.getCurrentSong(ada.userId))).toBe('UNAUTHENTICATED');
    expect(ada.unauthorized()).toBe(1);
  });
});

describe('frontend client against the backend: songs', () => {
  it('R_HOME_03_R_HOME_15_R_HOME_17_R_HOME_25_currentSongLikeSwipeUndoAndTaste', async () => {
    const world = makeWorld({ librarySize: 21 });
    const ada = await join(world, 'ada@example.com');
    const { songs } = ada.api;

    const first = await songs.getCurrentSong(ada.userId);
    expect(first.features).toHaveLength(FEATURE_COUNT);
    expect(first.spotifyUri).toBe(`spotify:track:${first.id}`);
    expect(await songs.getCurrentSong(ada.userId)).toEqual(first);
    expect(await songs.getTasteVector(ada.userId)).toEqual(new Array(FEATURE_COUNT).fill(0.5));
    expect(await songs.canUndo(ada.userId)).toBe(false);
    expect(await songs.undoLastSwipe(ada.userId)).toBeNull();

    await songs.markLiked(ada.userId, first.id);
    expect(await songs.getCurrentSong(ada.userId)).toEqual(first); // the same song keeps playing
    const swipe = await songs.submitFeedback(ada.userId, first.id, 'SKIP', 12.5);
    expect(swipe.nextSong.id).not.toBe(first.id);
    expect(swipe.offeredMatch).toBeNull();
    expect(await codeOf(songs.submitFeedback(ada.userId, first.id, 'SKIP', 12.5))).toBe('SONG_NOT_ACTIVE');
    expect(await codeOf(songs.markLiked(ada.userId, first.id))).toBe('SONG_NOT_ACTIVE');

    const second = await songs.submitFeedback(ada.userId, swipe.nextSong.id, 'LIKE', 30);
    expect(await songs.getTasteVector(ada.userId)).not.toEqual(new Array(FEATURE_COUNT).fill(0.5));
    expect(await songs.canUndo(ada.userId)).toBe(true);
    expect(await songs.undoLastSwipe(ada.userId)).toEqual({ song: swipe.nextSong, liked: false, canUndo: true });
    expect(await songs.undoLastSwipe(ada.userId)).toEqual({ song: first, liked: true, canUndo: false });
    expect(await songs.getTasteVector(ada.userId)).toEqual(new Array(FEATURE_COUNT).fill(0.5));
    expect(await songs.getCurrentSong(ada.userId)).toEqual(first);
    expect(second.nextSong.id).not.toBe(first.id);
  });
});

describe('frontend client against the backend: matches and chat', () => {
  async function matched() {
    const world = makeWorld();
    const amy = await join(world, 'amy@example.com');
    const bob = await join(world, 'bob@example.com');
    const eve = await join(world, 'eve@example.com');
    await bob.api.account.updateUsername(bob.userId, 'Bob');
    const taste = new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.4));
    await world.services.matchModel.updateUser(amy.userId, taste, world.clock.now);
    await world.services.matchModel.updateUser(bob.userId, taste, world.clock.now);
    const match = (await world.services.matchModel.findMatch(amy.userId, world.clock.now))!;
    return { world, amy, bob, eve, match };
  }

  it('R_HOME_19_aSwipeCanReturnAnOfferedMatch', async () => {
    const world = makeWorld();
    const amy = await join(world, 'amy@example.com');
    const bob = await join(world, 'bob@example.com');
    await world.services.matchModel.updateUser(bob.userId, TasteVector.neutral(), world.clock.now);
    let offered = null;
    for (let swipes = 0; swipes < 30 && offered === null; swipes++) {
      const current = await amy.api.songs.getCurrentSong(amy.userId);
      offered = (await amy.api.songs.submitFeedback(amy.userId, current.id, 'LIKE', 20)).offeredMatch;
    }
    expect(offered).toMatchObject({ matchId: expect.any(String), compatibilityPercent: expect.any(Number) });
    expect(await bob.api.matches.getPendingMatches(bob.userId)).toEqual([offered]); // R-HOME-20
  });

  it('R_HOME_20_R_HOME_21_R_HOME_23_bothUsersSeeTheMatchConfirmAndGetOneChat', async () => {
    const { amy, bob, eve, match } = await matched();
    expect(await amy.api.matches.getPendingMatches(amy.userId)).toEqual([match]);
    expect(await bob.api.matches.getMatch(match.matchId, bob.userId)).toEqual(match);
    expect(await eve.api.matches.getMatch(match.matchId, eve.userId)).toBeNull();
    expect(await amy.api.matches.getMatch('no_such', amy.userId)).toBeNull();
    expect(await amy.api.matches.getOtherProfile(match, amy.userId)).toEqual({
      userId: bob.userId,
      username: 'Bob',
      profilePictureUrl: null,
    });
    expect(await codeOf(eve.api.matches.getOtherProfile(match, eve.userId))).toBe('NOT_PARTICIPANT');
    expect(await codeOf(eve.api.matches.confirmMatch(match, eve.userId))).toBe('NOT_PARTICIPANT');

    expect(await amy.api.matches.confirmMatch(match, amy.userId)).toBeNull(); // OPEN-4
    expect(await amy.api.matches.getMatch(match.matchId, amy.userId)).toBeNull(); // answered: the link is dead
    const chatId = await bob.api.matches.confirmMatch(match, bob.userId);
    expect(chatId).toEqual(expect.any(String));
    expect(await amy.api.matches.confirmMatch(match, amy.userId)).toBe(chatId);
    expect((await amy.api.chats.getChatLog(amy.userId)).map((chat) => chat.chatId)).toEqual([chatId]);
  });

  it('R_HOME_21_R_HOME_22_aYesStillWaitingIsListedAndCanBeTakenBack', async () => {
    const { amy, bob, match } = await matched();
    expect(await amy.api.matches.getOutgoingMatches(amy.userId)).toEqual([]);
    await amy.api.matches.confirmMatch(match, amy.userId);
    expect(await amy.api.matches.getOutgoingMatches(amy.userId)).toEqual([
      { match, otherUser: { userId: bob.userId, username: 'Bob', profilePictureUrl: null } },
    ]);
    expect(await bob.api.matches.getOutgoingMatches(bob.userId)).toEqual([]);
    await amy.api.matches.retractMatch(match, amy.userId);
    expect(await amy.api.matches.getOutgoingMatches(amy.userId)).toEqual([]);
    expect(await bob.api.matches.getPendingMatches(bob.userId)).toEqual([]);
    expect(await bob.api.matches.confirmMatch(match, bob.userId)).toBeNull();
    // the client sees a refusal as an ApiError with status 409
    const refused = await amy.api.matches.retractMatch(match, amy.userId).catch((error) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(409);
  });

  it('R_HOME_21_R_HOME_22_aDeclineIsFinal', async () => {
    const { amy, bob, match } = await matched();
    await amy.api.matches.declineMatch(match, amy.userId);
    expect(await bob.api.matches.getPendingMatches(bob.userId)).toEqual([]);
    expect(await bob.api.matches.confirmMatch(match, bob.userId)).toBeNull();
    expect(await bob.api.chats.getChatLog(bob.userId)).toEqual([]);
  });

  it('R_CHAT_01_R_CHAT_02_R_CHAT_06_R_CHAT_13_chatLogHistoryPollingAndPresence', async () => {
    const { world, amy, bob, eve } = await matched();
    const chatId = await world.services.chats.openChat(amy.userId, bob.userId);
    const created = new Date(world.clock.now).toISOString();
    expect(await amy.api.chats.getChatLog(amy.userId)).toEqual([
      {
        chatId,
        otherUser: { userId: bob.userId, username: 'Bob', profilePictureUrl: null },
        lastMessage: null,
        lastActivityAt: created,
      },
    ]);

    world.clock.advance(1000);
    const sent = await amy.api.chats.sendMessage(chatId, amy.userId, '  hi Bob  ');
    expect(sent).toEqual({
      messageId: '1',
      senderId: amy.userId,
      text: 'hi Bob',
      timestamp: new Date(world.clock.now).toISOString(), // set by the server
    });
    expect(await codeOf(amy.api.chats.sendMessage(chatId, amy.userId, '   '))).toBe('EMPTY_MESSAGE');
    expect(await codeOf(amy.api.chats.sendMessage(chatId, amy.userId, 'x'.repeat(2001)))).toBe('MESSAGE_TOO_LONG');

    // Bob opens the chat: full history, and Amy is online because her requests were heartbeats
    const opened = await bob.api.chats.getHistory(chatId, bob.userId);
    expect(opened).toEqual({
      chatId,
      otherUser: { userId: amy.userId, username: '', profilePictureUrl: null },
      otherUserOnline: true,
      messages: [sent],
      serverTime: new Date(world.clock.now).toISOString(),
    });
    expect((await bob.api.chats.getChatLog(bob.userId))[0]).toMatchObject({ lastMessage: sent, lastActivityAt: sent.timestamp });

    // the 3 s poll: `since` = previous serverTime minus 5 s returns the overlap, a later one only new messages
    world.clock.advance(3000);
    const reply = await bob.api.chats.sendMessage(chatId, bob.userId, 'hi Amy');
    const overlap = new Date(Date.parse(opened.serverTime) - 5000).toISOString();
    expect((await amy.api.chats.getHistory(chatId, amy.userId, overlap)).messages).toEqual([sent, reply]);
    expect((await amy.api.chats.getHistory(chatId, amy.userId, sent.timestamp)).messages).toEqual([reply]);
    expect((await amy.api.chats.getHistory(chatId, amy.userId, reply.timestamp)).messages).toEqual([]);
    expect(await codeOf(amy.api.chats.getHistory(chatId, amy.userId, 'yesterday'))).toBe('BAD_REQUEST');

    // presence lapses 30 s after the last request; the app-wide heartbeat brings it back
    world.clock.advance(31_000);
    expect((await amy.api.chats.getHistory(chatId, amy.userId)).otherUserOnline).toBe(false);
    await bob.api.chats.recordHeartbeat(bob.userId);
    expect((await amy.api.chats.getHistory(chatId, amy.userId)).otherUserOnline).toBe(true);

    expect(await codeOf(eve.api.chats.getHistory(chatId, eve.userId))).toBe('NOT_PARTICIPANT');
    expect(await codeOf(eve.api.chats.sendMessage(chatId, eve.userId, 'hi'))).toBe('NOT_PARTICIPANT');
    expect(await codeOf(amy.api.chats.getHistory('no_chat', amy.userId))).toBe('CHAT_NOT_FOUND');
  });

  it('R_CHAT_15_R_CHAT_16_reportingAndRemovingChats', async () => {
    const { world, amy, bob } = await matched();
    const chatId = await world.services.chats.openChat(amy.userId, bob.userId);
    await amy.api.chats.reportChat(amy.userId, chatId);
    await amy.api.chats.reportChat(amy.userId, chatId); // idempotent
    expect(await world.services.chatModel.isFlagged(chatId)).toBe(true);
    expect(await amy.api.chats.getChatLog(amy.userId)).toEqual([]);
    expect(await codeOf(amy.api.chats.getHistory(chatId, amy.userId))).toBe('CHAT_NOT_FOUND'); // api.md Q-9
    expect(await codeOf(amy.api.chats.sendMessage(chatId, amy.userId, 'hello?'))).toBe('CHAT_NOT_FOUND');

    expect(await bob.api.chats.getChatLog(bob.userId)).toHaveLength(1); // the other user is unaffected
    await bob.api.chats.removeChatFromLog(bob.userId, chatId);
    await bob.api.chats.removeChatFromLog(bob.userId, chatId); // idempotent
    expect(await bob.api.chats.getChatLog(bob.userId)).toEqual([]);
  });
});

describe('frontend client against the backend: push notifications', () => {
  it('getsTheKeySavesAndRemovesASubscription', async () => {
    const world = makeWorld();
    const ada = await join(world, 'ada@example.com');
    expect(await ada.api.push.getPublicKey()).toBe('BTestVapidPublicKey');
    const subscription = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc',
      keys: { p256dh: `B${'k'.repeat(86)}`, auth: 'a'.repeat(22) },
    };
    await ada.api.push.saveSubscription(subscription);
    expect(await world.services.subscriptions.list(ada.userId)).toEqual([subscription]);
    await ada.api.push.removeSubscription(subscription.endpoint);
    expect(await world.services.subscriptions.list(ada.userId)).toEqual([]);
    expect(await codeOf(ada.api.push.saveSubscription({ ...subscription, endpoint: 'https://evil.example/x' }))).toBe('BAD_REQUEST');
  });
});

describe('frontend client against the backend: reports and the admin panel (OPEN-18)', () => {
  it('reportsAProfileThenAnAdminReviewsSuspendsAndResolves', async () => {
    const world = makeWorld(); // root admin: root@example.com
    const root = await join(world, 'root@example.com');
    const amy = await join(world, 'amy@example.com');
    const bob = await join(world, 'bob@example.com');
    const taste = new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.4));
    await world.services.matchModel.updateUser(amy.userId, taste, world.clock.now);
    await world.services.matchModel.updateUser(bob.userId, taste, world.clock.now);
    const match = (await world.services.matchModel.findMatch(amy.userId, world.clock.now))!;

    // the client learns who is an admin from its own profile
    expect((await root.api.account.getProfile(root.userId)).isAdmin).toBe(true);
    expect((await amy.api.account.getProfile(amy.userId)).isAdmin).toBe(false);
    expect(await codeOf(amy.api.admin.listUsers(amy.userId))).toBe('NOT_ADMIN');

    await amy.api.matches.reportProfile(match, amy.userId, 'FAKE_ACCOUNT', 'stock photo');
    expect(await bob.api.matches.getPendingMatches(bob.userId)).toEqual([]); // the match was declined

    const reports = await root.api.admin.listReports(root.userId);
    expect(reports).toMatchObject([
      { reason: 'FAKE_ACCOUNT', details: 'stock photo', source: 'MATCH', resolved: null, reporter: { email: 'amy@example.com' }, reported: { email: 'bob@example.com' } },
    ]);
    const users = await root.api.admin.listUsers(root.userId);
    expect(users.map((u) => u.email)).toEqual(['root@example.com', 'amy@example.com', 'bob@example.com']);
    expect(users.find((u) => u.userId === bob.userId)).toMatchObject({ openReports: 1, active: true, admin: false, rootAdmin: false, suspended: null });
    expect(users[0]).toMatchObject({ rootAdmin: true });

    await root.api.admin.suspend(root.userId, bob.userId, 'fake account');
    expect(await codeOf(bob.api.songs.getCurrentSong(bob.userId))).toBe('UNAUTHENTICATED'); // logged out at once
    expect(await bob.api.account.login('bob@example.com', 'pw-12345')).toEqual({ result: 'SUSPENDED' });
    await root.api.admin.resolveReport(root.userId, reports[0]!.reportId, 'suspended');
    expect((await root.api.admin.listReports(root.userId))[0]!.resolved).toMatchObject({ by: root.userId, note: 'suspended' });

    await root.api.admin.unsuspend(root.userId, bob.userId);
    expect((await bob.api.account.login('bob@example.com', 'pw-12345')).result).toBe('SUCCESS');
    await root.api.admin.setAdmin(root.userId, amy.userId, true);
    expect((await amy.api.admin.listUsers(amy.userId)).find((u) => u.userId === amy.userId)!.admin).toBe(true);
    expect(await codeOf(amy.api.admin.suspend(amy.userId, root.userId, 'x'))).toBe('BAD_REQUEST'); // root admins are protected

    await amy.api.account.createAccount('new@example.com', 'new-pw-123', 'new-pw-123');
    const fresh = (await amy.api.admin.listUsers(amy.userId)).find((u) => u.email === 'new@example.com')!;
    expect(fresh.active).toBe(false);
    await amy.api.admin.verify(amy.userId, fresh.userId);
    expect((await amy.api.account.login('new@example.com', 'new-pw-123')).result).toBe('SUCCESS');

    const log = await root.api.admin.auditLog(root.userId);
    expect(log.map((e) => e.action)).toEqual(['VERIFY', 'GRANT_ADMIN', 'UNSUSPEND', 'RESOLVE_REPORT', 'SUSPEND']);
  });
});

