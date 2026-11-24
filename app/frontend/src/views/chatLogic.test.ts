import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/apiErrors';
import type { ChatMessage, ChatSummary } from '../api/types';
import {
  describeChatError,
  isChatGone,
  isSessionExpired,
  mergeMessages,
  nextSince,
  normalizeDraft,
  POLL_OVERLAP_MS,
  previewOf,
  startsNewGroup,
} from './chatLogic';

const BASE = Date.parse('2026-11-23T12:00:00.000Z');

function msg(messageId: string, senderId: string, offsetMs: number): ChatMessage {
  return { messageId, senderId, text: `text ${messageId}`, timestamp: new Date(BASE + offsetMs).toISOString() };
}

describe('startsNewGroup', () => {
  it('R_CHAT_09 the first message starts a group', () => {
    expect(startsNewGroup(null, msg('a', 'u1', 0))).toBe(true);
  });

  it('R_CHAT_09 a different sender starts a group, even at the same time', () => {
    expect(startsNewGroup(msg('a', 'u1', 0), msg('b', 'u2', 0))).toBe(true);
  });

  it.each([
    [0, false],
    [59_000, false],
    [60_000, false],
    [60_001, true],
    [61_000, true],
  ])('R_CHAT_09 same sender %d ms later: new group is %s', (gap, expected) => {
    expect(startsNewGroup(msg('a', 'u1', 0), msg('b', 'u1', gap))).toBe(expected);
  });

  it('R_CHAT_09 compares with the directly previous message, so a chain stays one group', () => {
    const second = msg('b', 'u1', 50_000);
    expect(startsNewGroup(second, msg('c', 'u1', 100_000))).toBe(false);
  });
});

describe('mergeMessages', () => {
  it('R_CHAT_01 appends new messages', () => {
    const a = msg('a', 'u1', 0);
    const b = msg('b', 'u2', 1000);
    expect(mergeMessages([a], [b])).toEqual([a, b]);
  });

  it('returns the same array when nothing is new, so React skips a re-render', () => {
    const existing = [msg('a', 'u1', 0)];
    expect(mergeMessages(existing, [existing[0]])).toBe(existing);
    expect(mergeMessages(existing, [])).toBe(existing);
  });

  it('drops repeats within the incoming batch', () => {
    const a = msg('a', 'u1', 0);
    expect(mergeMessages([], [a, a])).toEqual([a]);
  });

  it('puts a late-arriving older message in time order', () => {
    const early = msg('a', 'u1', 0);
    const middle = msg('b', 'u2', 500);
    const late = msg('c', 'u1', 1000);
    expect(mergeMessages([early, late], [middle])).toEqual([early, middle, late]);
  });

  it('keeps arrival order for equal timestamps', () => {
    const first = msg('z', 'u1', 0);
    const second = msg('a', 'u2', 0);
    expect(mergeMessages([first], [second])).toEqual([first, second]);
  });

  it('does not mutate its inputs', () => {
    const existing = [msg('b', 'u1', 1000)];
    mergeMessages(existing, [msg('a', 'u2', 0)]);
    expect(existing.map((m) => m.messageId)).toEqual(['b']);
  });
});

describe('nextSince', () => {
  it('asks for an overlap before the server time', () => {
    const since = nextSince('2026-11-23T12:00:10.000Z');
    expect(Date.parse('2026-11-23T12:00:10.000Z') - Date.parse(since)).toBe(POLL_OVERLAP_MS);
  });
});

describe('normalizeDraft', () => {
  it.each(['', ' ', '\t \n'])('R_CHAT_13 %j has nothing to send', (draft) => {
    expect(normalizeDraft(draft)).toBeNull();
  });

  it('R_CHAT_13 trims the text', () => {
    expect(normalizeDraft('  hi there ')).toBe('hi there');
  });
});

describe('previewOf', () => {
  const base: ChatSummary = {
    chatId: 'c',
    otherUser: { userId: 'u2', username: 'sam', profilePictureUrl: null },
    lastMessage: null,
    lastActivityAt: new Date(BASE).toISOString(),
  };

  it('says when there are no messages', () => {
    expect(previewOf(base, 'u1')).toBe('No messages yet');
  });

  it('shows the other user\'s text as is', () => {
    expect(previewOf({ ...base, lastMessage: msg('a', 'u2', 0) }, 'u1')).toBe('text a');
  });

  it('prefixes your own text', () => {
    expect(previewOf({ ...base, lastMessage: msg('a', 'u1', 0) }, 'u1')).toBe('You: text a');
  });
});

describe('error helpers', () => {
  const error = (code: ConstructorParameters<typeof ApiError>[0]) => new ApiError(code, `msg ${code}`, 400);

  it('describeChatError uses the API message, or a generic one', () => {
    expect(describeChatError(error('EMPTY_MESSAGE'))).toBe('msg EMPTY_MESSAGE');
    expect(describeChatError(new Error('private detail'))).toBe('Something went wrong. Try again.');
  });

  it('isSessionExpired is true only for UNAUTHENTICATED', () => {
    expect(isSessionExpired(error('UNAUTHENTICATED'))).toBe(true);
    expect(isSessionExpired(error('INTERNAL'))).toBe(false);
    expect(isSessionExpired(new Error('x'))).toBe(false);
  });

  it('isChatGone is true for not-found and not-participant', () => {
    expect(isChatGone(error('CHAT_NOT_FOUND'))).toBe(true);
    expect(isChatGone(error('NOT_PARTICIPANT'))).toBe(true);
    expect(isChatGone(error('INTERNAL'))).toBe(false);
    expect(isChatGone(new Error('x'))).toBe(false);
  });
});
