import type { ReportModel } from '../admin/ReportModel';
import { type Clock, otherOfPair } from '../deps';
import { type EventPublisher, previewOf } from '../notify/events';
import type { Chat, ChatMessage, ChatSummary } from '../model/types';
import { type Key, type Table, updateItem } from '../store/Table';
import type { ChatModel } from './ChatModel';

const presenceKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'PRESENCE' });

/**
 * ChatController (server half): sends messages from ChatView to ChatModel, pulls chat
 * history for ChatView and MessageLogView, handles reports and tracks who is online.
 * Resides on: client and server; this is the server side.
 * Communicates with: ChatModel, ChatView, MessageLogView, MatchController.
 *
 * Stored state: USER#<id> / PRESENCE with lastSeen (time of the user's latest recorded
 * heartbeat). Changed from stubs v2: the constructor also takes the table and a clock.
 *
 * Concurrency: recordHeartbeat is a read-modify-write through updateItem and only ever
 * moves lastSeen forward, so concurrent heartbeats leave the latest one stored. Everything
 * else is delegated to ChatModel, whose operations are atomic.
 */
export class ChatController {
  /** A user counts as online if their app sent a heartbeat this recently. */
  static readonly ONLINE_WINDOW_MS = 30 * 1000;
  /** Heartbeats closer together than this are not stored, to save database writes. */
  static readonly HEARTBEAT_GRANULARITY_MS = 10 * 1000;

  constructor(
    private readonly chatModel: ChatModel,
    private readonly table: Table,
    private readonly clock: Clock,
    private readonly publisher?: EventPublisher,
    private readonly reports?: ReportModel,
  ) {}

  /**
   * Satisfies: R-HOME-23.
   *
   * Requires: userA and userB belong to existing accounts that both confirmed a match.
   * Effects: the chat between them is stored in ChatModel if it was not already.
   * @returns the chat's ID
   */
  openChat(userA: string, userB: string): Promise<string> {
    return this.chatModel.createChat(userA, userB);
  }

  /**
   * Satisfies: R-CHAT-13 (server side).
   *
   * Requires: chatId names an existing chat; senderId is a participant; text is non-empty.
   * Effects: stores the message in ChatModel, time-stamped with the current time, and, if a
   *          publisher was given, announces it so the other participant can be notified.
   * @returns the stored message
   */
  async sendMessage(chatId: string, senderId: string, text: string): Promise<ChatMessage> {
    const message = await this.chatModel.addMessage(chatId, { senderId, text, timestamp: this.clock() });
    await this.publisher?.publish({
      type: 'MESSAGE',
      toUserId: otherOfPair(chatId, senderId),
      fromUserId: senderId,
      chatId,
      preview: previewOf(message.text),
    });
    return message;
  }

  /**
   * Satisfies: R-CHAT-01.
   *
   * Requires: chatId names an existing chat; userId is a participant who has not removed or
   *           reported it.
   * Effects: none.
   * @param since return only messages with a later timestamp (default: all)
   * @returns the chat with those messages, oldest first
   * @throws AppError 404 if there is no such chat or userId removed or reported it;
   *         403 if userId is not a participant
   */
  getChat(chatId: string, userId: string, since?: number): Promise<Chat> {
    return this.chatModel.getChat(chatId, { since, viewer: userId });
  }

  /**
   * Satisfies: R-CHAT-01.
   *
   * Requires: chatId names an existing chat; userId is a participant. (Stubs v2 had no
   *           userId parameter; it is needed to refuse non-participants.)
   * Effects: none.
   * @returns the chat's full message history, oldest first
   */
  async getHistory(chatId: string, userId: string): Promise<readonly ChatMessage[]> {
    return (await this.getChat(chatId, userId)).messages;
  }

  /**
   * Satisfies: R-CHAT-02.
   *
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns every chat in the user's message log, most recent activity first
   */
  getChatLog(userId: string): Promise<ChatSummary[]> {
    return this.chatModel.getChatsForUser(userId);
  }

  /**
   * Requires: chatId names an existing chat; userId is a participant.
   * Effects: the chat is removed from the user's message log in ChatModel.
   */
  removeChatFromLog(userId: string, chatId: string): Promise<void> {
    return this.chatModel.removeChatForUser(chatId, userId);
  }

  /**
   * Handles the report button.
   * Satisfies: R-CHAT-15, R-CHAT-16.
   *
   * Requires: chatId names an existing chat; userId is a participant.
   * Effects: flags the chat in ChatModel and removes it from userId's message log. If a
   *          ReportModel was given, also files a report about the other participant, so
   *          admins see it (OPEN-18); a repeated report changes nothing.
   */
  async reportChat(userId: string, chatId: string): Promise<void> {
    await this.chatModel.flagChat(chatId, userId);
    await this.chatModel.removeChatForUser(chatId, userId);
    await this.reports?.file({
      reporterId: userId,
      reportedId: otherOfPair(chatId, userId),
      source: 'CHAT',
      reason: 'REPORTED_IN_CHAT',
      contextId: chatId,
    });
  }

  /**
   * The client calls this every few seconds while the app is open (the chat polling call
   * does it too).
   *
   * Requires: userId belongs to a logged-in user.
   * Effects: the user's last-seen time becomes `at` if none is stored or `at` is at least
   *          HEARTBEAT_GRANULARITY_MS later than the stored one; otherwise nothing changes.
   *          (Stubs v2 stored every later heartbeat; skipping close ones keeps a 3-second
   *          poll from costing a database write each time, and cannot make an online user
   *          look offline because the granularity is well under ONLINE_WINDOW_MS.)
   */
  async recordHeartbeat(userId: string, at: number): Promise<void> {
    await updateItem(this.table, presenceKey(userId), (current) => {
      const fresh =
        current !== undefined && at - (current.lastSeen as number) < ChatController.HEARTBEAT_GRANULARITY_MS;
      return fresh ? { result: undefined } : { attrs: { lastSeen: at }, result: undefined };
    });
  }

  /**
   * Drives the green online dot.
   * Satisfies: R-CHAT-06.
   *
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns true iff the user's last stored heartbeat was at most ONLINE_WINDOW_MS before now
   */
  async isUserOnline(userId: string, now: number): Promise<boolean> {
    const presence = await this.table.get(presenceKey(userId));
    return presence !== undefined && now - (presence.lastSeen as number) <= ChatController.ONLINE_WINDOW_MS;
  }
}
