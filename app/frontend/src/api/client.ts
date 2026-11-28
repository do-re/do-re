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
  AdminReport,
  AdminUser,
  AuditEntry,
  ChatHistory,
  ChatMessage,
  ChatSummary,
  CreateAccountResult,
  Feedback,
  LoginResponse,
  Match,
  OutgoingMatch,
  ReportReason,
  Song,
  SwipeResult,
  UndoResult,
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
   * WEB: ends the session on the server, so the token stops working even if someone copied it.
   * Requires: the user is logged in.
   * Effects: the current session token is no longer valid.
   */
  logout(): Promise<void>;

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
   * Handles a click on the link in a confirmation email (the /verify page).
   * Satisfies: R-SEC-02.
   * Requires: none.
   * Effects: if token is the valid, unused token for userId, activates the account and consumes
   *          the token; otherwise nothing changes.
   * @returns true iff the account was activated
   */
  confirmEmail(userId: string, token: string): Promise<boolean>;

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

  /**
   * WEB: tells the undo button whether it can be used.
   * Requires: userId is logged in.
   * Effects: none.
   * @returns true iff undoLastSwipe would go back to a song
   */
  canUndo(userId: string): Promise<boolean>;

  /**
   * WEB: the undo button. Reverses the user's latest swipe, so a song swiped again counts once.
   * A match already offered by that swipe stays.
   * Requires: userId is logged in.
   * Effects: if there is a swipe to undo, its song becomes active again, the listen is removed
   *          from the history and Taste Vector, the swipe count goes back by one, and the song
   *          that was active returns to the front of the suggestions. Otherwise nothing changes.
   * @returns the restored song, or null if there is nothing to undo
   */
  undoLastSwipe(userId: string): Promise<UndoResult | null>;

  /**
   * WEB: for developer mode (stub SongController.getTasteVector).
   * Requires: userId is logged in.
   * Effects: none.
   * @returns the user's 7-number Taste Vector
   */
  getTasteVector(userId: string): Promise<readonly number[]>;
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
   * @returns the match with this ID if it is still waiting for userId's answer, otherwise null
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

  /**
   * WEB: the "Waiting for an answer" list on the Messages page.
   * Requires: userId is logged in.
   * Effects: none.
   * @returns matches userId said yes to that the other person has not answered, best match first
   */
  getOutgoingMatches(userId: string): Promise<OutgoingMatch[]>;

  /**
   * WEB: takes back userId's yes to a match the other person has not answered.
   * Requires: userId confirmed match and the other user has not answered it.
   * Effects: the match is declined: the other person no longer sees it and the pair is never
   *          proposed again.
   * @throws ApiError (409) if the other person answered in the meantime
   */
  retractMatch(match: Match, userId: string): Promise<void>;

  /**
   * WEB: the Report button on the match screen (OPEN-18).
   * Requires: userId is one of match's users; details has at most MAX_REPORT_DETAILS characters.
   * Effects: files a report about the other user for the admins and declines the match, so the
   *          pair is not proposed again. Reporting the same person again changes nothing.
   */
  reportProfile(match: Match, userId: string, reason: ReportReason, details: string): Promise<void>;
}

/**
 * WEB: the admin page (owner: Felix; OPEN-18, api.md "Admin"). Every method requires adminId to be
 * an admin and rejects with a 403 ApiError (NOT_ADMIN) otherwise; the server checks, whatever the
 * page shows. adminId identifies the caller to the mock; the HTTP client sends only the token.
 */
export interface AdminApi {
  /** @returns every account, oldest first */
  listUsers(adminId: string): Promise<AdminUser[]>;

  /**
   * Requires: userId is another account that is not a root admin; reason is 1 to
   *           MAX_SUSPEND_REASON characters.
   * Effects: the account cannot log in, is logged out everywhere and leaves matching.
   */
  suspend(adminId: string, userId: string, reason: string): Promise<void>;

  /** Effects: the account can log in again. */
  unsuspend(adminId: string, userId: string): Promise<void>;

  /** Effects: the account's email counts as verified. */
  verify(adminId: string, userId: string): Promise<void>;

  /**
   * Requires: userId is another account that is not a root admin.
   * Effects: the account has admin rights iff admin is true.
   */
  setAdmin(adminId: string, userId: string, admin: boolean): Promise<void>;

  /** @returns every report, open ones first */
  listReports(adminId: string): Promise<AdminReport[]>;

  /** Effects: the report is marked handled by adminId, with the note. */
  resolveReport(adminId: string, reportId: string, note: string): Promise<void>;

  /** @returns the latest admin actions, newest first */
  auditLog(adminId: string): Promise<AuditEntry[]>;
}

/**
 * Client half of ChatController (owner: Yara, with Felix). Routes are in docs/project/api.md.
 *
 * Every method rejects with a ApiError on failure. The user ID arguments mirror the Java
 * stub and identify the caller to the mock; the HTTP client ignores them because the server
 * derives the caller from the session token.
 */
export interface ChatApi {
  /**
   * Satisfies: R-CHAT-01, R-CHAT-02.
   * Requires: userId is logged in.
   * Effects: records a heartbeat for userId.
   * @returns the chats in userId's log, most recent activity first
   */
  getChatLog(userId: string): Promise<ChatSummary[]>;

  /**
   * WEB: one call returns the history and the other user's presence, and is also the heartbeat.
   * Satisfies: R-CHAT-01, R-CHAT-03, R-CHAT-06.
   * Requires: userId is logged in; since, if given, is an ISO-8601 time.
   * Effects: records a heartbeat for userId.
   * @param chatId the chat
   * @param userId the caller
   * @param since if given, only messages strictly after this time are returned
   * @returns the messages (oldest first), the other user, their presence and the server's time
   */
  getHistory(chatId: string, userId: string, since?: string): Promise<ChatHistory>;

  /**
   * Satisfies: R-CHAT-12, R-CHAT-13.
   * Requires: senderId is logged in and a participant of chatId.
   * Effects: stores the trimmed text, time-stamped by the server.
   * @returns the stored message
   */
  sendMessage(chatId: string, senderId: string, text: string): Promise<ChatMessage>;

  /**
   * Requires: userId is logged in and a participant of chatId.
   * Effects: the chat leaves userId's log (idempotent); the other user keeps it.
   */
  removeChatFromLog(userId: string, chatId: string): Promise<void>;

  /**
   * Satisfies: R-CHAT-15, R-CHAT-16.
   * Requires: userId is logged in and a participant of chatId.
   * Effects: flags the chat and removes it from userId's log (idempotent).
   */
  reportChat(userId: string, chatId: string): Promise<void>;

  /**
   * Supports R-CHAT-06. Not called by any view yet: whether pages other than an open chat send
   * heartbeats is api.md Q-7 (pending Felix).
   * Requires: userId is logged in.
   * Effects: userId's last-seen time becomes now.
   */
  recordHeartbeat(userId: string): Promise<void>;
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export interface BrowserSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/**
 * WEB: push notifications for matches and chat messages (owner: Felix; api.md "Push
 * notifications"). Not in the Java stubs. The caller is identified by the session token.
 */
export interface PushApi {
  /**
   * Requires: the user is logged in.
   * Effects: none.
   * @returns the server's Web Push public key (base64url), which a browser subscribes with
   * @throws ApiError if the server has no push key (or, in the demo, always)
   */
  getPublicKey(): Promise<string>;

  /**
   * Requires: the user is logged in; subscription came from this browser's PushManager.
   * Effects: this browser receives the logged-in user's notifications, and no other user's.
   */
  saveSubscription(subscription: BrowserSubscription): Promise<void>;

  /**
   * Requires: the user is logged in.
   * Effects: the browser with this endpoint no longer receives the user's notifications.
   */
  removeSubscription(endpoint: string): Promise<void>;
}

/** What only the demo backend offers, because it can't send real email. */
export interface DemoTools {
  /**
   * Requires: none.
   * Effects: none.
   * @returns the in-app path of email's unused verification link, or null if there is none
   */
  verificationLinkFor(email: string): string | null;
}

/** Everything the views can call. Provided to the component tree by ApiProvider. */
export interface Api {
  readonly account: AccountApi;
  readonly songs: SongApi;
  readonly matches: MatchApi;
  readonly chats: ChatApi;
  readonly push: PushApi;
  readonly admin: AdminApi;
  /** Present only on the mock. */
  readonly demo?: DemoTools;
}
