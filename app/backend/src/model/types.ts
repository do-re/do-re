import { AudioFeatures } from './vectors';

/**
 * A playable song, one row of the song library file (exported from Chosic). Immutable.
 *
 * Rep invariant: id, title, artist and albumCoverUrl are non-empty; durationSeconds is finite
 *   and > 0; spotifyUri == "spotify:track:" + id; features is an AudioFeatures (R-HOME-11).
 */
export interface Song {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly durationSeconds: number;
  readonly albumCoverUrl: string;
  readonly spotifyUri: string;
  readonly features: AudioFeatures;
}

/**
 * Creates a Song, checking its rep invariant.
 * Satisfies: R-HOME-11.
 *
 * Requires: fields satisfy the Song rep invariant.
 * Effects: none.
 * @returns a frozen Song with these fields
 * @throws RangeError naming the first field that breaks the rep invariant
 */
export function makeSong(fields: Song): Song {
  for (const name of ['id', 'title', 'artist', 'albumCoverUrl'] as const) {
    if (typeof fields[name] !== 'string' || fields[name] === '') {
      throw new RangeError(`song ${name} must be non-empty`);
    }
  }
  if (!Number.isFinite(fields.durationSeconds) || fields.durationSeconds <= 0) {
    throw new RangeError('song durationSeconds must be greater than 0');
  }
  if (fields.spotifyUri !== `spotify:track:${fields.id}`) {
    throw new RangeError('song spotifyUri must be "spotify:track:<id>"');
  }
  if (!(fields.features instanceof AudioFeatures)) {
    throw new RangeError('song features must be AudioFeatures');
  }
  return Object.freeze({ ...fields });
}

/** How the user reacted to a song. */
export type Feedback = 'LIKE' | 'SKIP';

/**
 * One listen of a song.
 * Rep invariant: 0 <= secondsListened <= song.durationSeconds; time is epoch milliseconds.
 */
export interface ListeningEvent {
  readonly song: Song;
  readonly feedback: Feedback;
  readonly secondsListened: number;
  readonly time: number;
}

/**
 * Public profile information for one account.
 * Changed from stubs v2 (byte[] profilePicture): browsers show images by URL, so the picture
 * is stored in S3 and the profile carries its URL (api.md Q-2). null until one is set.
 */
export interface UserProfile {
  readonly userId: string;
  readonly username: string;
  readonly profilePictureUrl: string | null;
}

/** A message about to be stored: who sent it, what it says, and when (epoch milliseconds). */
export interface NewChatMessage {
  readonly senderId: string;
  readonly text: string;
  readonly timestamp: number;
}

/** A stored chat message. seq is its 1-based position in its chat. */
export interface ChatMessage extends NewChatMessage {
  readonly seq: number;
}

/**
 * A conversation between two matched users.
 * Rep invariant: userA < userB; messages are in increasing seq order with non-decreasing
 *   timestamps.
 */
export interface Chat {
  readonly chatId: string;
  readonly userA: string;
  readonly userB: string;
  readonly messages: readonly ChatMessage[];
}

/** A chat as listed in the message log: its participants and time of latest activity. */
export interface ChatSummary {
  readonly chatId: string;
  readonly userA: string;
  readonly userB: string;
  /** The latest message, or undefined if the chat has none yet. */
  readonly lastMessage: ChatMessage | undefined;
  /** The latest message's time, or the chat's creation time if it has none. */
  readonly lastActivity: number;
}

/**
 * A proposed match between two users.
 * Rep invariant: userA < userB; matchId == pairId(userA, userB);
 *   0 <= compatibilityPercent <= 100.
 */
export interface Match {
  readonly matchId: string;
  readonly userA: string;
  readonly userB: string;
  readonly compatibilityPercent: number;
}

/** What HomeView gets back after a swipe: the next song, plus a match to show if one was offered. */
export interface SwipeResult {
  readonly nextSong: Song;
  readonly offeredMatch: Match | undefined;
}

/** What the undo button gets back: the previous song, restored as the active one. */
export interface UndoResult {
  readonly song: Song;
  /** Whether the like button was on for this song when the user left it. */
  readonly liked: boolean;
  /** Whether there is another swipe to undo. */
  readonly canUndo: boolean;
}

/** SUSPENDED was added with the admin panel (OPEN-18). */
export type LoginResult = 'SUCCESS' | 'WRONG_PASSWORD' | 'NO_ACCOUNT' | 'NOT_VERIFIED' | 'SUSPENDED';

export type CreateAccountResult =
  | 'PENDING_VERIFICATION'
  | 'EMAIL_IN_USE'
  | 'INVALID_EMAIL'
  | 'PASSWORDS_DO_NOT_MATCH';

/**
 * Requires: userId is pair.userA or pair.userB (callers check this first).
 * @returns the other user of the pair
 */
export function otherUser(pair: { readonly userA: string; readonly userB: string }, userId: string): string {
  return pair.userA === userId ? pair.userB : pair.userA;
}
