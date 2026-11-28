import { type Clock, pairId } from '../deps';
import { badRequest, chatNotFound, notParticipant } from '../errors';
import type { Chat, ChatMessage, ChatSummary, NewChatMessage } from '../model/types';
import { type Attributes, attributesOf, type Item, type Key, type Table, updateItem } from '../store/Table';

const chatPk = (chatId: string) => `CHAT#${chatId}`;
const metaKey = (chatId: string): Key => ({ pk: chatPk(chatId), sk: 'META' });
/** Sorts by time, then seq. Timestamps never decrease with seq, so this is also seq order. */
const messageSk = (timestamp: number, seq: number) =>
  `MSG#${String(timestamp).padStart(15, '0')}#${String(seq).padStart(10, '0')}`;
const pointerKey = (userId: string, chatId: string): Key => ({ pk: `USER#${userId}`, sk: `CHAT#${chatId}` });

/**
 * ChatModel: stores every chat, each with its time-stamped, message-by-message history, and
 * flags reported chats.
 * Resides on: server. Communicates with: ChatController.
 *
 * Stored state:
 *   CHAT#<id> / META             userA, userB, createdAt, lastSeq, lastTimestamp, lastMessage?,
 *                                flagged, reports [{reporterId, at}], hiddenFor [userId]
 *   CHAT#<id> / MSG#<15-digit timestamp>#<10-digit seq>   seq, senderId, text, timestamp
 *   USER#<userId> / CHAT#<id>    (one per participant: the user's list of chats)
 * A chat's ID is pairId(userA, userB).
 *
 * Abstraction function: AF(table) = the set of chats, one per META item, each with the
 *   messages stored under it in seq order, its report flag, and the users who removed it
 *   from their log.
 * Rep invariant (database integrity, testing.md proof 1): at most one chat per pair of
 *   users; userA < userB; the messages of a chat have seq 1..lastSeq with no gaps or
 *   repeats; timestamps are non-decreasing in seq and lastTimestamp is the latest (or
 *   createdAt if there are no messages).
 *
 * Concurrency: requests run on separate Lambda instances, so atomicity comes from DynamoDB.
 *  - createChat writes META and both pointers in one atomic write that requires them to be
 *    absent. Concurrent calls for one pair create one chat and all return the same ID.
 *  - addMessage reads META, then in one atomic write stores message lastSeq + 1 (required
 *    absent) and advances META (required unchanged since the read). If both participants
 *    send at once, one write applies; the other fails, re-reads and takes the next seq. So
 *    no message is lost or overwritten, seq numbers have no gaps, and because the timestamp
 *    stored is max(message time, lastTimestamp), order by seq is also order by time even if
 *    the instances' clocks disagree.
 *  - A reader sees each message entirely or not at all (it is a single item), and always a
 *    prefix of the history, because seq numbers are assigned in order.
 *  - flagChat and removeChatForUser are read-modify-writes of META through updateItem.
 */
export class ChatModel {
  static readonly MAX_TEXT_LENGTH = 2000;

  constructor(
    private readonly table: Table,
    private readonly clock: Clock,
  ) {}

  /**
   * Satisfies: R-HOME-23.
   *
   * Requires: userA and userB belong to existing accounts; userA != userB.
   * Effects: if the two users have no chat, stores a new chat between them with an empty
   *          history; otherwise changes nothing. (Changed from stubs v2, which always made a
   *          new chat: one chat per pair is what makes "exactly one chat per match" hold.)
   * @returns the ID of the chat between the two users (the same for either argument order)
   * @throws AppError 400 if userA equals userB
   */
  async createChat(userA: string, userB: string): Promise<string> {
    if (userA === userB) {
      throw badRequest('A chat needs two different users.');
    }
    const chatId = pairId(userA, userB);
    const [lo, hi] = chatId.split('_') as [string, string];
    const now = this.clock();
    const meta = { userA: lo, userB: hi, createdAt: now, lastSeq: 0, lastTimestamp: now, flagged: false, reports: [], hiddenFor: [] };
    await this.table.write([
      { op: 'put', item: { ...metaKey(chatId), version: 1, ...meta }, expect: 'absent' },
      { op: 'put', item: { ...pointerKey(lo, chatId), version: 1 }, expect: 'absent' },
      { op: 'put', item: { ...pointerKey(hi, chatId), version: 1 }, expect: 'absent' },
    ]);
    return chatId;
  }

  /**
   * Satisfies: R-CHAT-13 (server side).
   *
   * Requires: chatId names an existing chat; message.senderId is a participant who has not
   *           removed or reported the chat; message.text, once trimmed, is non-empty and at
   *           most MAX_TEXT_LENGTH characters.
   * Effects: appends the trimmed message to the end of the chat's history, with the next seq and with
   *          timestamp max(message.timestamp, the chat's latest timestamp). (Changed from
   *          stubs v2, which required the caller's timestamp not to be earlier than the last
   *          message; the model now guarantees the order itself.)
   * @returns the message as stored
   * @throws AppError 400 EMPTY_MESSAGE or MESSAGE_TOO_LONG if the text is not acceptable;
   *         404 if there is no such chat or the sender removed or reported it (api.md Q-9);
   *         403 if the sender is not a participant
   */
  async addMessage(chatId: string, message: NewChatMessage): Promise<ChatMessage> {
    const text = message.text.trim();
    if (text === '') {
      throw badRequest('Write a message before sending.', 'EMPTY_MESSAGE');
    }
    if (text.length > ChatModel.MAX_TEXT_LENGTH) {
      throw badRequest(`Keep messages to ${ChatModel.MAX_TEXT_LENGTH} characters or fewer.`, 'MESSAGE_TOO_LONG');
    }
    return this.updateMeta(chatId, message.senderId, (meta) => {
      if ((meta.hiddenFor as string[]).includes(message.senderId)) {
        throw chatNotFound();
      }
      const stored: ChatMessage = {
        seq: (meta.lastSeq as number) + 1,
        senderId: message.senderId,
        text,
        timestamp: Math.max(message.timestamp, meta.lastTimestamp as number),
      };
      const item = { pk: chatPk(chatId), sk: messageSk(stored.timestamp, stored.seq), version: 1, ...stored };
      return {
        attrs: { ...meta, lastSeq: stored.seq, lastTimestamp: stored.timestamp, lastMessage: stored },
        also: [{ op: 'put', item, expect: 'absent' }],
        result: stored,
      };
    });
  }

  /**
   * Satisfies: R-CHAT-01.
   *
   * Requires: chatId names an existing chat; options.viewer, if given, is a participant who
   *           has not removed or reported the chat.
   * Effects: none.
   * @param options.since  return only messages with a later timestamp (default: all). Added
   *                       to stubs v2 so a poll reads only what is new (api.md Q-4).
   * @param options.viewer the user the chat is fetched for; omit for no access check
   * @returns the chat, with those messages in increasing seq (and so timestamp) order
   * @throws AppError 404 if there is no such chat or the viewer removed or reported it
   *         (api.md Q-9); 403 if the viewer is not a participant
   */
  async getChat(chatId: string, options: { since?: number; viewer?: string } = {}): Promise<Chat> {
    const { since, viewer } = options;
    // Everything stamped `since` or earlier sorts at or before this key.
    const after = since === undefined ? undefined : messageSk(since, 9_999_999_999);
    const [meta, items] = await Promise.all([
      this.table.get(metaKey(chatId)),
      this.table.query(chatPk(chatId), { prefix: 'MSG#', after }),
    ]);
    const { userA, userB, hiddenFor } = requireChat(meta);
    if (viewer !== undefined) {
      if (userA !== viewer && userB !== viewer) {
        throw notParticipant('You are not part of that chat.');
      }
      if ((hiddenFor as string[]).includes(viewer)) {
        throw chatNotFound();
      }
    }
    const messages = items.map((item) => ({
      seq: item.seq as number,
      senderId: item.senderId as string,
      text: item.text as string,
      timestamp: item.timestamp as number,
    }));
    return { chatId, userA: userA as string, userB: userB as string, messages };
  }

  /**
   * Satisfies: R-CHAT-02, R-CHAT-15.
   *
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns every chat the user participates in and has neither removed from nor reported
   *          out of their log, ordered by the time of the chat's latest message (or its
   *          creation time if it has none), most recent first. Summaries only: use getChat
   *          for messages. (Stubs v2 returned whole chats.)
   */
  async getChatsForUser(userId: string): Promise<ChatSummary[]> {
    const pointers = await this.table.query(`USER#${userId}`, { prefix: 'CHAT#' });
    const metas = await Promise.all(pointers.map((pointer) => this.table.get({ pk: pointer.sk, sk: 'META' })));
    return metas
      .filter((meta) => meta !== undefined)
      .filter((meta) => !(meta.hiddenFor as string[]).includes(userId))
      .map((meta) => ({
        chatId: meta.pk.slice('CHAT#'.length),
        userA: meta.userA as string,
        userB: meta.userB as string,
        lastMessage: meta.lastMessage as ChatMessage | undefined,
        lastActivity: meta.lastTimestamp as number,
      }))
      .sort((a, b) => b.lastActivity - a.lastActivity || (a.chatId < b.chatId ? -1 : 1));
  }

  /**
   * Requires: chatId names an existing chat; userId is a participant.
   * Effects: the chat no longer appears in getChatsForUser(userId).
   * @throws AppError 404 if there is no such chat; 403 if userId is not a participant
   */
  async removeChatForUser(chatId: string, userId: string): Promise<void> {
    await this.updateMeta(chatId, userId, (meta) => {
      const hiddenFor = meta.hiddenFor as string[];
      return hiddenFor.includes(userId)
        ? { result: undefined }
        : { attrs: { ...meta, hiddenFor: [...hiddenFor, userId] }, result: undefined };
    });
  }

  /**
   * Marks a chat as reported, for moderation.
   * Satisfies: R-CHAT-16.
   *
   * Requires: chatId names an existing chat; reporterId is a participant.
   * Effects: isFlagged(chatId) is true afterwards; records reporterId and the current time.
   * @throws AppError 404 if there is no such chat; 403 if reporterId is not a participant
   */
  async flagChat(chatId: string, reporterId: string): Promise<void> {
    await this.updateMeta(chatId, reporterId, (meta) => {
      const reports = [...(meta.reports as object[]), { reporterId, at: this.clock() }];
      return { attrs: { ...meta, flagged: true, reports }, result: undefined };
    });
  }

  /**
   * Requires: chatId names an existing chat.
   * Effects: none.
   * @returns true iff any participant has reported the chat
   * @throws AppError 404 if there is no such chat
   */
  async isFlagged(chatId: string): Promise<boolean> {
    return requireChat(await this.table.get(metaKey(chatId))).flagged === true;
  }

  /**
   * Effects: none.
   * @returns true iff chatId names an existing chat, userId is one of its participants, and
   *          userId has neither removed nor reported it (so it is in their message log)
   */
  async isVisibleTo(chatId: string, userId: string): Promise<boolean> {
    const meta = await this.table.get(metaKey(chatId));
    const participant = meta !== undefined && (meta.userA === userId || meta.userB === userId);
    return participant && !(meta.hiddenFor as string[]).includes(userId);
  }

  /** Atomic read-modify-write of a chat's META item on behalf of a participant. */
  private updateMeta<T>(
    chatId: string,
    participant: string,
    decide: (meta: Attributes) => { attrs?: Attributes; also?: Parameters<Table['write']>[0]; result: T },
  ): Promise<T> {
    return updateItem(this.table, metaKey(chatId), (current) => {
      const meta = requireChat(current);
      if (meta.userA !== participant && meta.userB !== participant) {
        throw notParticipant('You are not part of that chat.');
      }
      return decide(attributesOf(meta));
    });
  }
}

function requireChat(meta: Item | undefined): Item {
  if (meta === undefined) {
    throw chatNotFound();
  }
  return meta;
}
