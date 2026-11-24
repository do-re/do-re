/**
 * Client-side mirrors of the shared records in architecture-stubs-v2.java.
 *
 * Java enums become string unions (the tsconfig uses erasableSyntaxOnly, which forbids TS enums).
 * Deviations from the Java stubs are marked "WEB:" and need a heads-up to Felix (backend owner).
 */

/** Number of Audio Features per song and entries in a Taste Vector (R-HOME-11, R-HOME-17). */
export const FEATURE_COUNT = 7;

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

/** Mirrors the Java `LoginResult` enum. */
export type LoginResult = 'SUCCESS' | 'WRONG_PASSWORD' | 'NO_ACCOUNT' | 'NOT_VERIFIED';

/**
 * WEB: the stub's `login` returns only a LoginResult and the view then calls `getUserId`.
 * Over HTTP one round trip is better, so a successful login also carries the user ID
 * (and later, a session token from Felix's auth design).
 */
export type LoginResponse =
  | { readonly result: 'SUCCESS'; readonly userId: string }
  | { readonly result: Exclude<LoginResult, 'SUCCESS'> };

/** Mirrors the Java `CreateAccountResult` enum. */
export type CreateAccountResult =
  | 'PENDING_VERIFICATION'
  | 'EMAIL_IN_USE'
  | 'INVALID_EMAIL'
  | 'PASSWORDS_DO_NOT_MATCH';
