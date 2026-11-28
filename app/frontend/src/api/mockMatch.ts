/**
 * Mock of MatchModel (architecture-stubs-v2.java): keeps each user's taste and last-active time,
 * offers a match after a random number of swipes, and picks the most compatible user who was
 * active in the last 72 hours and has no earlier match with this user.
 *
 * Abstraction function: `users` are the leaderboard entries; `matches` are all proposed matches,
 * each with who confirmed, who declined, and its chat once both confirmed.
 * Rep invariant: a match's users differ; its percentage is in [0, 100]; confirmed and declined are
 * disjoint and contain only its users; chatId is non-null iff both users confirmed; at most one
 * match exists per pair of users.
 *
 * Concurrency: this mock runs in one browser thread, so each method is atomic. The real model
 * needs DynamoDB conditional writes for the same guarantee (stub class comment).
 */
import { compatibilityPercent, type TasteVector } from './mockTaste';
import { FEATURE_COUNT, type Match } from './types';

/** Only users active within this window are matched (R-HOME-19). */
export const ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000;
/** A match is offered every 5 to 9 swipes, chosen at random each time. */
export const MIN_SWIPES_PER_MATCH = 5;
export const MAX_SWIPES_PER_MATCH = 9;

interface UserEntry {
  taste: TasteVector;
  activeAt: number;
}

interface MatchState {
  readonly match: Match;
  readonly confirmed: Set<string>;
  readonly declined: Set<string>;
  chatId: string | null;
}

export interface MockMatchOptions {
  /** Source of randomness in [0, 1). */
  readonly random: () => number;
  /** Creates a unique ID with the given prefix. */
  readonly newId: (prefix: string) => string;
  /** If set, a match is offered every this many swipes instead of a random interval. */
  readonly matchEvery?: number;
}

function involves(match: Match, userId: string): boolean {
  return match.userA === userId || match.userB === userId;
}

export class MockMatchModel {
  private readonly users = new Map<string, UserEntry>();
  private readonly matches = new Map<string, MatchState>();
  private readonly nextOfferAt = new Map<string, number>();
  private readonly options: MockMatchOptions;

  /**
   * Requires: options.matchEvery, if set, is at least 1.
   * Effects: creates an empty model.
   */
  constructor(options: MockMatchOptions) {
    this.options = options;
  }

  /**
   * Stub updateUser.
   * Requires: taste has FEATURE_COUNT entries in [0, 1].
   * Effects: the user's taste becomes taste; their last-active time becomes activeAt if later.
   */
  updateUser(userId: string, taste: TasteVector, activeAt: number): void {
    const existing = this.users.get(userId);
    this.users.set(userId, { taste, activeAt: Math.max(activeAt, existing?.activeAt ?? -Infinity) });
  }

  /**
   * Stub getLeaderboard.
   * Requires: 0 <= metric < FEATURE_COUNT; limit > 0.
   * Effects: none.
   * @returns up to limit user IDs, highest value for that metric first; ties broken by user ID
   */
  getLeaderboard(metric: number, limit: number): string[] {
    if (metric < 0 || metric >= FEATURE_COUNT) throw new Error('MockMatchModel: metric out of range');
    return [...this.users.entries()]
      .sort(([idA, a], [idB, b]) => b.taste[metric] - a.taste[metric] || idA.localeCompare(idB))
      .slice(0, limit)
      .map(([id]) => id);
  }

  /**
   * Stub getPendingMatches.
   * Satisfies: R-HOME-20.
   * Requires: none.
   * Effects: none.
   * @returns every undeclined match involving userId that userId has not answered
   */
  getPendingMatches(userId: string): Match[] {
    return [...this.matches.values()]
      .filter((s) => involves(s.match, userId) && !s.confirmed.has(userId) && s.declined.size === 0)
      .map((s) => s.match);
  }

  /**
   * WEB: lets MatchView reload a match from its URL (notes-for-felix F-4).
   * Requires: none.
   * Effects: none.
   * @returns the match if it is still waiting for userId's answer, otherwise null
   */
  getMatch(matchId: string, userId: string): Match | null {
    const state = this.matches.get(matchId);
    if (state === undefined || !involves(state.match, userId)) return null;
    return !state.confirmed.has(userId) && state.declined.size === 0 ? state.match : null;
  }

  /**
   * Stub shouldOfferMatch.
   * Requires: swipeCount >= 0.
   * Effects: when it returns true, chooses the user's next random interval.
   * @returns true iff swipeCount has reached the user's randomly chosen count
   */
  shouldOfferMatch(userId: string, swipeCount: number): boolean {
    const next = this.nextOfferAt.get(userId) ?? this.interval();
    if (swipeCount < next) {
      this.nextOfferAt.set(userId, next);
      return false;
    }
    this.nextOfferAt.set(userId, swipeCount + this.interval());
    return true;
  }

  /**
   * Stub compatibility.
   * Satisfies: R-HOME-18.
   * Requires: both users are in the leaderboards.
   * Effects: none.
   * @returns a percentage in [0, 100], symmetric in the two users
   */
  compatibility(userA: string, userB: string): number {
    return compatibilityPercent(this.users.get(userA)!.taste, this.users.get(userB)!.taste);
  }

  /**
   * Stub findMatch.
   * Satisfies: R-HOME-19, R-HOME-22.
   * Requires: none.
   * Effects: the returned pair is recorded as proposed.
   * @returns a match with the user of highest compatibility among those active at most 72 hours
   *          before now and with whom userId has no pending, confirmed or declined match; ties
   *          broken by user ID; null if nobody qualifies
   */
  findMatch(userId: string, now: number): Match | null {
    if (!this.users.has(userId)) return null;
    const taken = new Set<string>([userId]);
    for (const { match } of this.matches.values()) {
      if (involves(match, userId)) taken.add(match.userA === userId ? match.userB : match.userA);
    }
    let best: { id: string; percent: number } | null = null;
    for (const [id, entry] of [...this.users.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (taken.has(id) || now - entry.activeAt > ACTIVE_WINDOW_MS) continue;
      const percent = this.compatibility(userId, id);
      if (best === null || percent > best.percent) best = { id, percent };
    }
    if (best === null) return null;
    const match: Match = {
      matchId: this.options.newId('m'),
      userA: userId,
      userB: best.id,
      compatibilityPercent: best.percent,
    };
    this.addMatch(match, []);
    return match;
  }

  /**
   * Stub recordDecision. A decline is final and the pair is never proposed again.
   * Requires: the match exists and userId is one of its users.
   * Effects: stores the decision, unless the match was already declined or completed.
   * @returns true iff this call's confirmation completed the match
   */
  recordDecision(matchId: string, userId: string, accepted: boolean): boolean {
    const state = this.requireState(matchId, userId);
    if (state.declined.size > 0 || state.chatId !== null) return false;
    if (!accepted) {
      state.confirmed.delete(userId);
      state.declined.add(userId);
      return false;
    }
    const isNew = !state.confirmed.has(userId);
    state.confirmed.add(userId);
    return isNew && state.confirmed.size === 2;
  }

  /**
   * WEB: matches userId said yes to that the other user has not answered.
   * Requires: none.
   * Effects: none.
   * @returns those matches, best first
   */
  getOutgoingMatches(userId: string): Match[] {
    return [...this.matches.values()]
      .filter((s) => involves(s.match, userId) && s.confirmed.has(userId) && s.confirmed.size === 1 && s.declined.size === 0)
      .map((s) => s.match)
      .sort((a, b) => b.compatibilityPercent - a.compatibilityPercent);
  }

  /**
   * WEB: takes back userId's confirmation, which then counts as a decline.
   * Requires: the match exists and userId is one of its users.
   * Effects: if userId confirmed and the other user has not answered, userId's answer becomes a
   *          decline; otherwise nothing changes.
   * @returns true iff the confirmation was taken back
   */
  retract(matchId: string, userId: string): boolean {
    const state = this.requireState(matchId, userId);
    if (!state.confirmed.has(userId) || state.confirmed.size !== 1 || state.declined.size > 0) return false;
    state.confirmed.delete(userId);
    state.declined.add(userId);
    return true;
  }

  /**
   * Requires: the match exists, and both of its users have confirmed.
   * Effects: records the match's one chat.
   */
  attachChat(matchId: string, chatId: string): void {
    this.matches.get(matchId)!.chatId = chatId;
    this.checkRep();
  }

  /**
   * Requires: the match exists.
   * Effects: none.
   * @returns the match's chat ID, or null if it has none
   */
  chatIdOf(matchId: string): string | null {
    return this.matches.get(matchId)!.chatId;
  }

  /**
   * Requires: the match exists.
   * Effects: none.
   * @returns the stored match
   */
  matchById(matchId: string): Match {
    return this.matches.get(matchId)!.match;
  }

  /**
   * Seeds or stores a proposed match.
   * Requires: matchId is unused; confirmedBy holds only the match's users; chatId is given iff
   *           both users are in confirmedBy.
   * Effects: stores the match.
   */
  addMatch(match: Match, confirmedBy: readonly string[], chatId: string | null = null): void {
    this.matches.set(match.matchId, {
      match,
      confirmed: new Set(confirmedBy),
      declined: new Set(),
      chatId,
    });
    this.checkRep();
  }

  /**
   * Requires: none.
   * Effects: none.
   * @returns the match's state
   * @throws Error if the match doesn't exist or userId isn't one of its users
   */
  private requireState(matchId: string, userId: string): MatchState {
    const state = this.matches.get(matchId);
    if (state === undefined || !involves(state.match, userId)) {
      throw new Error('User is not part of this match');
    }
    return state;
  }

  /**
   * Requires: none.
   * Effects: none, apart from consuming randomness.
   * @returns how many more swipes until the next offer
   */
  private interval(): number {
    if (this.options.matchEvery !== undefined) return this.options.matchEvery;
    const span = MAX_SWIPES_PER_MATCH - MIN_SWIPES_PER_MATCH + 1;
    return MIN_SWIPES_PER_MATCH + Math.min(span - 1, Math.floor(this.options.random() * span));
  }

  /** Asserts the rep invariant. */
  checkRep(): void {
    const pairs = new Set<string>();
    for (const { match, confirmed, declined, chatId } of this.matches.values()) {
      const users = [match.userA, match.userB];
      const pair = [...users].sort().join('|');
      assert(match.userA !== match.userB, 'match users differ');
      assert(match.compatibilityPercent >= 0 && match.compatibilityPercent <= 100, 'percent in range');
      assert(!pairs.has(pair), 'one match per pair');
      pairs.add(pair);
      for (const u of confirmed) assert(users.includes(u) && !declined.has(u), 'confirmed valid');
      for (const u of declined) assert(users.includes(u), 'declined valid');
      assert(chatId === null || confirmed.size === 2, 'chat only when both confirmed');
    }
  }
}

function assert(condition: boolean, what: string): void {
  if (!condition) throw new Error(`MockMatchModel rep invariant violated: ${what}`);
}
