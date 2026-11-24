/**
 * In-memory fake of the chat routes (docs/project/api.md), kept out of mock.ts so the chat half
 * has its own owner (Yara). MockBackend creates one and shares its accounts with it.
 *
 * It follows api.md's proposals for the questions still open with Felix: removed or reported
 * chats return 404 to that user (Q-9), and messages are limited to 2000 characters (Q-5).
 *
 * Abstraction function: the chats of a small app, where each StoredChat is a conversation between
 * userA and userB, hidden from the users in hiddenFor and flagged by the users in flaggedBy;
 * lastSeen holds each user's latest heartbeat.
 * Rep invariant: userA !== userB; hiddenFor and flaggedBy contain only participants; flaggedBy is
 * a subset of hiddenFor; every message has a unique ID, a participant as sender and non-empty
 * text; a chat's message timestamps never decrease.
 */
import { ApiError } from './apiErrors';
import type { ChatApi } from './client';
import { MAX_MESSAGE_LENGTH, type ChatHistory, type ChatMessage, type ChatSummary, type UserProfile } from './types';

/** A user is online if their last heartbeat is at most this old (stub ONLINE_WINDOW). */
export const ONLINE_WINDOW_MS = 30_000;

interface StoredChat {
  readonly chatId: string;
  readonly userA: string;
  readonly userB: string;
  readonly createdAt: number;
  readonly messages: ChatMessage[];
  readonly hiddenFor: Set<string>;
  readonly flaggedBy: Set<string>;
}

/** What the chat fake needs from the rest of the mock. */
export interface MockChatDeps {
  /** Requires: userId belongs to an account. */
  profileOf(userId: string): UserProfile;
  delay(): Promise<void>;
  /** The current time in epoch milliseconds. */
  now(): number;
  /** Called after someone sends a message through the API, so a bot can answer. */
  onUserMessage(chatId: string, senderId: string, otherId: string): void;
}

export class MockChatBackend implements ChatApi {
  private readonly chats = new Map<string, StoredChat>();
  private readonly lastSeen = new Map<string, number>();
  private readonly alwaysOnline = new Set<string>();
  private readonly deps: MockChatDeps;
  private nextMessageId = 1;

  /**
   * Requires: none.
   * Effects: creates an empty chat store.
   */
  constructor(deps: MockChatDeps) {
    this.deps = deps;
  }

  // ----- server-side / test helpers (not part of the API) -----

  /**
   * Stands in for ChatController.openChat, which only the server calls (R-HOME-23).
   * Requires: chatId is unused; userA !== userB.
   * Effects: stores a new empty chat.
   * @param createdAt creation time in epoch milliseconds; defaults to now
   */
  openChat(chatId: string, userA: string, userB: string, createdAt: number = this.deps.now()): void {
    if (this.chats.has(chatId)) throw new Error(`Chat ${chatId} already exists`);
    this.chats.set(chatId, {
      chatId,
      userA,
      userB,
      createdAt,
      messages: [],
      hiddenFor: new Set(),
      flaggedBy: new Set(),
    });
    this.checkRep();
  }

  /**
   * Stands in for a message arriving from another device.
   * Requires: chatId exists; senderId is a participant; text is non-empty.
   * Effects: appends the message, with its time raised if needed so timestamps never decrease.
   * @param at the send time in epoch milliseconds; defaults to now
   * @returns the stored message
   */
  deliver(chatId: string, senderId: string, text: string, at: number = this.deps.now()): ChatMessage {
    const chat = this.chats.get(chatId);
    if (chat === undefined) throw new Error(`No chat ${chatId}`);
    const last = chat.messages.at(-1);
    const time = last === undefined ? at : Math.max(at, Date.parse(last.timestamp));
    const message: ChatMessage = {
      messageId: `msg-${this.nextMessageId++}`,
      senderId,
      text,
      timestamp: new Date(time).toISOString(),
    };
    chat.messages.push(message);
    this.checkRep();
    return message;
  }

  /**
   * Requires: none.
   * Effects: userId counts as online from now on (keeps a seeded partner's dot on in the demo).
   */
  setAlwaysOnline(userId: string): void {
    this.alwaysOnline.add(userId);
  }

  /**
   * Satisfies: R-CHAT-06.
   * Requires: none.
   * Effects: none.
   * @returns true iff userId's last heartbeat was at most ONLINE_WINDOW_MS before nowMs
   */
  isUserOnline(userId: string, nowMs: number): boolean {
    if (this.alwaysOnline.has(userId)) return true;
    const seen = this.lastSeen.get(userId);
    return seen !== undefined && nowMs - seen <= ONLINE_WINDOW_MS;
  }

  /**
   * Requires: none.
   * Effects: none.
   * @returns true iff some user has reported chatId (R-CHAT-16)
   */
  isFlagged(chatId: string): boolean {
    return (this.chats.get(chatId)?.flaggedBy.size ?? 0) > 0;
  }

  /** Asserts the rep invariant. */
  checkRep(): void {
    for (const chat of this.chats.values()) {
      const users = [chat.userA, chat.userB];
      assert(chat.userA !== chat.userB, 'chat users differ');
      for (const u of chat.hiddenFor) assert(users.includes(u), 'hiddenFor holds participants');
      for (const u of chat.flaggedBy) assert(chat.hiddenFor.has(u), 'flaggedBy is within hiddenFor');
      let previous = -Infinity;
      const ids = new Set<string>();
      for (const m of chat.messages) {
        const time = Date.parse(m.timestamp);
        assert(users.includes(m.senderId), 'sender is a participant');
        assert(m.text !== '', 'text is non-empty');
        assert(!ids.has(m.messageId), 'message IDs are unique');
        assert(time >= previous, 'timestamps never decrease');
        ids.add(m.messageId);
        previous = time;
      }
    }
  }

  // ----- ChatApi -----

  async getChatLog(userId: string): Promise<ChatSummary[]> {
    await this.deps.delay();
    this.touch(userId);
    return [...this.chats.values()]
      .filter((c) => isParticipant(c, userId) && !c.hiddenFor.has(userId))
      .map((c) => this.toSummary(c, userId))
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  }

  async getHistory(chatId: string, userId: string, since?: string): Promise<ChatHistory> {
    await this.deps.delay();
    this.touch(userId);
    const chat = this.requireVisible(chatId, userId);
    const sinceMs = since === undefined ? -Infinity : Date.parse(since);
    if (Number.isNaN(sinceMs)) {
      throw new ApiError('BAD_REQUEST', 'That request had an invalid time.', 400);
    }
    const now = this.deps.now();
    const other = otherOf(chat, userId);
    return {
      chatId,
      otherUser: this.deps.profileOf(other),
      otherUserOnline: this.isUserOnline(other, now),
      messages: chat.messages.filter((m) => Date.parse(m.timestamp) > sinceMs),
      serverTime: new Date(now).toISOString(),
    };
  }

  async sendMessage(chatId: string, senderId: string, text: string): Promise<ChatMessage> {
    await this.deps.delay();
    this.touch(senderId);
    const chat = this.requireVisible(chatId, senderId);
    const trimmed = text.trim();
    if (trimmed === '') {
      throw new ApiError('EMPTY_MESSAGE', 'Type a message before sending.', 400);
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new ApiError(
        'MESSAGE_TOO_LONG',
        `Messages can be up to ${MAX_MESSAGE_LENGTH} characters. Shorten it and try again.`,
        400,
      );
    }
    const message = this.deliver(chatId, senderId, trimmed);
    this.deps.onUserMessage(chatId, senderId, otherOf(chat, senderId));
    return message;
  }

  async removeChatFromLog(userId: string, chatId: string): Promise<void> {
    await this.deps.delay();
    this.touch(userId);
    this.requireParticipant(chatId, userId).hiddenFor.add(userId);
    this.checkRep();
  }

  async reportChat(userId: string, chatId: string): Promise<void> {
    await this.deps.delay();
    this.touch(userId);
    const chat = this.requireParticipant(chatId, userId);
    chat.hiddenFor.add(userId);
    chat.flaggedBy.add(userId);
    this.checkRep();
  }

  async recordHeartbeat(userId: string): Promise<void> {
    await this.deps.delay();
    this.touch(userId);
  }

  // ----- helpers -----

  /** Effects: userId's last-seen time becomes now, if later than the stored one. */
  private touch(userId: string): void {
    this.lastSeen.set(userId, Math.max(this.deps.now(), this.lastSeen.get(userId) ?? -Infinity));
  }

  private toSummary(chat: StoredChat, userId: string): ChatSummary {
    const last = chat.messages.at(-1) ?? null;
    return {
      chatId: chat.chatId,
      otherUser: this.deps.profileOf(otherOf(chat, userId)),
      lastMessage: last,
      lastActivityAt: last?.timestamp ?? new Date(chat.createdAt).toISOString(),
    };
  }

  private requireParticipant(chatId: string, userId: string): StoredChat {
    const chat = this.chats.get(chatId);
    if (chat === undefined) {
      throw new ApiError('CHAT_NOT_FOUND', "This chat doesn't exist or was removed.", 404);
    }
    if (!isParticipant(chat, userId)) {
      throw new ApiError('NOT_PARTICIPANT', "You aren't part of this chat.", 403);
    }
    return chat;
  }

  private requireVisible(chatId: string, userId: string): StoredChat {
    const chat = this.requireParticipant(chatId, userId);
    if (chat.hiddenFor.has(userId)) {
      throw new ApiError('CHAT_NOT_FOUND', "This chat doesn't exist or was removed.", 404);
    }
    return chat;
  }
}

function isParticipant(chat: StoredChat, userId: string): boolean {
  return chat.userA === userId || chat.userB === userId;
}

function otherOf(chat: StoredChat, userId: string): string {
  return chat.userA === userId ? chat.userB : chat.userA;
}

function assert(condition: boolean, what: string): void {
  if (!condition) throw new Error(`MockChatBackend rep invariant violated: ${what}`);
}
