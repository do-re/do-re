/**
 * Client-side mirrors of the shared records in architecture-stubs-v2.java.
 *
 * Java enums become string unions (the tsconfig uses erasableSyntaxOnly, which forbids TS enums).
 * Deviations from the Java stubs are marked "WEB:" and need a heads-up to Felix (backend owner).
 */

/** Number of Audio Features per song and entries in a Taste Vector (R-HOME-11, R-HOME-17). */
export const FEATURE_COUNT = 7;

/** What each Audio Feature index means, using Chosic's names ("Happiness" is valence). */
export const FEATURE_NAMES = [
  'Happiness',
  'Danceability',
  'Energy',
  'Acousticness',
  'Instrumentalness',
  'Liveness',
  'Speechiness',
] as const;

/**
 * A song in the library. Mirrors the Java `Song` record.
 * Rep invariant: durationSeconds > 0; spotifyUri starts with "spotify:track:";
 * features has exactly FEATURE_COUNT entries, each in [0, 1].
 */
export interface Song {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly durationSeconds: number;
  readonly albumCoverUrl: string;
  readonly spotifyUri: string;
  readonly features: readonly number[];
}

/**
 * Public profile of one account. Mirrors the Java `UserProfile` record.
 * WEB: the stub holds `byte[] profilePicture`; a browser shows images by URL, so the API
 * returns `profilePictureUrl` (null when the user has no picture yet).
 */
export interface UserProfile {
  readonly userId: string;
  readonly username: string;
  readonly profilePictureUrl: string | null;
}

/** How the user reacted to a song. Mirrors the Java `Feedback` enum. */
export type Feedback = 'LIKE' | 'SKIP';

/**
 * A proposed match. Mirrors the Java `Match` record.
 * Rep invariant: userA !== userB; 0 <= compatibilityPercent <= 100.
 */
export interface Match {
  readonly matchId: string;
  readonly userA: string;
  readonly userB: string;
  readonly compatibilityPercent: number;
}

/**
 * What HomeView gets back after a swipe. Mirrors the Java `SwipeResult` record
 * (`Optional<Match>` becomes `Match | null`).
 */
export interface SwipeResult {
  readonly nextSong: Song;
  readonly offeredMatch: Match | null;
}

/** WEB: what the undo button gets back: the previous song, restored as the active one. */
export interface UndoResult {
  readonly song: Song;
  /** Whether the like button was on for this song when the user left it. */
  readonly liked: boolean;
  /** Whether there is another song to go back to. */
  readonly canUndo: boolean;
}

/** Mirrors the Java `LoginResult` enum. */
export type LoginResult = 'SUCCESS' | 'WRONG_PASSWORD' | 'NO_ACCOUNT' | 'NOT_VERIFIED';

/**
 * WEB: the stub's `login` returns only a LoginResult and the view then calls `getUserId`.
 * Over HTTP one round trip is better, so a successful login also carries the user ID and the
 * session token that authenticates later requests (api.md Q-1).
 */
export type LoginResponse =
  | { readonly result: 'SUCCESS'; readonly userId: string; readonly token: string }
  | { readonly result: Exclude<LoginResult, 'SUCCESS'> };

/** Mirrors the Java `CreateAccountResult` enum. */
export type CreateAccountResult =
  | 'PENDING_VERIFICATION'
  | 'EMAIL_IN_USE'
  | 'INVALID_EMAIL'
  | 'PASSWORDS_DO_NOT_MATCH';

/** Longest message the client will send (proposal, api.md Q-5). */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * One chat message. Mirrors the Java `ChatMessage` record.
 * WEB: adds `messageId` so polling can de-duplicate (api.md Q-3, pending Felix); `timestamp` is
 * an ISO-8601 UTC string set by the server.
 * Rep invariant: text is non-empty.
 */
export interface ChatMessage {
  readonly messageId: string;
  readonly senderId: string;
  readonly text: string;
  readonly timestamp: string;
}

/** One row of the caller's message log (api.md `GET /chats`). */
export interface ChatSummary {
  readonly chatId: string;
  readonly otherUser: UserProfile;
  /** Null if the chat has no messages yet. */
  readonly lastMessage: ChatMessage | null;
  /** The last message's time, or the chat's creation time if it has none. */
  readonly lastActivityAt: string;
}

/** A chat's messages plus presence (api.md `GET /chats/{chatId}/messages`). */
export interface ChatHistory {
  readonly chatId: string;
  readonly otherUser: UserProfile;
  readonly otherUserOnline: boolean;
  /** Oldest first. */
  readonly messages: readonly ChatMessage[];
  readonly serverTime: string;
}
