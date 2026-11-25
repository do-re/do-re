import { describe, expect, it } from 'vitest';
import { ChatController } from '../src/chat/ChatController';
import { ChatModel } from '../src/chat/ChatModel';
import { makeWorld, statusOf } from './helpers';

function setup() {
  const world = makeWorld();
  return { world, model: world.services.chatModel, chats: world.services.chats, clock: world.clock };
}

describe('ChatModel', () => {
  it('R_HOME_23_createChatMakesOneChatPerPairWhateverTheOrder', async () => {
    const { model } = setup();
    const chatId = await model.createChat('bob', 'amy');
    expect(await model.createChat('amy', 'bob')).toBe(chatId);
    expect(await model.createChat('bob', 'amy')).toBe(chatId);
    expect(await model.getChat(chatId)).toEqual({ chatId, userA: 'amy', userB: 'bob', messages: [] });
    expect(await model.getChatsForUser('amy')).toHaveLength(1);
    expect(await model.createChat('amy', 'cat')).not.toBe(chatId);
    expect(await statusOf(model.createChat('amy', 'amy'))).toBe(400);
  });

  it('createChat keeps an existing chat and its messages', async () => {
    const { model } = setup();
    const chatId = await model.createChat('amy', 'bob');
    await model.addMessage(chatId, { senderId: 'amy', text: 'hi', timestamp: 1 });
    await model.createChat('amy', 'bob');
    expect((await model.getChat(chatId)).messages).toHaveLength(1);
  });

  it('R_CHAT_01_messagesAreStoredInOrderWithSeqNumbers', async () => {
    const { model, clock } = setup();
    const chatId = await model.createChat('amy', 'bob');
    const first = await model.addMessage(chatId, { senderId: 'amy', text: 'one', timestamp: clock.now + 10 });
    const second = await model.addMessage(chatId, { senderId: 'bob', text: 'two', timestamp: clock.now + 20 });
    expect(first).toEqual({ seq: 1, senderId: 'amy', text: 'one', timestamp: clock.now + 10 });
    expect(second.seq).toBe(2);
    expect((await model.getChat(chatId)).messages).toEqual([first, second]);
  });

  // spec: stored timestamp is max(message time, latest timestamp), so order by seq is order by time
  it('R_CHAT_01_aMessageStampedEarlierThanTheLastOneIsMovedUpToIt', async () => {
    const { model, clock } = setup();
    const chatId = await model.createChat('amy', 'bob');
    await model.addMessage(chatId, { senderId: 'amy', text: 'late clock', timestamp: clock.now + 5000 });
    const skewed = await model.addMessage(chatId, { senderId: 'bob', text: 'early clock', timestamp: clock.now + 100 });
    expect(skewed.timestamp).toBe(clock.now + 5000);
    const emptyChat = await model.createChat('amy', 'cat');
    const first = await model.addMessage(emptyChat, { senderId: 'amy', text: 'x', timestamp: 0 });
    expect(first.timestamp).toBe(clock.now); // never before the chat was created
  });

  // spec: since returns only messages stamped later (boundaries: before all, equal, after all)
  it('R_CHAT_01_getChatCanReturnOnlyMessagesAfterATime', async () => {
    const { model, clock } = setup();
    const chatId = await model.createChat('amy', 'bob');
    const t = clock.now;
    for (let i = 1; i <= 12; i++) {
      // two messages share each timestamp, to check that "later than" is strict
      await model.addMessage(chatId, { senderId: 'amy', text: `m${i}`, timestamp: t + Math.ceil(i / 2) * 1000 });
    }
    const seqs = async (since?: number) => (await model.getChat(chatId, { since })).messages.map((m) => m.seq);
    expect(await seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // numeric, not text, order
    expect(await seqs(0)).toHaveLength(12);
    expect(await seqs(t + 4999)).toEqual([9, 10, 11, 12]);
    expect(await seqs(t + 5000)).toEqual([11, 12]);
    expect(await seqs(t + 6000)).toEqual([]);
    expect(await seqs(t + 99_000)).toEqual([]);
  });

  // spec: text must be 1..MAX_TEXT_LENGTH characters; sender a participant; chat must exist
  it('addMessage validates the text, the sender and the chat', async () => {
    const { model } = setup();
    const chatId = await model.createChat('amy', 'bob');
    const send = (text: string, senderId = 'amy', id = chatId) => model.addMessage(id, { senderId, text, timestamp: 1 });
    expect(await send('').catch((e) => e.code)).toBe('EMPTY_MESSAGE');
    expect(await send('  \n ').catch((e) => e.code)).toBe('EMPTY_MESSAGE');
    expect(await send('x'.repeat(ChatModel.MAX_TEXT_LENGTH + 1)).catch((e) => e.code)).toBe('MESSAGE_TOO_LONG');
    expect(await statusOf(send('x'.repeat(ChatModel.MAX_TEXT_LENGTH + 1)))).toBe(400);
    const longest = await send(`  ${'x'.repeat(ChatModel.MAX_TEXT_LENGTH)}  `); // trimmed before the check
    expect(longest).toMatchObject({ seq: 1, text: 'x'.repeat(ChatModel.MAX_TEXT_LENGTH) });
    expect(await statusOf(send('hi', 'intruder'))).toBe(403);
    expect(await statusOf(send('hi', 'amy', 'no_chat'))).toBe(404);
    expect(await statusOf(model.getChat('no_chat'))).toBe(404);
    expect((await model.getChat(chatId)).messages).toHaveLength(1);
  });

  it('R_CHAT_02_chatsAreOrderedByLatestActivityMostRecentFirst', async () => {
    const { model, clock } = setup();
    const withBob = await model.createChat('amy', 'bob');
    clock.advance(1000);
    const withCat = await model.createChat('amy', 'cat');
    clock.advance(1000);
    const withDan = await model.createChat('amy', 'dan');
    const order = async () => (await model.getChatsForUser('amy')).map((c) => c.chatId);
    expect(await order()).toEqual([withDan, withCat, withBob]); // no messages: by creation time
    await model.addMessage(withBob, { senderId: 'bob', text: 'received', timestamp: clock.now + 500 });
    expect(await order()).toEqual([withBob, withDan, withCat]); // a received message counts
    await model.addMessage(withCat, { senderId: 'amy', text: 'sent', timestamp: clock.now + 900 });
    expect(await order()).toEqual([withCat, withBob, withDan]);
    expect((await model.getChatsForUser('amy'))[0]).toEqual({
      chatId: withCat,
      userA: 'amy',
      userB: 'cat',
      lastMessage: { seq: 1, senderId: 'amy', text: 'sent', timestamp: clock.now + 900 },
      lastActivity: clock.now + 900,
    });
    expect((await model.getChatsForUser('amy'))[2]!.lastMessage).toBeUndefined(); // no messages yet
    expect(await model.getChatsForUser('bob')).toHaveLength(1);
    expect(await model.getChatsForUser('nobody')).toEqual([]);
  });

  // spec: the chat disappears from that user's log only; idempotent
  it('removeChatForUser hides the chat for that user only', async () => {
    const { model } = setup();
    const chatId = await model.createChat('amy', 'bob');
    await model.removeChatForUser(chatId, 'amy');
    await model.removeChatForUser(chatId, 'amy');
    expect(await model.getChatsForUser('amy')).toEqual([]);
    expect(await model.getChatsForUser('bob')).toHaveLength(1);
    expect(await statusOf(model.removeChatForUser(chatId, 'intruder'))).toBe(403);
    expect(await statusOf(model.removeChatForUser('no_chat', 'amy'))).toBe(404);
    // api.md Q-9: for the user who removed it the chat is gone; the other user is unaffected
    expect(await statusOf(model.getChat(chatId, { viewer: 'amy' }))).toBe(404);
    expect(await statusOf(model.addMessage(chatId, { senderId: 'amy', text: 'hi', timestamp: 1 }))).toBe(404);
    expect((await model.addMessage(chatId, { senderId: 'bob', text: 'hi', timestamp: 1 })).seq).toBe(1);
    expect((await model.getChat(chatId, { viewer: 'bob' })).messages).toHaveLength(1);
    expect((await model.getChat(chatId)).messages).toHaveLength(1); // no viewer: no access check
  });

  it('R_CHAT_16_flagChatMarksTheChatAndRecordsWhoReportedItAndWhen', async () => {
    const { world, model, clock } = setup();
    const chatId = await model.createChat('amy', 'bob');
    expect(await model.isFlagged(chatId)).toBe(false);
    await model.flagChat(chatId, 'bob');
    expect(await model.isFlagged(chatId)).toBe(true);
    const meta = (await world.table.get({ pk: `CHAT#${chatId}`, sk: 'META' }))!;
    expect(meta.reports).toEqual([{ reporterId: 'bob', at: clock.now }]);
    expect(await statusOf(model.flagChat(chatId, 'intruder'))).toBe(403);
    expect(await statusOf(model.flagChat('no_chat', 'bob'))).toBe(404);
    expect(await statusOf(model.isFlagged('no_chat'))).toBe(404);
  });

  // testing.md: concurrent addMessage calls lose no message and keep timestamps ordered
  it('concurrency_concurrentMessagesFromBothUsersAreAllStoredInOrder', async () => {
    const { model, clock } = setup();
    const chatId = await model.createChat('amy', 'bob');
    const sent = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        // senders' clocks disagree: timestamps arrive out of order
        model.addMessage(chatId, { senderId: i % 2 === 0 ? 'amy' : 'bob', text: `m${i}`, timestamp: clock.now + ((i * 7) % 30) }),
      ),
    );
    const { messages } = await model.getChat(chatId);
    expect(messages.map((m) => m.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(new Set(messages.map((m) => m.text)).size).toBe(30); // none lost or duplicated
    expect(new Set(sent.map((m) => m.seq)).size).toBe(30);
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i]!.timestamp).toBeGreaterThanOrEqual(messages[i - 1]!.timestamp);
    }
  });

  it('concurrency_concurrentCreateChatCallsMakeOneChat', async () => {
    const { world, model } = setup();
    const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? model.createChat('amy', 'bob') : model.createChat('bob', 'amy'))));
    expect(new Set(ids).size).toBe(1);
    expect(await model.getChatsForUser('amy')).toHaveLength(1);
    expect(await world.table.query(`CHAT#${ids[0]}`)).toHaveLength(1);
  });
});

describe('ChatController', () => {
  it('R_CHAT_13_sendMessageStoresTheTextStampedWithTheCurrentTime', async () => {
    const { chats, clock } = setup();
    const chatId = await chats.openChat('amy', 'bob');
    clock.advance(5000);
    const message = await chats.sendMessage(chatId, 'amy', 'hello');
    expect(message).toEqual({ seq: 1, senderId: 'amy', text: 'hello', timestamp: clock.now });
    expect(await chats.getHistory(chatId, 'bob')).toEqual([message]);
    expect(await statusOf(chats.sendMessage(chatId, 'amy', ''))).toBe(400);
  });

  it('R_CHAT_01_onlyParticipantsCanFetchAChat', async () => {
    const { chats } = setup();
    const chatId = await chats.openChat('amy', 'bob');
    await chats.sendMessage(chatId, 'amy', 'one');
    await chats.sendMessage(chatId, 'bob', 'two');
    expect((await chats.getChat(chatId, 'amy')).messages.map((m) => m.text)).toEqual(['one', 'two']);
    expect((await chats.getChat(chatId, 'bob', 0)).messages.map((m) => m.text)).toEqual(['one', 'two']);
    expect(await statusOf(chats.getChat(chatId, 'intruder'))).toBe(403);
    expect(await statusOf(chats.getHistory(chatId, 'intruder'))).toBe(403);
    expect(await statusOf(chats.getHistory('no_chat', 'amy'))).toBe(404);
  });

  it('R_CHAT_02_theChatLogListsChatsByRecentActivity', async () => {
    const { chats, clock } = setup();
    const withBob = await chats.openChat('amy', 'bob');
    clock.advance(1000);
    const withCat = await chats.openChat('amy', 'cat');
    clock.advance(1000);
    await chats.sendMessage(withBob, 'bob', 'ping');
    expect((await chats.getChatLog('amy')).map((c) => c.chatId)).toEqual([withBob, withCat]);
  });

  it('R_CHAT_15_R_CHAT_16_reportingFlagsTheChatAndRemovesItFromTheReportersLog', async () => {
    const { chats, model } = setup();
    const chatId = await chats.openChat('amy', 'bob');
    await chats.reportChat('amy', chatId);
    expect(await model.isFlagged(chatId)).toBe(true);
    expect(await chats.getChatLog('amy')).toEqual([]);
    expect(await chats.getChatLog('bob')).toHaveLength(1);
    expect(await statusOf(chats.reportChat('intruder', chatId))).toBe(403);
    await chats.reportChat('amy', chatId); // idempotent
    expect(await statusOf(chats.getChat(chatId, 'amy'))).toBe(404); // the reporter cannot keep chatting
    expect(await statusOf(chats.sendMessage(chatId, 'amy', 'hello?'))).toBe(404);
  });

  it('removeChatFromLog hides the chat without flagging it', async () => {
    const { chats, model } = setup();
    const chatId = await chats.openChat('amy', 'bob');
    await chats.removeChatFromLog('amy', chatId);
    expect(await chats.getChatLog('amy')).toEqual([]);
    expect(await model.isFlagged(chatId)).toBe(false);
  });

  // boundary: online up to and including exactly ONLINE_WINDOW_MS after the last heartbeat
  it('R_CHAT_06_aUserIsOnlineFor30SecondsAfterAHeartbeat', async () => {
    const { chats, clock } = setup();
    const t = clock.now;
    expect(await chats.isUserOnline('amy', t)).toBe(false); // never seen
    await chats.recordHeartbeat('amy', t);
    expect(await chats.isUserOnline('amy', t)).toBe(true);
    expect(await chats.isUserOnline('amy', t + ChatController.ONLINE_WINDOW_MS)).toBe(true);
    expect(await chats.isUserOnline('amy', t + ChatController.ONLINE_WINDOW_MS + 1)).toBe(false);
    expect(await chats.isUserOnline('bob', t)).toBe(false);
  });

  // boundary: a heartbeat is stored only if at least HEARTBEAT_GRANULARITY_MS after the stored one
  it('R_CHAT_06_heartbeatsCloserThanTheGranularityAreNotStoredAndTimeNeverMovesBack', async () => {
    const { chats, clock } = setup();
    const t = clock.now;
    const G = ChatController.HEARTBEAT_GRANULARITY_MS;
    const W = ChatController.ONLINE_WINDOW_MS;
    await chats.recordHeartbeat('amy', t);
    await chats.recordHeartbeat('amy', t + G - 1); // too close: ignored
    expect(await chats.isUserOnline('amy', t + W + 1)).toBe(false);
    await chats.recordHeartbeat('amy', t + G); // stored
    expect(await chats.isUserOnline('amy', t + G + W)).toBe(true);
    await chats.recordHeartbeat('amy', t - 60_000); // an old heartbeat arriving late
    expect(await chats.isUserOnline('amy', t + G + W)).toBe(true);
  });
});
