/**
 * In-memory fake of the backend, implementing every client API. Used for local development
 * (the Nov 16 "mock controllers, local mock database" milestone) and as the default backend in
 * view tests. It follows each method's spec but none of the real algorithms: songs rotate in
 * order, and every `matchEvery` swipes a match with a random other user is offered.
 *
 * Abstraction function: the backend state of a small app whose accounts are `accounts`
 * (by email), whose users' active songs are `songs[activeIndex.get(userId)]`, and whose
 * proposed matches are `matches`.
 * Rep invariant: every userId in activeIndex, liked, swipes and matches belongs to an account;
 * every activeIndex value is in [0, songs.length); a match's confirmed and declined sets are
 * disjoint and contain only its two users; chatId is non-null iff both users confirmed.
 */
import type { AccountApi, Api, MatchApi, SongApi } from './client';
import { SEED_ACCOUNTS, SEED_PENDING_MATCH, SEED_SONGS } from './mockSeed';
import type {
  CreateAccountResult,
  Feedback,
  LoginResponse,
  Match,
  Song,
  SwipeResult,
  UserProfile,
} from './types';
import { isWellFormedEmail } from './validation';

interface MockAccount {
  userId: string;
  email: string;
  password: string;
  verified: boolean;
  username: string;
  pictureUrl: string | null;
}

interface MatchState {
  match: Match;
  confirmed: Set<string>;
  declined: Set<string>;
  chatId: string | null;
}

/** Tuning for the mock. */
export interface MockOptions {
  /** Artificial delay on every call, so pending states (disabled buttons) are visible. Default 0. */
  readonly latencyMs?: number;
  /** A match is offered on every n-th swipe. Default 5. Requires: >= 1. */
  readonly matchEvery?: number;
  /** Songs to rotate through. Default SEED_SONGS. Requires: non-empty. */
  readonly songs?: readonly Song[];
  /** Whether to seed SEED_PENDING_MATCH (demo ↔ harmony). Default true. */
  readonly withPendingMatch?: boolean;
  /**
   * Source of randomness for picking matches, returning numbers in [0, 1). Default Math.random;
   * tests pass a fixed sequence.
   */
  readonly random?: () => number;
}

/** One recorded listen, kept so tests can check what HomeView sent. */
export interface RecordedListen {
  readonly userId: string;
  readonly songId: string;
  readonly feedback: Feedback;
  readonly secondsListened: number;
}

export class MockBackend implements AccountApi, SongApi, MatchApi {
  private readonly accounts = new Map<string, MockAccount>();
  private readonly songs: readonly Song[];
  private readonly activeIndex = new Map<string, number>();
  private readonly liked = new Set<string>();
  private readonly swipes = new Map<string, number>();
  private readonly matches = new Map<string, MatchState>();
  private readonly latencyMs: number;
  private readonly matchEvery: number;
  private readonly random: () => number;
  private nextId = 1;

  /** Every listen recorded by submitFeedback, oldest first. */
  readonly listens: RecordedListen[] = [];

  /**
   * Requires: options satisfy MockOptions' requirements.
   * Effects: creates a mock seeded with SEED_ACCOUNTS and, unless options.withPendingMatch is
   *          false, SEED_PENDING_MATCH.
   */
  constructor(options: MockOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.matchEvery = options.matchEvery ?? 5;
    this.songs = options.songs ?? SEED_SONGS;
    this.random = options.random ?? Math.random;
    if (this.matchEvery < 1 || this.songs.length === 0) {
      throw new Error('MockBackend: matchEvery must be >= 1 and songs non-empty');
    }
    for (const a of SEED_ACCOUNTS) {
      this.accounts.set(a.email, { ...a, pictureUrl: null });
    }
    if (options.withPendingMatch ?? true) {
      this.matches.set(SEED_PENDING_MATCH.match.matchId, {
        match: { ...SEED_PENDING_MATCH.match },
        confirmed: new Set(SEED_PENDING_MATCH.confirmedBy),
        declined: new Set(),
        chatId: null,
      });
    }
    this.checkRep();
  }

  // ----- test / dev helpers (not part of the API) -----

  /**
   * Stands in for clicking the link in the verification email (R-SEC-02).
   * Requires: none.
   * Effects: if an account uses email, it becomes verified.
   * @returns true iff an account uses email
   */
  verifyEmail(email: string): boolean {
    const account = this.accounts.get(email.trim());
    if (account === undefined) return false;
    account.verified = true;
    return true;
  }

  /** Asserts the rep invariant. */
  checkRep(): void {
    const userIds = new Set([...this.accounts.values()].map((a) => a.userId));
    for (const [userId, index] of this.activeIndex) {
      assert(userIds.has(userId), 'activeIndex user exists');
      assert(index >= 0 && index < this.songs.length, 'activeIndex in range');
    }
    for (const { match, confirmed, declined, chatId } of this.matches.values()) {
      const users = [match.userA, match.userB];
      assert(match.userA !== match.userB, 'match users differ');
      assert(users.every((u) => userIds.has(u)), 'match users exist');
      for (const u of confirmed) assert(users.includes(u) && !declined.has(u), 'confirmed valid');
      for (const u of declined) assert(users.includes(u), 'declined valid');
      assert((chatId !== null) === (confirmed.size === 2), 'chat iff both confirmed');
    }
  }

  // ----- AccountApi -----

  async login(email: string, password: string): Promise<LoginResponse> {
    await this.delay();
    const account = this.accounts.get(email.trim());
    if (account === undefined) return { result: 'NO_ACCOUNT' };
    if (account.password !== password) return { result: 'WRONG_PASSWORD' };
    if (!account.verified) return { result: 'NOT_VERIFIED' };
    return { result: 'SUCCESS', userId: account.userId };
  }

  async createAccount(email: string, password: string, confirmPassword: string): Promise<CreateAccountResult> {
    await this.delay();
    const trimmed = email.trim();
    if (!isWellFormedEmail(trimmed)) return 'INVALID_EMAIL';
    if (password === '' || password !== confirmPassword) return 'PASSWORDS_DO_NOT_MATCH';
    if (this.accounts.has(trimmed)) return 'EMAIL_IN_USE';
    const userId = this.newId('u');
    this.accounts.set(trimmed, {
      userId,
      email: trimmed,
      password,
      verified: false,
      username: trimmed.split('@')[0],
      pictureUrl: null,
    });
    this.checkRep();
    return 'PENDING_VERIFICATION';
  }

  async isVerified(email: string): Promise<boolean> {
    await this.delay();
    const account = this.accounts.get(email.trim());
    if (account === undefined) throw new Error(`No account for ${email}`);
    return account.verified;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    await this.delay();
    return toProfile(this.accountById(userId));
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
    if (!this.activeIndex.has(userId)) this.activeIndex.set(userId, 0);
    return this.songs[this.activeIndex.get(userId)!];
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
    this.liked.delete(userId);

    const next = (this.activeIndex.get(userId)! + 1) % this.songs.length;
    this.activeIndex.set(userId, next);
    const count = (this.swipes.get(userId) ?? 0) + 1;
    this.swipes.set(userId, count);

    const offeredMatch = count % this.matchEvery === 0 ? this.proposeMatch(userId) : null;
    this.checkRep();
    return { nextSong: this.songs[next], offeredMatch };
  }

  // ----- MatchApi -----

  /** Pending = userId hasn't answered it and nobody declined it (a decline ends the match for both). */
  async getPendingMatches(userId: string): Promise<Match[]> {
    await this.delay();
    return [...this.matches.values()]
      .filter((s) => involves(s.match, userId) && !s.confirmed.has(userId) && s.declined.size === 0)
      .map((s) => s.match);
  }

  async getMatch(matchId: string, userId: string): Promise<Match | null> {
    await this.delay();
    const state = this.matches.get(matchId);
    return state !== undefined && involves(state.match, userId) ? state.match : null;
  }

  async getOtherProfile(match: Match, userId: string): Promise<UserProfile> {
    await this.delay();
    if (!involves(match, userId)) throw new Error('User is not part of this match');
    return toProfile(this.accountById(match.userA === userId ? match.userB : match.userA));
  }

  async confirmMatch(match: Match, userId: string): Promise<string | null> {
    await this.delay();
    const state = this.stateFor(match, userId);
    state.declined.delete(userId);
    state.confirmed.add(userId);
    if (state.confirmed.size === 2 && state.chatId === null) {
      state.chatId = this.newId('c');
    }
    this.checkRep();
    return state.chatId;
  }

  async declineMatch(match: Match, userId: string): Promise<void> {
    await this.delay();
    const state = this.stateFor(match, userId);
    state.confirmed.delete(userId);
    state.declined.add(userId);
    this.checkRep();
  }

  // ----- helpers -----

  /**
   * TEMPORARY placeholder for MatchModel.findMatch (team request 2026-11-17): proposes a random
   * other verified user with a random compatibility in [50, 100).
   * Skips anyone userId already has an open match or a chat with, so there are no duplicates.
   * Unlike the real spec (R-HOME-22), a declined pair can be proposed again, so the demo never
   * runs out of matches.
   * @returns the new match, or null if no candidate is left
   */
  private proposeMatch(userId: string): Match | null {
    const taken = new Set(
      [...this.matches.values()]
        .filter((s) => involves(s.match, userId) && (s.declined.size === 0 || s.chatId !== null))
        .flatMap((s) => [s.match.userA, s.match.userB]),
    );
    const candidates = [...this.accounts.values()].filter(
      (a) => a.verified && a.userId !== userId && !taken.has(a.userId),
    );
    if (candidates.length === 0) return null;
    const other = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    const percent = Math.min(99.9, Math.round((50 + this.random() * 50) * 10) / 10);
    const match: Match = { matchId: this.newId('m'), userA: userId, userB: other.userId, compatibilityPercent: percent };
    this.matches.set(match.matchId, { match, confirmed: new Set(), declined: new Set(), chatId: null });
    return match;
  }

  private stateFor(match: Match, userId: string): MatchState {
    const state = this.matches.get(match.matchId);
    if (state === undefined || !involves(state.match, userId)) {
      throw new Error('User is not part of this match');
    }
    return state;
  }

  private requireActive(userId: string, songId: string): Song {
    const index = this.activeIndex.get(userId);
    if (index === undefined || this.songs[index].id !== songId) {
      throw new Error(`${songId} is not the active song for ${userId}`);
    }
    return this.songs[index];
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

  private delay(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((r) => setTimeout(r, this.latencyMs)) : Promise.resolve();
  }
}

/**
 * Requires: options satisfy MockOptions' requirements.
 * Effects: none.
 * @returns an Api whose three parts share one MockBackend
 */
export function createMockApi(options: MockOptions = {}): Api & { backend: MockBackend } {
  const backend = new MockBackend(options);
  return { account: backend, songs: backend, matches: backend, backend };
}

function involves(match: Match, userId: string): boolean {
  return match.userA === userId || match.userB === userId;
}

function toProfile(a: MockAccount): UserProfile {
  return { userId: a.userId, username: a.username, profilePictureUrl: a.pictureUrl };
}

function assert(condition: boolean, what: string): void {
  if (!condition) throw new Error(`MockBackend rep invariant violated: ${what}`);
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
