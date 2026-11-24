import { beforeEach, describe, expect, it } from 'vitest';
import { sequence } from '../test/sequence';
import { ApiError, type ApiErrorCode } from './apiErrors';
import { createMockApi } from './mock';
import { MockChatBackend, ONLINE_WINDOW_MS } from './mockChat';
import { MAX_MESSAGE_LENGTH } from './types';

const START = Date.parse('2026-11-23T12:00:00.000Z');

async function expectCode(promise: Promise<unknown>, code: ApiErrorCode, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  expect((error as ApiError).status).toBe(status);
}

describe('MockChatBackend', () => {
  let time: number;
  let chats: MockChatBackend;

  beforeEach(() => {
    time = START;
    chats = createMockApi({ withBots: false, now: () => time }).backend.chatBackend;
    chats.openChat('c1', 'u-demo', 'u-melody');
  });

  describe('getChatLog', () => {
    it('R_CHAT_02 orders chats by last activity, most recent first', async () => {
      chats.openChat('c2', 'u-demo', 'u-rhythm', START + 10);
      chats.deliver('c1', 'u-melody', 'newer', START + 20);
      expect((await chats.getChatLog('u-demo')).map((c) => c.chatId)).toEqual(['c1', 'c2']);
      chats.deliver('c2', 'u-demo', 'newest', START + 30);
      expect((await chats.getChatLog('u-demo')).map((c) => c.chatId)).toEqual(['c2', 'c1']);
    });

    it('uses creation time for a chat with no messages', async () => {
      const [row] = await chats.getChatLog('u-demo');
      expect(row.lastMessage).toBeNull();
      expect(row.lastActivityAt).toBe(new Date(START).toISOString());
    });

    it('shows each user the other participant', async () => {
      expect((await chats.getChatLog('u-demo'))[0].otherUser.username).toBe('melody');
      expect((await chats.getChatLog('u-melody'))[0].otherUser.username).toBe('demo');
    });

    it('is empty for a user with no chats', async () => {
      expect(await chats.getChatLog('u-rhythm')).toEqual([]);
    });
  });

  describe('getHistory', () => {
    it('R_CHAT_01 returns messages oldest first with the server time', async () => {
      chats.deliver('c1', 'u-melody', 'one', START);
      chats.deliver('c1', 'u-demo', 'two', START + 1);
      const history = await chats.getHistory('c1', 'u-demo');
      expect(history.messages.map((m) => m.text)).toEqual(['one', 'two']);
      expect(history.serverTime).toBe(new Date(START).toISOString());
      expect(history.otherUser.userId).toBe('u-melody');
    });

    it('since is strict: a message exactly at since is excluded', async () => {
      const at = chats.deliver('c1', 'u-melody', 'at', START);
      chats.deliver('c1', 'u-melody', 'after', START + 1);
      const history = await chats.getHistory('c1', 'u-demo', at.timestamp);
      expect(history.messages.map((m) => m.text)).toEqual(['after']);
    });

    it('rejects a bad since', async () => {
      await expectCode(chats.getHistory('c1', 'u-demo', 'yesterday'), 'BAD_REQUEST', 400);
    });

    it('404 for an unknown chat, 403 for a non-participant', async () => {
      await expectCode(chats.getHistory('nope', 'u-demo'), 'CHAT_NOT_FOUND', 404);
      await expectCode(chats.getHistory('c1', 'u-rhythm'), 'NOT_PARTICIPANT', 403);
    });

    it('R_CHAT_06 the other user is online only within 30 s of their last request', async () => {
      await chats.recordHeartbeat('u-melody');
      time = START + ONLINE_WINDOW_MS;
      expect((await chats.getHistory('c1', 'u-demo')).otherUserOnline).toBe(true);
      time = START + ONLINE_WINDOW_MS + 1;
      expect((await chats.getHistory('c1', 'u-demo')).otherUserOnline).toBe(false);
    });

    it('R_CHAT_06 someone who never connected is offline', async () => {
      expect((await chats.getHistory('c1', 'u-demo')).otherUserOnline).toBe(false);
    });

    it('polling is the heartbeat', async () => {
      await chats.getHistory('c1', 'u-demo');
      expect(chats.isUserOnline('u-demo', START)).toBe(true);
    });

    it('a heartbeat never moves last-seen backwards', async () => {
      time = START + 1000;
      await chats.recordHeartbeat('u-melody');
      time = START;
      await chats.recordHeartbeat('u-melody');
      expect(chats.isUserOnline('u-melody', START + 1000 + ONLINE_WINDOW_MS)).toBe(true);
    });
  });

  describe('sendMessage', () => {
    it('R_CHAT_13 stores trimmed text with the server time', async () => {
      const message = await chats.sendMessage('c1', 'u-demo', '  hi  ');
      expect(message).toMatchObject({ senderId: 'u-demo', text: 'hi', timestamp: new Date(START).toISOString() });
    });

    it.each(['', '   '])('R_CHAT_13 rejects empty text %j', async (text) => {
      await expectCode(chats.sendMessage('c1', 'u-demo', text), 'EMPTY_MESSAGE', 400);
    });

    it('accepts the maximum length and rejects one more', async () => {
      await expect(chats.sendMessage('c1', 'u-demo', 'x'.repeat(MAX_MESSAGE_LENGTH))).resolves.toBeDefined();
      await expectCode(chats.sendMessage('c1', 'u-demo', 'x'.repeat(MAX_MESSAGE_LENGTH + 1)), 'MESSAGE_TOO_LONG', 400);
    });

    it('keeps timestamps non-decreasing if the clock goes back', async () => {
      time = START + 1000;
      const first = await chats.sendMessage('c1', 'u-demo', 'first');
      time = START;
      const second = await chats.sendMessage('c1', 'u-melody', 'second');
      expect(second.timestamp).toBe(first.timestamp);
    });

    it('gives concurrent senders unique IDs and loses nothing', async () => {
      await Promise.all(
        Array.from({ length: 50 }, (_, i) => chats.sendMessage('c1', i % 2 === 0 ? 'u-demo' : 'u-melody', `m${i}`)),
      );
      const { messages } = await chats.getHistory('c1', 'u-demo');
      expect(messages).toHaveLength(50);
      expect(new Set(messages.map((m) => m.messageId)).size).toBe(50);
    });

    it('404 for an unknown chat, 403 for a non-participant', async () => {
      await expectCode(chats.sendMessage('nope', 'u-demo', 'hi'), 'CHAT_NOT_FOUND', 404);
      await expectCode(chats.sendMessage('c1', 'u-rhythm', 'hi'), 'NOT_PARTICIPANT', 403);
    });
  });

  describe('removeChatFromLog', () => {
    it('hides the chat for the caller only, and is idempotent', async () => {
      await chats.removeChatFromLog('u-demo', 'c1');
      await chats.removeChatFromLog('u-demo', 'c1');
      expect(await chats.getChatLog('u-demo')).toEqual([]);
      expect(await chats.getChatLog('u-melody')).toHaveLength(1);
      expect(chats.isFlagged('c1')).toBe(false);
    });

    it('returns 404 to that user afterwards (Q-9) while the other user continues', async () => {
      await chats.removeChatFromLog('u-demo', 'c1');
      await expectCode(chats.getHistory('c1', 'u-demo'), 'CHAT_NOT_FOUND', 404);
      await expectCode(chats.sendMessage('c1', 'u-demo', 'hi'), 'CHAT_NOT_FOUND', 404);
      await expect(chats.sendMessage('c1', 'u-melody', 'still here')).resolves.toBeDefined();
    });

    it('404 for an unknown chat, 403 for a non-participant', async () => {
      await expectCode(chats.removeChatFromLog('u-demo', 'nope'), 'CHAT_NOT_FOUND', 404);
      await expectCode(chats.removeChatFromLog('u-rhythm', 'c1'), 'NOT_PARTICIPANT', 403);
    });
  });

  describe('reportChat', () => {
    it('R_CHAT_15 R_CHAT_16 flags the chat and removes it from the reporter only', async () => {
      await chats.reportChat('u-demo', 'c1');
      await chats.reportChat('u-demo', 'c1');
      expect(chats.isFlagged('c1')).toBe(true);
      expect(await chats.getChatLog('u-demo')).toEqual([]);
      expect(await chats.getChatLog('u-melody')).toHaveLength(1);
    });

    it('403 for a non-participant, without flagging', async () => {
      await expectCode(chats.reportChat('u-rhythm', 'c1'), 'NOT_PARTICIPANT', 403);
      expect(chats.isFlagged('c1')).toBe(false);
    });
  });

  describe('helpers', () => {
    it('isFlagged is false for an unknown chat', () => {
      expect(chats.isFlagged('nope')).toBe(false);
    });

    it('openChat refuses a duplicate ID', () => {
      expect(() => chats.openChat('c1', 'u-demo', 'u-melody')).toThrow(/already exists/);
    });

    it('openChat refuses a chat with oneself (rep invariant)', () => {
      expect(() => chats.openChat('c9', 'u-demo', 'u-demo')).toThrow(/rep invariant/);
    });

    it('deliver refuses an unknown chat', () => {
      expect(() => chats.deliver('nope', 'u-demo', 'hi')).toThrow(/No chat/);
    });

    it('deliver refuses a non-participant (rep invariant)', () => {
      expect(() => chats.deliver('c1', 'u-rhythm', 'hi')).toThrow(/rep invariant/);
    });

    it('setAlwaysOnline keeps a user online indefinitely', () => {
      chats.setAlwaysOnline('u-melody');
      expect(chats.isUserOnline('u-melody', START + 10 * ONLINE_WINDOW_MS)).toBe(true);
    });
  });
});

describe('MockBackend chat integration', () => {
  it('R_HOME_23 when both confirm, exactly one chat exists for both users', async () => {
    const api = createMockApi({ withPendingMatch: true });
    const match = (await api.matches.getPendingMatches('u-demo'))[0];
    const chatId = await api.matches.confirmMatch(match, 'u-demo');
    expect(await api.matches.confirmMatch(match, 'u-harmony')).toBe(chatId);
    expect((await api.chats.getChatLog('u-demo')).map((c) => c.chatId)).toEqual([chatId]);
    expect((await api.chats.getChatLog('u-harmony')).map((c) => c.chatId)).toEqual([chatId]);
  });

  it('seed chats are off by default', async () => {
    expect(await createMockApi().chats.getChatLog('u-demo')).toEqual([]);
  });

  it('seeded chats have most recent first and an online partner', async () => {
    const api = createMockApi({ withSeedChats: true });
    const log = await api.chats.getChatLog('u-demo');
    expect(log.map((c) => c.otherUser.username)).toEqual(['tempo', 'lyric']);
    expect((await api.chats.getHistory('c-seed-tempo', 'u-demo')).otherUserOnline).toBe(true);
    expect((await api.chats.getHistory('c-seed-lyric', 'u-demo')).otherUserOnline).toBe(false);
  });

  it('never offers demo a match with someone they already chat with', async () => {
    const api = createMockApi({ withPendingMatch: false, withSeedChats: true, matchEvery: 1, random: sequence(0.99) });
    let song = await api.songs.getCurrentSong('u-demo');
    const offered = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const result = await api.songs.submitFeedback('u-demo', song.id, 'SKIP', 1);
      song = result.nextSong;
      if (result.offeredMatch !== null) offered.add(result.offeredMatch.userB);
    }
    expect(offered.has('u-tempo')).toBe(false);
    expect(offered.has('u-lyric')).toBe(false);
    expect(offered.size).toBeGreaterThan(0);
  });
});
