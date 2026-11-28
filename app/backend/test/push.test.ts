import { describe, expect, it } from 'vitest';
import { parseEvent, PREVIEW_LENGTH, previewOf, type NotificationEvent } from '../src/notify/events';
import { WebPushSender } from '../src/notify/Notifier';
import { InProcessPublisher, snsHandler, SnsPublisher } from '../src/notify/publishers';
import { isPushEndpoint, PushSubscriptionModel } from '../src/notify/PushSubscriptionModel';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { buildNotifier } from '../src/services';
import { browser, makeWorld, RecordingPublisher, RecordingSender, statusOf } from './helpers';

const message: NotificationEvent = { type: 'MESSAGE', toUserId: 'b', fromUserId: 'a', chatId: 'a_b', preview: 'hi' };

describe('notification events', () => {
  // spec: parseEvent returns the event, or undefined for anything that is not one
  it('parses valid events and rejects everything else', () => {
    const offered = { type: 'MATCH_OFFERED', toUserId: 'b', fromUserId: 'a', matchId: 'a_b' };
    const completed = { type: 'MATCH_COMPLETED', toUserId: 'b', fromUserId: 'a', chatId: 'a_b' };
    for (const event of [offered, completed, message]) {
      expect(parseEvent(JSON.stringify(event))).toEqual(event);
    }
    expect(parseEvent('')).toBeUndefined();
    expect(parseEvent('{not json')).toBeUndefined();
    expect(parseEvent('"text"')).toBeUndefined();
    expect(parseEvent(JSON.stringify({ ...message, type: 'OTHER' }))).toBeUndefined();
    expect(parseEvent(JSON.stringify({ ...message, toUserId: '' }))).toBeUndefined();
    expect(parseEvent(JSON.stringify({ type: 'MATCH_OFFERED', toUserId: 'b', fromUserId: 'a' }))).toBeUndefined();
    expect(parseEvent(JSON.stringify({ ...message, preview: 'x'.repeat(PREVIEW_LENGTH + 2) }))).toBeUndefined();
  });

  // boundary: PREVIEW_LENGTH characters are kept whole; one more is cut
  it('previewOf cuts long messages at PREVIEW_LENGTH', () => {
    expect(previewOf('short')).toBe('short');
    expect(previewOf('x'.repeat(PREVIEW_LENGTH))).toBe('x'.repeat(PREVIEW_LENGTH));
    expect(previewOf('x'.repeat(PREVIEW_LENGTH + 1))).toBe(`${'x'.repeat(PREVIEW_LENGTH)}…`);
    expect(parseEvent(JSON.stringify({ ...message, preview: previewOf('x'.repeat(500)) }))).toBeDefined();
  });
});

describe('PushSubscriptionModel', () => {
  // spec: partitions of isPushEndpoint
  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://jmt17.google.com/fcm/send/abc', true],
    ['https://google.com.evil.example/fcm/send/abc', false],
    ['https://notgoogle.com/fcm/send/abc', false],
    ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['https://wns2-by3p.notify.windows.com/w/?token=abc', true],
    ['https://web.push.apple.com/abc', true],
    ['http://fcm.googleapis.com/fcm/send/abc', false], // not https
    ['https://fcm.googleapis.com.evil.example/x', false],
    ['https://evil.example/fcm.googleapis.com', false],
    ['https://169.254.169.254/latest/meta-data', false], // the reason for the allow-list
    ['https://user:pw@fcm.googleapis.com/x', false],
    ['https://fcm.googleapis.com:8443/x', false],
    [`https://fcm.googleapis.com/${'x'.repeat(1000)}`, false],
    ['not a url', false],
  ])('security_isPushEndpoint(%s) is %s', (endpoint, expected) => {
    expect(isPushEndpoint(endpoint)).toBe(expected);
  });

  it('saves, lists and removes a user\'s browsers', async () => {
    const { services, clock } = makeWorld();
    const model = services.subscriptions;
    expect(await model.list('u')).toEqual([]);
    await model.save('u', browser(1));
    clock.advance(1000);
    await model.save('u', browser(2));
    await model.save('u', browser(1)); // saving again keeps one copy
    expect((await model.list('u')).map((s) => s.endpoint).sort()).toEqual([browser(1).endpoint, browser(2).endpoint]);
    expect(await model.list('u')).toContainEqual(browser(2));
    await model.remove('u', browser(1).endpoint);
    await model.remove('u', browser(1).endpoint); // removing twice is harmless
    expect(await model.list('u')).toEqual([browser(2)]);
    expect(await model.list('other')).toEqual([]);
  });

  // spec: Requires a real browser subscription -> 400
  it('security_rejectsEndpointsAndKeysThatAreNotABrowserSubscription', async () => {
    const model = makeWorld().services.subscriptions;
    expect(await statusOf(model.save('u', { ...browser(1), endpoint: 'https://evil.example/hook' }))).toBe(400);
    expect(await statusOf(model.save('u', { ...browser(1), keys: { ...browser(1).keys, p256dh: 'short' } }))).toBe(400);
    expect(await statusOf(model.save('u', { ...browser(1), keys: { ...browser(1).keys, auth: 'not base64url!!!!!!!!' } }))).toBe(400);
    expect(await model.list('u')).toEqual([]);
  });

  // rep invariant: an endpoint is subscribed for at most one user
  it('security_aBrowserBelongsToTheLastUserWhoSubscribedInIt', async () => {
    const model = makeWorld().services.subscriptions;
    await model.save('amy', browser(1));
    await model.save('bob', browser(1)); // bob logs in on the same browser
    expect(await model.list('amy')).toEqual([]);
    expect(await model.list('bob')).toEqual([browser(1)]);
    await model.remove('amy', browser(1).endpoint); // a late clean-up by amy changes nothing
    expect(await model.list('bob')).toEqual([browser(1)]);
    await model.remove('bob', browser(1).endpoint);
    await model.save('amy', browser(1));
    expect(await model.list('amy')).toEqual([browser(1)]);
  });

  // boundary: the 10th subscription fits, the 11th pushes the oldest out
  it('keeps at most MAX_PER_USER browsers per user, dropping the oldest', async () => {
    const { services, clock } = makeWorld();
    const model = services.subscriptions;
    for (let n = 1; n <= PushSubscriptionModel.MAX_PER_USER; n++) {
      await model.save('u', browser(n));
      clock.advance(1000);
    }
    expect(await model.list('u')).toHaveLength(PushSubscriptionModel.MAX_PER_USER);
    await model.save('u', browser(11));
    const endpoints = (await model.list('u')).map((s) => s.endpoint);
    expect(endpoints).toHaveLength(PushSubscriptionModel.MAX_PER_USER);
    expect(endpoints).not.toContain(browser(1).endpoint);
    expect(endpoints.at(-1)).toBe(browser(11).endpoint);
    await model.save('other', browser(1)); // the dropped browser is free for another user
    expect(await model.list('other')).toEqual([browser(1)]);
    expect(await model.list('u')).toHaveLength(PushSubscriptionModel.MAX_PER_USER);
  });
});

describe('Notifier', () => {
  async function setup() {
    const world = makeWorld();
    const amy = await world.join('amy@example.com');
    const bob = await world.join('bob@example.com');
    await world.services.accounts.updateUsername(amy.userId, 'Amy');
    const sender = new RecordingSender();
    const lines: string[] = [];
    const notifier = buildNotifier(world.services, sender, (line) => lines.push(line));
    const chatId = await world.services.chats.openChat(amy.userId, bob.userId);
    return { world, amy: amy.userId, bob: bob.userId, sender, lines, notifier, chatId };
  }

  it('builds a notification for each kind of event, naming the sender', async () => {
    const { notifier, amy, bob, chatId } = await setup();
    expect(await notifier.payloadFor({ type: 'MATCH_OFFERED', toUserId: bob, fromUserId: amy, matchId: 'm 1' })).toEqual({
      title: 'You have a new match!',
      body: 'You matched with Amy. Open Do~Re to say yes or no.',
      url: '/match/m%201',
      tag: 'match-m 1',
    });
    expect(await notifier.payloadFor({ type: 'MATCH_COMPLETED', toUserId: bob, fromUserId: amy, chatId })).toEqual({
      title: 'Amy said yes!',
      body: 'You can chat now. Say hi.',
      url: `/chats/${chatId}`,
      tag: `chat-${chatId}`,
    });
    expect(await notifier.payloadFor({ type: 'MESSAGE', toUserId: bob, fromUserId: amy, chatId, preview: 'hello there' })).toEqual({
      title: 'Amy',
      body: 'hello there',
      url: `/chats/${chatId}`,
      tag: `chat-${chatId}`,
    });
    // a sender with no username yet, or whose account is gone, is "Someone" (never an email)
    expect((await notifier.payloadFor({ type: 'MESSAGE', toUserId: amy, fromUserId: bob, chatId, preview: 'x' })).title).toBe('Someone');
    expect((await notifier.payloadFor({ type: 'MESSAGE', toUserId: amy, fromUserId: 'ghost', chatId, preview: 'x' })).title).toBe('Someone');
  });

  it('sends to every browser of the recipient and to nobody else', async () => {
    const { world, notifier, sender, amy, bob, chatId } = await setup();
    const event: NotificationEvent = { type: 'MESSAGE', toUserId: bob, fromUserId: amy, chatId, preview: 'hi' };
    expect(await notifier.handle(event)).toBe(0); // bob has not subscribed anywhere
    await world.services.subscriptions.save(bob, browser(1));
    await world.services.subscriptions.save(bob, browser(2));
    await world.services.subscriptions.save(amy, browser(3));
    expect(await notifier.handle(event)).toBe(2);
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual([browser(1).endpoint, browser(2).endpoint]);
    expect(sender.sent[0]!.payload).toMatchObject({ title: 'Amy', body: 'hi' });
  });

  it('forgets browsers the push service reports gone, and carries on past failures without logging the endpoint', async () => {
    const { world, notifier, sender, lines, amy, bob, chatId } = await setup();
    for (const n of [1, 2, 3]) {
      await world.services.subscriptions.save(bob, browser(n));
      world.clock.advance(1000);
    }
    sender.gone.add(browser(1).endpoint);
    sender.broken.add(browser(2).endpoint);
    const event: NotificationEvent = { type: 'MATCH_OFFERED', toUserId: bob, fromUserId: amy, matchId: 'm1' };
    expect(await notifier.handle(event)).toBe(1);
    expect(sender.sent.map((s) => s.endpoint)).toEqual([browser(3).endpoint]);
    expect((await world.services.subscriptions.list(bob)).map((s) => s.endpoint)).toEqual([browser(2).endpoint, browser(3).endpoint]);
    expect(lines).toEqual(['Push failed: WebPushError 500']);
  });

  it('R_CHAT_15_doesNotNotifyAboutAChatTheRecipientRemovedOrReported', async () => {
    const { world, notifier, sender, amy, bob, chatId } = await setup();
    await world.services.subscriptions.save(bob, browser(1));
    const event: NotificationEvent = { type: 'MESSAGE', toUserId: bob, fromUserId: amy, chatId, preview: 'hi' };
    await world.services.chats.reportChat(bob, chatId);
    expect(await notifier.handle(event)).toBe(0);
    expect(await notifier.handle({ ...event, chatId: 'no_chat' })).toBe(0);
    expect(await notifier.handle({ ...event, toUserId: 'intruder' })).toBe(0);
    expect(sender.sent).toEqual([]);
  });

  it('logs a failure that has no status', async () => {
    const { world, sender: _unused, amy, bob, chatId } = await setup();
    await world.services.subscriptions.save(bob, browser(1));
    const lines: string[] = [];
    const failing = { send: async () => Promise.reject(new TypeError('fetch failed')) };
    const notifier = buildNotifier(world.services, failing, (line) => lines.push(line));
    expect(await notifier.handle({ type: 'MESSAGE', toUserId: bob, fromUserId: amy, chatId, preview: 'hi' })).toBe(0);
    expect(lines).toEqual(['Push failed: TypeError']);
    expect(buildNotifier(world.services, failing)).toBeDefined(); // default log is the console
  });
});

describe('WebPushSender', () => {
  const vapid = { subject: 'mailto:team@do-re.test', publicKey: 'pub', privateKey: 'priv' };

  // spec: delivers with the app's VAPID details and a 1 hour TTL
  it('sends through web-push with the VAPID details', async () => {
    const calls: unknown[][] = [];
    const sender = new WebPushSender({ sendNotification: async (...args) => void calls.push(args) }, vapid);
    expect(await sender.send(browser(1), '{"title":"x"}')).toBe('sent');
    expect(calls).toEqual([[browser(1), '{"title":"x"}', { vapidDetails: vapid, TTL: 3600 }]]);
  });

  // spec: 404 and 410 mean the subscription is gone; anything else throws
  it('tells a gone subscription from a failure', async () => {
    const failingWith = (statusCode?: number) =>
      new WebPushSender({ sendNotification: async () => Promise.reject(Object.assign(new Error('x'), { statusCode })) }, vapid);
    expect(await failingWith(410).send(browser(1), '{}')).toBe('gone');
    expect(await failingWith(404).send(browser(1), '{}')).toBe('gone');
    await expect(failingWith(429).send(browser(1), '{}')).rejects.toThrow();
    await expect(failingWith(undefined).send(browser(1), '{}')).rejects.toThrow();
  });
});

describe('events are published when they happen', () => {
  const taste = new TasteVector(new Array<number>(FEATURE_COUNT).fill(0.5));

  it('R_HOME_20_aSwipeThatOffersAMatchAnnouncesItToTheOtherUser', async () => {
    const publisher = new RecordingPublisher();
    const world = makeWorld({ publisher });
    await world.services.matchModel.updateUser('other', taste, world.clock.now);
    world.random.ints.push(1); // offer due at swipe 2
    for (let i = 0; i < 2; i++) {
      const current = await world.services.songs.getCurrentSong('me');
      const result = await world.services.songs.submitFeedback('me', current.id, 'LIKE', 10);
      if (i === 0) {
        expect(publisher.events).toEqual([]); // no offer, no event
      } else {
        expect(publisher.events).toEqual([{ type: 'MATCH_OFFERED', toUserId: 'other', fromUserId: 'me', matchId: result.offeredMatch!.matchId }]);
      }
    }
  });

  it('R_HOME_23_completingAMatchAnnouncesItOnceToTheUserWhoConfirmedFirst', async () => {
    const publisher = new RecordingPublisher();
    const world = makeWorld({ publisher });
    await world.services.matchModel.updateUser('me', taste, world.clock.now);
    await world.services.matchModel.updateUser('you', taste, world.clock.now);
    const match = (await world.services.matchModel.findMatch('me', world.clock.now))!;
    await world.services.matches.confirmMatch(match.matchId, 'me');
    expect(publisher.events).toEqual([]); // waiting for the other user: nothing to announce
    const calls = Array.from({ length: 12 }, (_, i) => world.services.matches.confirmMatch(match.matchId, i % 2 ? 'me' : 'you'));
    const chatIds = await Promise.all(calls);
    expect(publisher.events).toEqual([{ type: 'MATCH_COMPLETED', toUserId: 'me', fromUserId: 'you', chatId: chatIds[0] }]);
  });

  it('R_CHAT_13_sendingAMessageAnnouncesItToTheOtherParticipantWithAPreview', async () => {
    const publisher = new RecordingPublisher();
    const world = makeWorld({ publisher });
    const chatId = await world.services.chats.openChat('amy', 'bob');
    await world.services.chats.sendMessage(chatId, 'bob', '  hello  ');
    await world.services.chats.sendMessage(chatId, 'amy', 'y'.repeat(200));
    expect(publisher.events).toEqual([
      { type: 'MESSAGE', toUserId: 'amy', fromUserId: 'bob', chatId, preview: 'hello' },
      { type: 'MESSAGE', toUserId: 'bob', fromUserId: 'amy', chatId, preview: `${'y'.repeat(PREVIEW_LENGTH)}…` },
    ]);
    await world.services.chats.sendMessage(chatId, 'intruder', 'hi').catch(() => undefined);
    await world.services.chats.sendMessage(chatId, 'amy', '   ').catch(() => undefined);
    expect(publisher.events).toHaveLength(2); // a message that was not stored is not announced
  });
});

describe('publishers and the notifier Lambda handler', () => {
  // spec: publishes the event as JSON to the topic; never rejects
  it('SnsPublisher publishes to the topic and only logs a failure', async () => {
    const commands: { input: unknown }[] = [];
    const publisher = new SnsPublisher({ send: async (command) => void commands.push(command) }, 'arn:aws:sns:us-west-2:1:topic');
    await publisher.publish(message);
    expect(commands[0]!.input).toEqual({ TopicArn: 'arn:aws:sns:us-west-2:1:topic', Message: JSON.stringify(message) });

    const lines: string[] = [];
    const down = { send: async () => Promise.reject(Object.assign(new Error('secret detail'), { name: 'AuthorizationError' })) };
    await new SnsPublisher(down, 'arn', (line) => lines.push(line)).publish(message);
    expect(lines).toEqual(['Could not publish MESSAGE: AuthorizationError']);
  });

  it('InProcessPublisher hands the event to the notifier and only logs a failure', async () => {
    const world = makeWorld();
    const sender = new RecordingSender();
    const chatId = await world.services.chats.openChat('a', 'b');
    await world.services.subscriptions.save('b', browser(1));
    const publisher = new InProcessPublisher(() => buildNotifier(world.services, sender));
    await publisher.publish({ ...message, chatId });
    expect(sender.sent).toHaveLength(1);

    const lines: string[] = [];
    const broken = new InProcessPublisher(() => {
      throw new RangeError('not ready');
    }, (line) => lines.push(line));
    await broken.publish(message);
    expect(lines).toEqual(['Could not deliver MESSAGE: RangeError']);
  });

  // spec: delivers every valid event of an invocation; skips other records; rejects if delivery throws
  it('snsHandler delivers the events of an SNS invocation', async () => {
    const world = makeWorld();
    const sender = new RecordingSender();
    const chatId = await world.services.chats.openChat('a', 'b');
    await world.services.subscriptions.save('b', browser(1));
    let built = 0;
    const lines: string[] = [];
    const handler = snsHandler(async () => {
      built++;
      return buildNotifier(world.services, sender);
    }, (line) => lines.push(line));
    const record = (body: unknown) => ({ Sns: { Message: typeof body === 'string' ? body : JSON.stringify(body) } });
    await handler({ Records: [record({ ...message, chatId }), record('garbage'), {}, record({ ...message, chatId, preview: 'two' })] });
    expect(sender.sent.map((s) => (s.payload as { body: string }).body)).toEqual(['hi', 'two']);
    expect(lines).toEqual(['Skipped a record that is not a notification event', 'Skipped a record that is not a notification event']);
    expect(built).toBe(2);
    await handler({});

    const failing = snsHandler(() => ({ handle: async () => Promise.reject(new Error('table down')) }) as never);
    await expect(failing({ Records: [record(message)] })).rejects.toThrow('table down'); // SNS will retry
  });

  it('snsHandler and the publishers log to the console by default', async () => {
    const original = console.error;
    const lines: unknown[] = [];
    console.error = (line: unknown) => void lines.push(line);
    try {
      await snsHandler(() => ({}) as never)({ Records: [{ Sns: { Message: 'x' } }] });
      await new SnsPublisher({ send: async () => Promise.reject(new Error('x')) }, 'arn').publish(message);
      await new InProcessPublisher(() => ({ handle: async () => Promise.reject(new Error('x')) }) as never).publish(message);
    } finally {
      console.error = original;
    }
    expect(lines).toHaveLength(3);
  });
});

describe('HTTP API: push routes', () => {
  it('gives the public key and saves and removes the caller\'s subscription', async () => {
    const world = makeWorld();
    const { token, userId } = await world.join('ada@example.com');
    expect((await world.call('GET', '/api/push/public-key')).status).toBe(401);
    expect((await world.call('GET', '/api/push/public-key', { token })).body).toEqual({ publicKey: 'BTestVapidPublicKey' });

    // the body is what PushSubscription.toJSON() gives, including fields the server ignores
    const body = { ...browser(1), expirationTime: null };
    expect((await world.call('PUT', '/api/push/subscription', { token, body })).status).toBe(204);
    expect(await world.services.subscriptions.list(userId)).toEqual([browser(1)]);
    expect((await world.call('PUT', '/api/push/subscription', { token, body: { endpoint: 'https://evil.example/x', keys: browser(1).keys } })).status).toBe(400);
    expect((await world.call('PUT', '/api/push/subscription', { token, body: { endpoint: browser(2).endpoint } })).status).toBe(400);
    expect((await world.call('DELETE', '/api/push/subscription', { token, body: { endpoint: browser(1).endpoint } })).status).toBe(204);
    expect(await world.services.subscriptions.list(userId)).toEqual([]);
    expect((await world.call('DELETE', '/api/push/subscription', { token })).status).toBe(400);
  });

  it('answers 503 when the server has no push key', async () => {
    for (const vapidPublicKey of [undefined, '']) {
      const world = makeWorld({ vapidPublicKey });
      const { token } = await world.join('ada@example.com');
      const response = await world.call('GET', '/api/push/public-key', { token });
      expect(response.status).toBe(503);
      expect((response.body as { error: { code: string } }).error.code).toBe('PUSH_UNAVAILABLE');
    }
  });
});
