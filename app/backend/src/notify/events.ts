import { z } from 'zod';

/**
 * Something a user should be told about while the app is closed.
 *   MATCH_OFFERED    another user's swipe produced a match with toUserId
 *   MATCH_COMPLETED  fromUserId confirmed a match toUserId had already confirmed; the chat exists
 *   MESSAGE          fromUserId sent toUserId a chat message; preview is its first characters
 */
export type NotificationEvent =
  | { readonly type: 'MATCH_OFFERED'; readonly toUserId: string; readonly fromUserId: string; readonly matchId: string }
  | { readonly type: 'MATCH_COMPLETED'; readonly toUserId: string; readonly fromUserId: string; readonly chatId: string }
  | {
      readonly type: 'MESSAGE';
      readonly toUserId: string;
      readonly fromUserId: string;
      readonly chatId: string;
      readonly preview: string;
    };

/** Longest message preview carried by an event and shown in a notification. */
export const PREVIEW_LENGTH = 80;

/**
 * Where controllers announce events. In production this is an SNS topic (SnsPublisher), so
 * the request that caused the event never waits for push delivery.
 */
export interface EventPublisher {
  /**
   * Effects: hands the event on for delivery. Best effort: never rejects; a failure is
   *          logged and the event is dropped, because a lost notification must not fail
   *          the swipe or message that caused it.
   */
  publish(event: NotificationEvent): Promise<void>;
}

const id = z.string().min(1).max(200);
const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MATCH_OFFERED'), toUserId: id, fromUserId: id, matchId: id }),
  z.object({ type: z.literal('MATCH_COMPLETED'), toUserId: id, fromUserId: id, chatId: id }),
  z.object({ type: z.literal('MESSAGE'), toUserId: id, fromUserId: id, chatId: id, preview: z.string().max(PREVIEW_LENGTH + 1) }),
]);

/**
 * @param text the body of a message received from the event topic
 * @returns the event it encodes, or undefined if text is not a valid event (anything can be
 *          published to a topic, so the notifier checks what it receives)
 */
export function parseEvent(text: string): NotificationEvent | undefined {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param text a chat message
 * @returns text if it is at most PREVIEW_LENGTH characters, otherwise its first
 *          PREVIEW_LENGTH characters followed by "…"
 */
export function previewOf(text: string): string {
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH)}…`;
}
