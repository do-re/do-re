/**
 * In-memory fake of the backend, implementing every client API. It is what the app runs on until
 * VITE_API_BASE_URL is set, and the default backend in view tests.
 *
 * It plays the server half of each controller over models that follow the Java stubs:
 * MockTasteModel, MockSuggestionModel, MockMatchModel and MockChatBackend. Matches come from taste:
 * liking songs moves your Taste Vector, and every few swipes you are offered the most compatible
 * active user. The fake users (MockBots) have liked songs from the same library and answer on
 * their own, so nothing is matched automatically at login.
 *
 * Abstraction function: the backend state of a small app whose accounts are `accounts` (by email)
 * and whose users' active songs are `active`; taste, suggestions, matches and chats live in the
 * corresponding models.
 * Rep invariant: every userId in active, liked and swipes belongs to an account; each model's own
 * rep invariant holds.
 */
import { ApiError } from './apiErrors';
import type { AccountApi, AdminApi, Api, MatchApi, SongApi } from './client';
import { MockBots } from './mockBots';
import { MockChatBackend } from './mockChat';
import { MockMatchModel } from './mockMatch';
import { SEED_ACCOUNTS, SEED_BOTS, SEED_CHATS, SEED_PENDING_MATCH, SEED_SONGS, songsInGenre } from './mockSeed';
import { MockSuggestionModel, type SongOrder } from './mockSuggestions';
import { MockTasteModel, UNDO_LIMIT } from './mockTaste';
import type {
  AdminReport,
  AdminUser,
  AuditEntry,
  OutgoingMatch,
  ReportReason,
  CreateAccountResult,
  Feedback,
  LoginResponse,
  Match,
  Song,
  SwipeResult,
  UndoResult,
  UserProfile,
} from './types';
import { MAX_SUSPEND_REASON } from './types';
import { isWellFormedEmail } from './validation';

const HOUR_MS = 60 * 60 * 1000;

interface MockAccount {
  userId: string;
  email: string;
  password: string;
  verified: boolean;
  username: string;
  pictureUrl: string | null;
  /** The unused token in the account's verification email, if any. */
  verificationToken: string | null;
  /** Admin panel (OPEN-18). */
  admin?: boolean;
  suspended?: { at: number; by: string; reason: string } | null;
  createdAt?: number;
}

/** The demo's root admin (the real server takes its root admins from configuration). */
export const MOCK_ROOT_ADMIN_EMAIL = 'demo@do-re.test';

/** Tuning for the mock. */
export interface MockOptions {
  /** Artificial delay on every call, so pending states (disabled buttons) are visible. Default 0. */
  readonly latencyMs?: number;
  /** Offer a match every n-th swipe instead of a random 5 to 9. Requires: >= 1. */
  readonly matchEvery?: number;
  /** The song library. Default SEED_SONGS. Requires: more than 5 songs. */
  readonly songs?: readonly Song[];
  /** 'taste' (default) follows the suggestion model; 'library' plays in order, for view tests. */
  readonly songOrder?: SongOrder;
  /** Whether the fake users take part. Default true. */
  readonly withBots?: boolean;
  /** Whether to seed SEED_PENDING_MATCH (demo ↔ harmony). Default false. */
  readonly withPendingMatch?: boolean;
  /** Whether to seed demo's example chats (SEED_CHATS). Default false. */
  readonly withSeedChats?: boolean;
  /** Source of randomness, returning numbers in [0, 1). Default Math.random. */
  readonly random?: () => number;
  /** The current time in epoch milliseconds. Default Date.now. */
  readonly now?: () => number;
}

/** One recorded listen, kept so tests can check what HomeView sent. */
export interface RecordedListen {
  readonly userId: string;
  readonly songId: string;
  readonly feedback: Feedback;
  readonly secondsListened: number;
}

export class MockBackend implements AccountApi, SongApi, MatchApi, AdminApi {
  private readonly accounts = new Map<string, MockAccount>();
  private readonly active = new Map<string, Song>();
  private readonly liked = new Set<string>();
  private readonly swipes = new Map<string, number>();
  /** Each user's swipes that can be undone, oldest first: the song left and its like button. */
  private readonly undoStacks = new Map<string, { song: Song; liked: boolean }[]>();
  private readonly latencyMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private nextId = 1;
  /** Reports about profiles, and the admin activity log, newest last. */
  private readonly reports: AdminReport[] = [];
  private readonly audit: AuditEntry[] = [];

  /** Every listen recorded by submitFeedback, oldest first. */
  readonly listens: RecordedListen[] = [];
  /** MusicTasteModel. */
  readonly taste = new MockTasteModel();
  /** SongSuggestionModel. */
  readonly suggestions: MockSuggestionModel;
  /** MatchModel. */
  readonly matchModel: MockMatchModel;
  /** The fake users. */
  readonly bots: MockBots;
  /** The chat half of the mock, sharing this backend's accounts and latency. */
  readonly chatBackend: MockChatBackend;

  /**
   * Requires: options satisfy MockOptions' requirements.
   * Effects: creates a mock with the seed accounts and, as options say, bots and example data.
   * @throws Error if options.matchEvery is below 1 or the library has 5 songs or fewer
   */
  constructor(options: MockOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    if (options.matchEvery !== undefined && options.matchEvery < 1) {
      throw new Error('MockBackend: matchEvery must be >= 1');
    }
    this.suggestions = new MockSuggestionModel(options.songs ?? SEED_SONGS, options.songOrder);
    this.matchModel = new MockMatchModel({
      random: this.random,
      newId: (prefix) => this.newId(prefix),
      matchEvery: options.matchEvery,
    });
    this.chatBackend = new MockChatBackend({
      profileOf: (userId) => toProfile(this.accountById(userId)),
      delay: () => this.delay(),
      now: this.now,
      onUserMessage: (chatId, _senderId, otherId) => {
        if (this.bots.isBot(otherId)) this.bots.onUserMessage(chatId, otherId);
      },
    });
    this.bots = new MockBots({
      now: this.now,
      random: this.random,
      decide: (matchId, botId, accepted) => void this.applyDecision(matchId, botId, accepted),
      say: (chatId, botId, text) => void this.chatBackend.deliver(chatId, botId, text),
      sharedLike: (userId, botId) => this.sharedLike(userId, botId),
    });

    for (const a of SEED_ACCOUNTS) {
      this.accounts.set(a.email, { ...a, pictureUrl: null, verificationToken: null });
    }
    if (options.withBots ?? true) this.seedBots();
    if (options.withPendingMatch ?? false) {
      this.matchModel.addMatch({ ...SEED_PENDING_MATCH.match }, SEED_PENDING_MATCH.confirmedBy);
    }
    if (options.withSeedChats ?? false) this.seedChats();
    this.checkRep();
  }

  // ----- test / dev helpers (not part of the API) -----

  /**
   * Stands in for clicking the link in the verification email (R-SEC-02).
   * Requires: none.
   * Effects: if an account uses email, it becomes verified and its link stops working.
   * @returns true iff an account uses email
   */
  verifyEmail(email: string): boolean {
    const account = this.accounts.get(email.trim());
    if (account === undefined) return false;
    account.verified = true;
    account.verificationToken = null;
    return true;
  }

  /**
   * Stands in for the email itself, since the mock can't send one.
   * Requires: none.
   * Effects: none.
   * @returns the in-app path of email's unused verification link, or null if there is none
   */
  verificationLinkFor(email: string): string | null {
    const account = this.accounts.get(email.trim());
    if (account === undefined || account.verificationToken === null) return null;
    const query = new URLSearchParams({ userId: account.userId, token: account.verificationToken });
    return `/verify?${query.toString()}`;
  }

  /** Asserts the rep invariant. */
  checkRep(): void {
    const userIds = new Set([...this.accounts.values()].map((a) => a.userId));
    for (const userId of [...this.active.keys(), ...this.liked, ...this.swipes.keys()]) {
      if (!userIds.has(userId)) throw new Error('MockBackend rep invariant violated: unknown user');
    }
    this.taste.checkRep();
    this.suggestions.checkRep();
    this.matchModel.checkRep();
    this.chatBackend.checkRep();
  }

  // ----- AccountApi -----

  async login(email: string, password: string): Promise<LoginResponse> {
    await this.delay();
    const account = this.accounts.get(email.trim());
    if (account === undefined) return { result: 'NO_ACCOUNT' };
    if (account.password !== password) return { result: 'WRONG_PASSWORD' };
    if (account.suspended) return { result: 'SUSPENDED' };
    if (!account.verified) return { result: 'NOT_VERIFIED' };
    const session = { result: 'SUCCESS' as const, userId: account.userId, token: `mock-session-${account.userId}` };
    return this.isAdminAccount(account) ? { ...session, isAdmin: true } : session;
  }

  async logout(): Promise<void> {
    // The demo's sessions live only in the browser tab, so there is nothing to end.
    await this.delay();
  }

  async createAccount(email: string, password: string, confirmPassword: string): Promise<CreateAccountResult> {
    await this.delay();
    const trimmed = email.trim();
    if (!isWellFormedEmail(trimmed)) return 'INVALID_EMAIL';
    if (password === '' || password !== confirmPassword) return 'PASSWORDS_DO_NOT_MATCH';
    if (this.accounts.has(trimmed)) return 'EMAIL_IN_USE';
    this.accounts.set(trimmed, {
      userId: this.newId('u'),
      email: trimmed,
      password,
      verified: false,
      username: '', // a blank account (R-ACC-09), so a user's email is never shown to others
      pictureUrl: null,
      createdAt: this.now(),
      verificationToken: this.newId('verify'),
    });
    this.checkRep();
    return 'PENDING_VERIFICATION';
  }

  async confirmEmail(userId: string, token: string): Promise<boolean> {
    await this.delay();
    const account = [...this.accounts.values()].find((a) => a.userId === userId);
    if (account === undefined || account.verificationToken === null || account.verificationToken !== token) {
      return false;
    }
    account.verified = true;
    account.verificationToken = null;
    return true;
  }

  async isVerified(email: string): Promise<boolean> {
    await this.delay();
    const account = this.accounts.get(email.trim());
    if (account === undefined) throw new Error(`No account for ${email}`);
    return account.verified;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    await this.delay();
    const account = this.accountById(userId);
    // The real server adds isAdmin only to the caller's own profile; the demo can't tell who asks.
    return this.isAdminAccount(account) ? { ...toProfile(account), isAdmin: true } : toProfile(account);
  }

  async updateUsername(userId: string, newUsername: string): Promise<void> {
    await this.delay();
    if (newUsername.trim() === '') throw new Error('Username must be non-empty');
    this.accountById(userId).username = newUsername.trim();
  }

  async updateProfilePicture(userId: string, image: Blob): Promise<void> {
    await this.delay();
    if (image.size === 0 || !image.type.startsWith('image/')) {
      throw new Error('Profile picture must be a non-empty image file');
    }
    const account = this.accountById(userId);
    account.pictureUrl = await readAsDataUrl(image);
  }

  // ----- SongApi -----

  async getCurrentSong(userId: string): Promise<Song> {
    await this.delay();
    this.accountById(userId);
    let song = this.active.get(userId);
    if (song === undefined) {
      song = this.suggestions.nextSuggestion(userId, this.taste.getTasteVector(userId));
      this.active.set(userId, song);
    }
    return song;
  }

  async markLiked(userId: string, songId: string): Promise<void> {
    await this.delay();
    this.requireActive(userId, songId);
    this.liked.add(userId);
  }

  async submitFeedback(userId: string, songId: string, swipe: Feedback, secondsListened: number): Promise<SwipeResult> {
    await this.delay();
    const song = this.requireActive(userId, songId);
    if (secondsListened < 0 || secondsListened > song.durationSeconds) {
      throw new Error('secondsListened out of range');
    }
    const feedback: Feedback = swipe === 'LIKE' || this.liked.has(userId) ? 'LIKE' : 'SKIP';
    this.listens.push({ userId, songId, feedback, secondsListened });
    const undoStack = this.undoStacks.get(userId) ?? [];
    undoStack.push({ song, liked: this.liked.has(userId) });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    this.undoStacks.set(userId, undoStack);
    this.liked.delete(userId);

    this.taste.recordListen(userId, song, feedback, secondsListened);
    const taste = this.taste.getTasteVector(userId);
    const now = this.now();
    this.matchModel.updateUser(userId, taste, now);
    const count = (this.swipes.get(userId) ?? 0) + 1;
    this.swipes.set(userId, count);

    const nextSong = this.suggestions.nextSuggestion(userId, taste);
    this.active.set(userId, nextSong);
    const offeredMatch = this.matchModel.shouldOfferMatch(userId, count) ? this.matchModel.findMatch(userId, now) : null;
    this.checkRep();
    return { nextSong, offeredMatch };
  }

  async canUndo(userId: string): Promise<boolean> {
    await this.delay();
    return (this.undoStacks.get(userId)?.length ?? 0) > 0;
  }

  async undoLastSwipe(userId: string): Promise<UndoResult | null> {
    await this.delay();
    const stack = this.undoStacks.get(userId);
    const entry = stack?.pop();
    if (stack === undefined || entry === undefined) return null;

    this.suggestions.returnSuggestion(userId, this.active.get(userId)!);
    this.active.set(userId, entry.song);
    this.taste.undoLastListen(userId);
    this.matchModel.updateUser(userId, this.taste.getTasteVector(userId), this.now());
    this.swipes.set(userId, this.swipes.get(userId)! - 1);
    if (entry.liked) this.liked.add(userId);
    else this.liked.delete(userId);
    this.listens.splice(this.listens.findLastIndex((listen) => listen.userId === userId), 1);
    this.checkRep();
    return { song: entry.song, liked: entry.liked, canUndo: stack.length > 0 };
  }

  async getTasteVector(userId: string): Promise<readonly number[]> {
    await this.delay();
    this.accountById(userId);
    return this.taste.getTasteVector(userId);
  }

  // ----- MatchApi -----

  async getPendingMatches(userId: string): Promise<Match[]> {
    await this.delay();
    return this.matchModel.getPendingMatches(userId);
  }

  async getMatch(matchId: string, userId: string): Promise<Match | null> {
    await this.delay();
    return this.matchModel.getMatch(matchId, userId);
  }

  async getOtherProfile(match: Match, userId: string): Promise<UserProfile> {
    await this.delay();
    if (!involves(match, userId)) throw new Error('User is not part of this match');
    return toProfile(this.accountById(otherUser(match, userId)));
  }

  async confirmMatch(match: Match, userId: string): Promise<string | null> {
    await this.delay();
    const chatId = this.applyDecision(match.matchId, userId, true);
    const stored = this.matchModel.matchById(match.matchId);
    const other = otherUser(stored, userId);
    if (chatId === null && this.bots.isBot(other)) {
      this.bots.onUserConfirmed(stored.matchId, other, stored.compatibilityPercent);
    }
    this.checkRep();
    return chatId;
  }

  async declineMatch(match: Match, userId: string): Promise<void> {
    await this.delay();
    this.applyDecision(match.matchId, userId, false);
    this.checkRep();
  }

  async getOutgoingMatches(userId: string): Promise<OutgoingMatch[]> {
    await this.delay();
    return this.matchModel
      .getOutgoingMatches(userId)
      .map((match) => ({ match, otherUser: toProfile(this.accountById(otherUser(match, userId))) }));
  }

  async retractMatch(match: Match, userId: string): Promise<void> {
    await this.delay();
    if (!this.matchModel.retract(match.matchId, userId)) {
      throw new ApiError('INTERNAL', 'This match can no longer be taken back.', 409);
    }
    this.checkRep();
  }

  async reportProfile(match: Match, userId: string, reason: ReportReason, details: string): Promise<void> {
    await this.delay();
    if (!involves(match, userId)) throw new ApiError('NOT_PARTICIPANT', 'You can only report someone you were matched with.', 403);
    this.fileReport(userId, otherUser(match, userId), reason, details);
    this.applyDecision(match.matchId, userId, false);
    this.checkRep();
  }

  /**
   * Test / demo helper: files a report without a match.
   * Requires: both IDs belong to accounts.
   * Effects: stores the report unless reporterId already has an open one about reportedId.
   */
  fileReport(reporterId: string, reportedId: string, reason: AdminReport['reason'], details = '', source: AdminReport['source'] = 'MATCH'): void {
    const reportId = `${reportedId}.${reporterId}`;
    const existing = this.reports.findIndex((report) => report.reportId === reportId);
    if (existing >= 0 && this.reports[existing].resolved === null) return;
    if (existing >= 0) this.reports.splice(existing, 1);
    const person = (id: string) => {
      const account = this.accountById(id);
      return { userId: id, username: account.username, email: account.email };
    };
    this.reports.push({ reportId, reporter: person(reporterId), reported: person(reportedId), source, reason, details: details.trim(), createdAt: this.now(), resolved: null });
  }

  // ----- AdminApi (OPEN-18). Same rules as the server's AdminController. -----

  private isAdminAccount(account: MockAccount): boolean {
    return !account.suspended && (account.admin === true || account.email === MOCK_ROOT_ADMIN_EMAIL);
  }

  private requireAdmin(adminId: string): void {
    const account = [...this.accounts.values()].find((a) => a.userId === adminId);
    if (account === undefined || !this.isAdminAccount(account)) throw new ApiError('NOT_ADMIN', 'This page is for admins.', 403);
  }

  /** The target of a suspension or role change: someone else, and not the root admin. */
  private otherAccount(adminId: string, userId: string, verb: string): MockAccount {
    if (userId === adminId) throw new ApiError('BAD_REQUEST', `You cannot ${verb} your own account.`, 400);
    const account = this.accountById(userId);
    if (account.email === MOCK_ROOT_ADMIN_EMAIL) throw new ApiError('BAD_REQUEST', `You cannot ${verb} a root admin.`, 400);
    return account;
  }

  private log(adminId: string, action: AuditEntry['action'], targetId: string, detail = ''): void {
    this.audit.push({ at: this.now(), adminId, action, targetId, detail });
  }

  async listUsers(adminId: string): Promise<AdminUser[]> {
    await this.delay();
    this.requireAdmin(adminId);
    return [...this.accounts.values()].map((account) => ({
      userId: account.userId,
      email: account.email,
      username: account.username,
      active: account.verified,
      admin: account.admin === true,
      rootAdmin: account.email === MOCK_ROOT_ADMIN_EMAIL,
      suspended: account.suspended ?? null,
      createdAt: account.createdAt ?? 0,
      lastActiveAt: null,
      openReports: this.reports.filter((report) => report.reported.userId === account.userId && report.resolved === null).length,
    }));
  }

  async suspend(adminId: string, userId: string, reason: string): Promise<void> {
    await this.delay();
    this.requireAdmin(adminId);
    const why = reason.trim();
    if (why === '' || why.length > MAX_SUSPEND_REASON) {
      throw new ApiError('BAD_REQUEST', `Give a reason of 1 to ${MAX_SUSPEND_REASON} characters.`, 400);
    }
    const account = this.otherAccount(adminId, userId, 'suspend');
    account.suspended ??= { at: this.now(), by: adminId, reason: why };
    this.log(adminId, 'SUSPEND', userId, why);
  }

  async unsuspend(adminId: string, userId: string): Promise<void> {
    await this.delay();
    this.requireAdmin(adminId);
    this.accountById(userId).suspended = null;
    this.log(adminId, 'UNSUSPEND', userId);
  }

  async verify(adminId: string, userId: string): Promise<void> {
    await this.delay();
    this.requireAdmin(adminId);
    const account = this.accountById(userId);
    account.verified = true;
    account.verificationToken = null;
    this.log(adminId, 'VERIFY', userId);
  }

  async setAdmin(adminId: string, userId: string, admin: boolean): Promise<void> {
    await this.delay();
    this.requireAdmin(adminId);
    this.otherAccount(adminId, userId, 'change the admin rights of').admin = admin;
    this.log(adminId, admin ? 'GRANT_ADMIN' : 'REVOKE_ADMIN', userId);
  }

  async listReports(adminId: string): Promise<AdminReport[]> {
    await this.delay();
    this.requireAdmin(adminId);
    return [...this.reports].sort((a, b) => Number(a.resolved !== null) - Number(b.resolved !== null) || b.createdAt - a.createdAt);
  }

  async resolveReport(adminId: string, reportId: string, note: string): Promise<void> {
    await this.delay();
    this.requireAdmin(adminId);
    const index = this.reports.findIndex((report) => report.reportId === reportId);
    if (index < 0) throw new ApiError('INTERNAL', 'That report does not exist.', 404);
    if (this.reports[index].resolved === null) {
      this.reports[index] = { ...this.reports[index], resolved: { by: adminId, at: this.now(), note: note.trim() } };
    }
    this.log(adminId, 'RESOLVE_REPORT', reportId, note.trim());
  }

  async auditLog(adminId: string): Promise<AuditEntry[]> {
    await this.delay();
    this.requireAdmin(adminId);
    return [...this.audit].reverse().slice(0, 100);
  }

  // ----- helpers -----

  /**
   * Stub MatchController.confirmMatch / declineMatch.
   * Satisfies: R-HOME-21, R-HOME-22, R-HOME-23.
   * Requires: userId is one of the match's users.
   * Effects: records the decision; if it completed the match, creates its one chat.
   * @returns the match's chat ID, or null if it has none
   */
  private applyDecision(matchId: string, userId: string, accepted: boolean): string | null {
    if (this.matchModel.recordDecision(matchId, userId, accepted)) {
      const { userA, userB } = this.matchModel.matchById(matchId);
      const chatId = this.newId('c');
      this.matchModel.attachChat(matchId, chatId);
      this.chatBackend.openChat(chatId, userA, userB);
      if (this.bots.isBot(userA)) this.bots.onChatOpened(chatId, userA, userB);
      if (this.bots.isBot(userB)) this.bots.onChatOpened(chatId, userB, userA);
    }
    return this.matchModel.chatIdOf(matchId);
  }

  /**
   * Requires: called once, from the constructor, after the accounts exist.
   * Effects: each bot likes every song in its style through the same taste update as a person,
   *        and joins the leaderboards with its last-active time.
   */
  private seedBots(): void {
    const now = this.now();
    for (const bot of SEED_BOTS) {
      for (const song of songsInGenre(bot.genre)) {
        this.taste.recordListen(bot.userId, song, 'LIKE', song.durationSeconds);
      }
      this.matchModel.updateUser(bot.userId, this.taste.getTasteVector(bot.userId), now - bot.hoursSinceActive * HOUR_MS);
      if (bot.online) this.chatBackend.setAlwaysOnline(bot.userId);
      this.bots.add(bot);
    }
  }

  /**
   * Requires: called once, from the constructor.
   * Effects: adds, for each SEED_CHATS entry, a completed match with demo and its chat, so
   *          findMatch never offers someone demo already chats with.
   */
  private seedChats(): void {
    const demo = 'u-demo';
    const now = this.now();
    for (const seed of SEED_CHATS) {
      this.matchModel.addMatch(
        { matchId: seed.matchId, userA: seed.partnerId, userB: demo, compatibilityPercent: seed.compatibilityPercent },
        [seed.partnerId, demo],
        seed.chatId,
      );
      this.chatBackend.openChat(seed.chatId, seed.partnerId, demo, now - seed.messages[0].secondsAgo * 1000);
      for (const m of seed.messages) {
        this.chatBackend.deliver(seed.chatId, m.fromDemo ? demo : seed.partnerId, m.text, now - m.secondsAgo * 1000);
      }
      if (seed.online) this.chatBackend.setAlwaysOnline(seed.partnerId);
    }
  }

  /** @returns the song both users liked that userId liked most recently, or null */
  private sharedLike(userId: string, botId: string): Song | null {
    const botLikes = new Set(this.taste.getLikedSongs(botId).map((song) => song.id));
    return this.taste.getLikedSongs(userId).find((song) => botLikes.has(song.id)) ?? null;
  }

  private requireActive(userId: string, songId: string): Song {
    const song = this.active.get(userId);
    if (song === undefined || song.id !== songId) {
      throw new Error(`${songId} is not the active song for ${userId}`);
    }
    return song;
  }

  private accountById(userId: string): MockAccount {
    for (const account of this.accounts.values()) {
      if (account.userId === userId) return account;
    }
    throw new Error(`No account with id ${userId}`);
  }

  private newId(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  /** Effects: waits the configured latency, then lets the bots do whatever is due. */
  private async delay(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    this.bots.tick();
  }
}

/**
 * Requires: options satisfy MockOptions' requirements.
 * Effects: none.
 * @returns an Api whose parts share one MockBackend
 */
export function createMockApi(options: MockOptions = {}): Api & { backend: MockBackend } {
  const backend = new MockBackend(options);
  return {
    account: backend,
    songs: backend,
    matches: backend,
    chats: backend.chatBackend,
    admin: backend,
    // The demo has no server to send pushes, so the Notifications switch reports that it can't
    // be turned on here.
    push: {
      getPublicKey: () => Promise.reject(new ApiError('INTERNAL', "Notifications need the real server. The demo can't send them.", 503)),
      saveSubscription: () => Promise.resolve(),
      removeSubscription: () => Promise.resolve(),
    },
    demo: { verificationLinkFor: (email) => backend.verificationLinkFor(email) },
    backend,
  };
}

function involves(match: Match, userId: string): boolean {
  return match.userA === userId || match.userB === userId;
}

function otherUser(match: Match, userId: string): string {
  return match.userA === userId ? match.userB : match.userA;
}

function toProfile(a: MockAccount): UserProfile {
  return { userId: a.userId, username: a.username, profilePictureUrl: a.pictureUrl };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
