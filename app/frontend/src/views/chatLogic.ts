/**
 * Pure logic behind MessageLogView and ChatView, kept apart so it gets white-box tests.
 */
import { ApiError } from '../api/apiErrors';
import type { ChatMessage, ChatSummary } from '../api/types';

/** How often an open chat fetches history; the same call is the heartbeat (architecture.md). */
export const CHAT_POLL_MS = 3000;
/** How often the chat list refreshes, so a newly confirmed match appears (notes-for-yara Y-6). */
export const LOG_POLL_MS = 5000;
/** Messages by one sender at most this far apart share a picture (R-CHAT-09). */
export const GROUP_WINDOW_MS = 60_000;
/**
 * Each poll re-asks for this much recent history. A message stamped just before a poll can be
 * saved just after it, and asking only for "since the last poll" would then miss it for good.
 * mergeMessages drops the repeats.
 */
export const POLL_OVERLAP_MS = 5000;

/**
 * Stub ChatView.startsNewGroup.
 * Satisfies: R-CHAT-09.
 * Requires: if previous is non-null, it is the message directly before current in the chat.
 * Effects: none.
 * @param previous the message before current, or null if current is the first
 * @param current the message being drawn
 * @returns true iff previous is null, or was sent by a different user, or current was sent more
 *          than 60 seconds after previous
 */
export function startsNewGroup(previous: ChatMessage | null, current: ChatMessage): boolean {
  if (previous === null || previous.senderId !== current.senderId) return true;
  return Date.parse(current.timestamp) - Date.parse(previous.timestamp) > GROUP_WINDOW_MS;
}

/**
 * Satisfies: R-CHAT-01 (a poll or a send never duplicates or reorders messages).
 * Requires: existing is sorted oldest first and has unique message IDs.
 * Effects: none.
 * @returns existing plus every incoming message with a new ID, oldest first; equal timestamps keep
 *          their arrival order. Returns existing itself if nothing is new.
 */
export function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): readonly ChatMessage[] {
  const seen = new Set(existing.map((m) => m.messageId));
  const added: ChatMessage[] = [];
  for (const message of incoming) {
    if (seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    added.push(message);
  }
  if (added.length === 0) return existing;
  return [...existing, ...added].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/**
 * Requires: serverTime is a valid ISO-8601 time.
 * Effects: none.
 * @returns the `since` value for the next poll: serverTime minus POLL_OVERLAP_MS
 */
export function nextSince(serverTime: string): string {
  return new Date(Date.parse(serverTime) - POLL_OVERLAP_MS).toISOString();
}

/**
 * Satisfies: R-CHAT-13 (empty text does nothing).
 * Requires: none.
 * Effects: none.
 * @returns the trimmed text, or null if there is nothing to send
 */
export function normalizeDraft(draft: string): string | null {
  const trimmed = draft.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Requires: none.
 * Effects: none.
 * @returns the text shown under a username in the chat list
 */
export function previewOf(chat: ChatSummary, selfId: string): string {
  if (chat.lastMessage === null) return 'No messages yet';
  return chat.lastMessage.senderId === selfId ? `You: ${chat.lastMessage.text}` : chat.lastMessage.text;
}

/**
 * Requires: none.
 * Effects: none.
 * @returns text telling the user what to do about error
 */
export function describeChatError(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

/** @returns true iff error means the user must log in again */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNAUTHENTICATED';
}

/** @returns true iff error means this chat is not available to this user */
export function isChatGone(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'CHAT_NOT_FOUND' || error.code === 'NOT_PARTICIPANT');
}
