import { pairId, type RandomSource } from '../deps';
import { AppError, badRequest, matchNotFound, notParticipant, userNotFound } from '../errors';
import type { Match } from '../model/types';
import { FEATURE_COUNT, TasteVector } from '../model/vectors';
import { attributesOf, type Item, type Key, type Table, updateItem } from '../store/Table';

const POOL = 'POOL';
const poolKey = (userId: string): Key => ({ pk: POOL, sk: `USER#${userId}` });
const matchKey = (matchId: string): Key => ({ pk: `MATCH#${matchId}`, sk: 'MATCH' });
const pointerKey = (userId: string, other: string): Key => ({ pk: `USER#${userId}`, sk: `MATCH#${other}` });
const stateKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'MATCHSTATE' });

/**
 * MatchModel: stores users in leaderboards according to Taste Vector metrics and proposes
 * matches at random swipe intervals.
 * Resides on: server. Communicates with: MatchController, SongController.
 *
 * Stored state:
 *   POOL / USER#<id>             vector, lastActive    (everyone who has swiped)
 *   MATCH#<lo>_<hi> / MATCH      userA, userB, compatibilityPercent, decisionA?, decisionB?
 *   USER#<id> / MATCH#<other>    matchId               (one per user of each match)
 *   USER#<id> / MATCHSTATE       nextAt                (swipe count of the next offer)
 *
 * Abstraction function: AF(table) = the leaderboards (POOL items ranked by any vector
 *   entry), the set of proposed matches with each user's decision so far, and each user's
 *   next-offer swipe count.
 * Rep invariant: at most one MATCH item per unordered pair of users (its key is built from
 *   the sorted pair); each MATCH item has exactly its two pointer items; userA < userB;
 *   a decision, once stored, never changes.
 *
 * Concurrency (the project's main concurrency argument, course C-TECH-5). Requests run on
 * separate Lambda instances that share no memory, so every guarantee comes from DynamoDB
 * conditional writes:
 *  - One match per pair. findMatch creates the MATCH item and both pointers in one atomic
 *    write that requires all three to be absent. If both users are offered each other at the
 *    same moment, exactly one write applies; the other fails and that caller moves on. Since
 *    the item is never deleted, a declined pair can never be proposed again.
 *  - Exactly one completion. recordDecision is a read-modify-write of the MATCH item through
 *    updateItem, so the two users' decisions take effect one after another. The first
 *    confirmation is applied to an item without the other's decision and returns false; the
 *    second is applied to an item that already has it and returns true. A repeated call by
 *    the same user finds their decision stored and returns false. So among any concurrent
 *    calls on one match, at most one returns true.
 */
export class MatchModel {
  /** Only users active within this window are matched (R-HOME-19). */
  static readonly ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000;
  /**
   * A match is offered every MIN_INTERVAL to MAX_INTERVAL swipes, chosen at random each time.
   * 5 to 9 is what the frontend demo was tuned with (frontend-handoff.md).
   */
  static readonly MIN_INTERVAL = 5;
  static readonly MAX_INTERVAL = 9;

  constructor(
    private readonly table: Table,
    private readonly random: RandomSource,
  ) {}

  /**
   * Inserts or updates a user's position in every leaderboard.
   *
   * Requires: userId belongs to an existing account.
   * Effects: the user's leaderboard positions reflect taste; the user's last-active time
   *          becomes activeAt if later than the stored one.
   */
  async updateUser(userId: string, taste: TasteVector, activeAt: number): Promise<void> {
    await updateItem(this.table, poolKey(userId), (current) => {
      const lastActive = current === undefined ? activeAt : Math.max(activeAt, current.lastActive as number);
      return { attrs: { vector: taste.values(), lastActive }, result: undefined };
    });
  }

  /**
   * Takes a user out of matching (used when an account is suspended).
   * Effects: the user is in no leaderboard, so findMatch never returns them, until
   *          updateUser is called for them again. Existing matches are not changed.
   */
  async removeUser(userId: string): Promise<void> {
    await this.table.write([{ op: 'delete', key: poolKey(userId), expect: 'any' }]);
  }

  /**
   * Effects: none.
   * @returns each leaderboard user's last-active time, by user ID
   */
  async lastActiveTimes(): Promise<Map<string, number>> {
    return new Map((await this.table.query(POOL)).map(entryOf).map((entry) => [entry.userId, entry.lastActive]));
  }

  /**
   * Effects: none.
   * @returns true iff a match between the two users was ever proposed (whatever became of it)
   */
  async hasMatch(userA: string, userB: string): Promise<boolean> {
    return (await this.table.get(pointerKey(userA, userB))) !== undefined;
  }

  /**
   * Requires: metric is an integer with 0 <= metric < FEATURE_COUNT; limit > 0.
   * Effects: none.
   * @returns up to limit user IDs, highest value for that metric first (ties by user ID)
   * @throws AppError 400 if metric or limit is out of range
   */
  async getLeaderboard(metric: number, limit: number): Promise<string[]> {
    if (!Number.isInteger(metric) || metric < 0 || metric >= FEATURE_COUNT || !(limit > 0)) {
      throw badRequest('Choose a metric from 0 to 6 and a positive limit.');
    }
    const pool = (await this.table.query(POOL)).map(entryOf);
    return pool
      .sort((a, b) => b.vector.values()[metric]! - a.vector.values()[metric]! || (a.userId < b.userId ? -1 : 1))
      .slice(0, limit)
      .map((entry) => entry.userId);
  }

  /**
   * Matches proposed to this user that are still waiting for this user's decision.
   * Satisfies: R-HOME-20.
   *
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns every match involving userId that userId has not accepted or declined and the
   *          other user has not declined, highest compatibility first
   */
  async getPendingMatches(userId: string): Promise<Match[]> {
    const pointers = await this.table.query(`USER#${userId}`, { prefix: 'MATCH#' });
    const records = await Promise.all(pointers.map((pointer) => this.table.get(matchKey(pointer.matchId as string))));
    return records
      .filter((record) => record !== undefined)
      .filter((record) => {
        const [mine, theirs] = sidesOf(record, userId);
        return record[mine] === undefined && record[theirs] !== false;
      })
      .map(matchOf)
      .sort((a, b) => b.compatibilityPercent - a.compatibilityPercent || (a.matchId < b.matchId ? -1 : 1));
  }

  /**
   * Matches the user said yes to that the other user has not answered yet. Added to stubs v2
   * for the "Waiting for an answer" list on the Messages page.
   *
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns every match involving userId that userId confirmed and the other user has
   *          neither confirmed nor declined, highest compatibility first
   */
  async getOutgoingMatches(userId: string): Promise<Match[]> {
    const pointers = await this.table.query(`USER#${userId}`, { prefix: 'MATCH#' });
    const records = await Promise.all(pointers.map((pointer) => this.table.get(matchKey(pointer.matchId as string))));
    return records
      .filter((record) => record !== undefined)
      .filter((record) => {
        const [mine, theirs] = sidesOf(record, userId);
        return record[mine] === true && record[theirs] === undefined;
      })
      .map(matchOf)
      .sort((a, b) => b.compatibilityPercent - a.compatibilityPercent || (a.matchId < b.matchId ? -1 : 1));
  }

  /**
   * Takes back a confirmation the other user has not answered yet. Added to stubs v2. This is
   * the one exception to "a user's first decision stands".
   *
   * Requires: matchId names an existing match; userId is one of its users, has confirmed it,
   *           and the other user has not answered.
   * Effects: userId's decision becomes a decline, atomically: the match is no longer
   *          outgoing for userId or pending for the other user, and the pair is never
   *          proposed again. If the other user confirms at the same moment, exactly one of
   *          the two happens first: either this call applies and their confirmation completes
   *          nothing, or their confirmation completes the match and this call fails with 409.
   * @throws AppError 404 if there is no such match; 403 if userId is not one of its users;
   *         409 NOT_RETRACTABLE if userId has not confirmed it or the other user has answered
   */
  async retractConfirmation(matchId: string, userId: string): Promise<void> {
    await updateItem(this.table, matchKey(matchId), (current) => {
      const record = requireRecord(current);
      const [mine, theirs] = sidesOf(record, userId);
      if (record[mine] !== true || record[theirs] !== undefined) {
        throw new AppError(409, 'NOT_RETRACTABLE', 'This match can no longer be taken back.');
      }
      return { attrs: { ...attributesOf(record), [mine]: false }, result: undefined };
    });
  }

  /**
   * Decides whether a match should be offered after this swipe.
   *
   * Requires: userId belongs to an existing account; swipeCount >= 0.
   * Effects: if the user has no next-offer count yet, or swipeCount has reached it, a new
   *          one is chosen: swipeCount plus a random integer in [MIN_INTERVAL, MAX_INTERVAL].
   * @returns true iff the user had a next-offer count and swipeCount has reached it
   */
  async shouldOfferMatch(userId: string, swipeCount: number): Promise<boolean> {
    return updateItem(this.table, stateKey(userId), (current) => {
      const nextAt = current?.nextAt as number | undefined;
      if (nextAt !== undefined && swipeCount < nextAt) {
        return { result: false };
      }
      const interval = this.random.int(MatchModel.MIN_INTERVAL, MatchModel.MAX_INTERVAL);
      return { attrs: { nextAt: swipeCount + interval }, result: nextAt !== undefined };
    });
  }

  /**
   * How closely two Taste Vectors match.
   * Satisfies: R-HOME-18.
   *
   * Effects: none.
   * @returns 100 * (1 - d / sqrt(FEATURE_COUNT)), where d is the Euclidean distance between
   *          a and b: a percentage in [0, 100] that is 100 iff a equals b, 0 iff they are
   *          opposite corners of feature space, decreasing in d and symmetric in a and b
   */
  static compatibilityOf(a: TasteVector, b: TasteVector): number {
    const percent = 100 * (1 - a.distanceTo(b) / Math.sqrt(FEATURE_COUNT));
    return Math.min(100, Math.max(0, percent));
  }

  /**
   * How closely two users' tastes match, as shown on MatchView.
   * Satisfies: R-HOME-18.
   *
   * Requires: userA and userB are in the leaderboards.
   * Effects: none.
   * @returns compatibilityOf(their Taste Vectors)
   * @throws AppError 404 if either user is not in the leaderboards
   */
  async compatibility(userA: string, userB: string): Promise<number> {
    const [a, b] = await Promise.all([this.table.get(poolKey(userA)), this.table.get(poolKey(userB))]);
    if (a === undefined || b === undefined) {
      throw userNotFound();
    }
    return MatchModel.compatibilityOf(entryOf(a).vector, entryOf(b).vector);
  }

  /**
   * Finds the next-highest match for a user.
   * Satisfies: R-HOME-19, R-HOME-22.
   *
   * Requires: userId belongs to an existing account.
   * Effects: the returned pair is recorded as proposed (pending both users' decisions).
   * @param now the current time
   * @returns a match with the other user of highest compatibility with userId among users
   *          whose last-active time is at most ACTIVE_WINDOW_MS before now and with whom
   *          userId has no pending, confirmed or declined match; ties broken by ascending
   *          user ID; undefined if no user qualifies or userId is not in the leaderboards
   */
  async findMatch(userId: string, now: number): Promise<Match | undefined> {
    const [pool, pointers] = await Promise.all([
      this.table.query(POOL),
      this.table.query(`USER#${userId}`, { prefix: 'MATCH#' }),
    ]);
    const entries = pool.map(entryOf);
    const me = entries.find((entry) => entry.userId === userId);
    if (me === undefined) {
      return undefined;
    }
    const known = new Set(pointers.map((pointer) => pointer.sk.slice('MATCH#'.length)));
    const candidates = entries
      .filter((entry) => entry.userId !== userId && !known.has(entry.userId))
      .filter((entry) => now - entry.lastActive <= MatchModel.ACTIVE_WINDOW_MS)
      .map((entry) => ({ userId: entry.userId, percent: MatchModel.compatibilityOf(me.vector, entry.vector) }))
      .sort((a, b) => b.percent - a.percent || (a.userId < b.userId ? -1 : 1));
    for (const candidate of candidates) {
      const matchId = pairId(userId, candidate.userId);
      const [userA, userB] = matchId.split('_') as [string, string];
      const match: Match = { matchId, userA, userB, compatibilityPercent: candidate.percent };
      const created = await this.table.write([
        { op: 'put', item: { ...matchKey(matchId), version: 1, userA, userB, compatibilityPercent: candidate.percent }, expect: 'absent' },
        { op: 'put', item: { ...pointerKey(userA, userB), version: 1, matchId }, expect: 'absent' },
        { op: 'put', item: { ...pointerKey(userB, userA), version: 1, matchId }, expect: 'absent' },
      ]);
      if (created) {
        return match;
      }
      // The other user was offered this pair at the same moment; it is their proposal now.
    }
    return undefined;
  }

  /**
   * Records one user's decision on a proposed match.
   * Satisfies: R-HOME-21, R-HOME-22.
   *
   * Requires: matchId names a match returned by findMatch; userId is one of its users.
   * Effects: if userId has not decided on this match yet, stores the decision atomically;
   *          a user's first decision stands, and a declined pair is never proposed again.
   * @param accepted true if confirmed, false if declined
   * @returns true iff this call stored a confirmation and the other user's confirmation was
   *          already stored. Among concurrent calls on one match, at most one returns true.
   * @throws AppError 404 if there is no such match; 403 if userId is not one of its users
   */
  async recordDecision(matchId: string, userId: string, accepted: boolean): Promise<boolean> {
    return updateItem(this.table, matchKey(matchId), (current) => {
      const record = requireRecord(current);
      const [mine, theirs] = sidesOf(record, userId);
      if (record[mine] !== undefined) {
        return { result: false };
      }
      return { attrs: { ...attributesOf(record), [mine]: accepted }, result: accepted && record[theirs] === true };
    });
  }

  /**
   * Requires: matchId names an existing match.
   * Effects: none.
   * @returns true iff both users have confirmed the match
   * @throws AppError 404 if there is no such match
   */
  async isMutual(matchId: string): Promise<boolean> {
    const record = requireRecord(await this.table.get(matchKey(matchId)));
    return record.decisionA === true && record.decisionB === true;
  }

  /**
   * The match behind MatchView's URL, for as long as the user can still answer it.
   * Added to stubs v2 (notes-for-felix F-4).
   *
   * Effects: none.
   * @returns the match if userId is one of its users, has not decided on it, and the other
   *          user has not declined it; otherwise undefined (also when there is no such match)
   */
  async getPendingMatch(matchId: string, userId: string): Promise<Match | undefined> {
    const record = await this.table.get(matchKey(matchId));
    if (record === undefined || (record.userA !== userId && record.userB !== userId)) {
      return undefined;
    }
    const [mine, theirs] = sidesOf(record, userId);
    return record[mine] === undefined && record[theirs] !== false ? matchOf(record) : undefined;
  }

  /**
   * Requires: matchId names an existing match.
   * Effects: none.
   * @returns the match
   * @throws AppError 404 if there is no such match
   */
  async getMatch(matchId: string): Promise<Match> {
    return matchOf(requireRecord(await this.table.get(matchKey(matchId))));
  }
}

function entryOf(item: Item): { userId: string; vector: TasteVector; lastActive: number } {
  return {
    userId: item.sk.slice('USER#'.length),
    vector: new TasteVector(item.vector as number[]),
    lastActive: item.lastActive as number,
  };
}

function matchOf(record: Item): Match {
  return {
    matchId: record.pk.slice('MATCH#'.length),
    userA: record.userA as string,
    userB: record.userB as string,
    compatibilityPercent: record.compatibilityPercent as number,
  };
}

function requireRecord(record: Item | undefined): Item {
  if (record === undefined) {
    throw matchNotFound();
  }
  return record;
}

/** @returns [the attribute holding userId's decision, the attribute holding the other user's] */
function sidesOf(record: Item, userId: string): ['decisionA' | 'decisionB', 'decisionA' | 'decisionB'] {
  if (record.userA === userId) {
    return ['decisionA', 'decisionB'];
  }
  if (record.userB === userId) {
    return ['decisionB', 'decisionA'];
  }
  throw notParticipant('You are not part of that match.');
}
