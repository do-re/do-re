/**
 * The client half of each controller (architecture.md: "controllers are communicators between
 * front and backend"). Views depend only on these interfaces, so the in-memory mock
 * (mock.ts) can be swapped for the HTTP client that talks to Felix's Lambdas without
 * touching any view.
 *
 * Each method mirrors the Java stub method of the same name and keeps its spec; the only
 * difference is that results arrive asynchronously. Server-only methods
 * (sendConfirmationEmail, getTasteVector, onAppOpened) are not exposed to the browser.
 */
import type {
  CreateAccountResult,
  Feedback,
  LoginResponse,
  Match,
  Song,
  SwipeResult,
  UserProfile,
} from './types';

/** Client half of AccountController (owner: Gavin, with Felix). */
export interface AccountApi {
  /**
   * Satisfies: R-ACC-03, R-ACC-04.
   * Requires: none.
   * Effects: none.
   * @param email the submitted email
   * @param password the submitted password
   * @returns SUCCESS (with the user ID) if valid and verified; NOT_VERIFIED if valid but
   *          unverified; WRONG_PASSWORD if the email exists but the password differs;
   *          NO_ACCOUNT if no account uses the email
   */
  login(email: string, password: string): Promise<LoginResponse>;

  /**
   * Satisfies: R-ACC-02, R-ACC-08, R-ACC-09, R-SEC-01.
   * Requires: none.
   * Effects: if email is well-formed, password is non-empty, password equals confirmPassword
   *          and the email is unused, creates an inactive account and sends a confirmation
   *          email; otherwise nothing changes.
   * @returns INVALID_EMAIL, else PASSWORDS_DO_NOT_MATCH, else EMAIL_IN_USE, else
   *          PENDING_VERIFICATION (checked in that order)
   */
  createAccount(email: string, password: string, confirmPassword: string): Promise<CreateAccountResult>;

  /**
   * Requires: email belongs to an existing account.
   * Effects: none.
   * @returns true iff the account's email has been verified
   */
  isVerified(email: string): Promise<boolean>;

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns the account's username and profile picture
   */
  getProfile(userId: string): Promise<UserProfile>;

  /**
   * Requires: userId belongs to an existing account; newUsername is non-empty.
   * Effects: the stored username becomes newUsername.
   */
  updateUsername(userId: string, newUsername: string): Promise<void>;

  /**
   * WEB: takes a Blob (the uploaded File) instead of byte[].
   * Requires: userId belongs to an existing account; image is a non-empty image file.
   * Effects: the stored profile picture becomes image.
   */
  updateProfilePicture(userId: string, image: Blob): Promise<void>;
}

/** Client half of SongController (owners: Gavin & Yara, with Felix). */
export interface SongApi {
  /**
   * Satisfies: R-HOME-03.
   * Requires: userId belongs to a logged-in user.
   * Effects: if no song is active, makes the next suggestion the active song.
   * @returns the song currently active for this user
   */
  getCurrentSong(userId: string): Promise<Song>;

  /**
   * Satisfies: R-HOME-25.
   * Requires: userId is logged in; songId is the user's active song.
   * Effects: the active song is marked liked (idempotent); playback is unaffected.
   */
  markLiked(userId: string, songId: string): Promise<void>;

  /**
   * Satisfies: R-HOME-15, R-HOME-17, R-HOME-19.
   * Requires: userId is logged in; songId is the user's active song;
   *           0 <= secondsListened <= that song's duration.
   * Effects: records the listen (LIKE if swipe is LIKE or the song was marked liked),
   *          advances to the next song, and may offer a match.
   * @returns the new active song and the offered match, if any
   */
  submitFeedback(userId: string, songId: string, swipe: Feedback, secondsListened: number): Promise<SwipeResult>;
}

/** Client half of MatchController (owner: Gavin, derived). */
export interface MatchApi {
  /**
   * Satisfies: R-HOME-20.
   * Requires: userId is logged in.
   * Effects: none.
   * @returns matches proposed to userId that userId has not answered yet
   */
  getPendingMatches(userId: string): Promise<Match[]>;

  /**
   * WEB: added so MatchView can load a match from its URL (/match/:matchId) after a refresh.
   * Requires: userId is logged in.
   * Effects: none.
   * @returns the match with this ID if userId is one of its users, otherwise null
   */
  getMatch(matchId: string, userId: string): Promise<Match | null>;

  /**
   * Requires: userId is one of match's users.
   * Effects: none.
   * @returns the other user's profile
   */
  getOtherProfile(match: Match, userId: string): Promise<UserProfile>;

  /**
   * Satisfies: R-HOME-21, R-HOME-23.
   * Requires: userId is one of match's users.
   * Effects: records the confirmation; if that completes the match, exactly one chat is created.
   * @returns the chat ID, or null if the other user has not confirmed yet (OPEN-4)
   */
  confirmMatch(match: Match, userId: string): Promise<string | null>;

  /**
   * Satisfies: R-HOME-21, R-HOME-22.
   * Requires: userId is one of match's users.
   * Effects: records the decline; the pair is never proposed again.
   */
  declineMatch(match: Match, userId: string): Promise<void>;
}

/** Everything the views can call. Provided to the component tree by ApiProvider. */
export interface Api {
  readonly account: AccountApi;
  readonly songs: SongApi;
  readonly matches: MatchApi;
}
