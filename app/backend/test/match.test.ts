import { describe, expect, it } from 'vitest';
import { MatchModel } from '../src/match/MatchModel';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { HOUR, makeWorld, statusOf, type World } from './helpers';

const taste = (v: number) => new TasteVector(new Array<number>(FEATURE_COUNT).fill(v));

/** Puts users in the leaderboards: name -> taste level, all active now unless given. */
async function pool(world: World, users: Record<string, number>, activeAt = world.clock.now): Promise<void> {
  for (const [userId, level] of Object.entries(users)) {
    await world.services.matchModel.updateUser(userId, taste(level), activeAt);
  }
}

describe('MatchModel.compatibility', () => {
  // boundaries: 100% (equal vectors) and 0% (opposite corners)
  it('R_HOME_18_compatibilityIsAPercentageFrom0To100', () => {
    expect(MatchModel.compatibilityOf(taste(0.3), taste(0.3))).toBe(100);
    expect(MatchModel.compatibilityOf(taste(0), taste(1))).toBe(0);
    expect(MatchModel.compatibilityOf(taste(0), taste(0.5))).toBeCloseTo(50);
    const a = new TasteVector([0.1, 0.9, 0.3, 0.5, 0.7, 0.2, 0.6]);
    const b = new TasteVector([0.8, 0.1, 0.4, 0.5, 0.2, 0.9, 0.6]);
    expect(MatchModel.compatibilityOf(a, b)).toBe(MatchModel.compatibilityOf(b, a)); // symmetric
    expect(MatchModel.compatibilityOf(a, b)).toBeGreaterThan(0);
    expect(MatchModel.compatibilityOf(a, b)).toBeLessThan(100);
  });

  it('R_HOME_18_compatibilityDecreasesAsTastesMoveApart', () => {
    const levels = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
    const percents = levels.map((level) => MatchModel.compatibilityOf(taste(0.5), taste(level)));
    expect(percents).toEqual([...percents].sort((x, y) => y - x));
    expect(new Set(percents).size).toBe(levels.length);
  });

  it('R_HOME_18_compatibilityOfTwoUsersUsesTheirStoredTasteVectors', async () => {
    const world = makeWorld();
    await pool(world, { a: 0, b: 0.5 });
    expect(await world.services.matchModel.compatibility('a', 'b')).toBeCloseTo(50);
    expect(await world.services.matchModel.compatibility('b', 'a')).toBeCloseTo(50);
    expect(await statusOf(world.services.matchModel.compatibility('a', 'stranger'))).toBe(404);
    expect(await statusOf(world.services.matchModel.compatibility('stranger', 'a'))).toBe(404);
  });
});

describe('MatchModel leaderboards and offers', () => {
  // spec: highest value for the metric first, ties by ID, at most limit
  it('getLeaderboard ranks users by one Taste Vector entry', async () => {
    const world = makeWorld();
    const model = world.services.matchModel;
    await model.updateUser('low', new TasteVector([0.1, 0.9, 0, 0, 0, 0, 0]), 0);
    await model.updateUser('high', new TasteVector([0.9, 0.1, 0, 0, 0, 0, 0]), 0);
    await model.updateUser('mid', new TasteVector([0.5, 0.5, 0, 0, 0, 0, 0]), 0);
    await model.updateUser('mid2', new TasteVector([0.5, 0.5, 0, 0, 0, 0, 0]), 0);
    expect(await model.getLeaderboard(0, 10)).toEqual(['high', 'mid', 'mid2', 'low']);
    expect(await model.getLeaderboard(1, 2)).toEqual(['low', 'mid']);
    await model.updateUser('low', new TasteVector([1, 0, 0, 0, 0, 0, 0]), 0); // positions follow updates
    expect(await model.getLeaderboard(0, 1)).toEqual(['low']);
    for (const [metric, limit] of [[-1, 5], [7, 5], [1.5, 5], [0, 0]] as const) {
      expect(await statusOf(model.getLeaderboard(metric, limit))).toBe(400);
    }
  });

  // spec: true iff swipeCount has reached the randomly chosen interval, which then advances
  it('shouldOfferMatch fires at the random interval and then picks a new one', async () => {
    const world = makeWorld();
    world.random.ints.push(3, 5);
    const model = world.services.matchModel;
    const fired: number[] = [];
    for (let swipes = 1; swipes <= 14; swipes++) {
      if (await model.shouldOfferMatch('u', swipes)) {
        fired.push(swipes);
      }
    }
    // first call (1 swipe) sets the target to 1 + 3 = 4; at 4 the next target is 4 + 5 = 9;
    // at 9 the queue is empty so the interval is MIN_INTERVAL: 9 + 5 = 14
    expect(fired).toEqual([4, 9, 14]);
    expect(MatchModel.MIN_INTERVAL).toBeLessThanOrEqual(MatchModel.MAX_INTERVAL);
  });
});

describe('MatchModel.findMatch', () => {
  it('R_HOME_19_findMatchReturnsTheHighestCompatibilityUser', async () => {
    const world = makeWorld();
    await pool(world, { me: 0.5, far: 0.9, near: 0.55, mid: 0.7 });
    const match = (await world.services.matchModel.findMatch('me', world.clock.now))!;
    expect(match).toMatchObject({ matchId: 'me_near', userA: 'me', userB: 'near' });
    expect(match.compatibilityPercent).toBeCloseTo(95);
    expect(match.compatibilityPercent).toBe(await world.services.matchModel.compatibility('me', 'near'));
  });

  // boundary: active exactly 72 h ago still counts; 1 ms more does not
  it('R_HOME_19_findMatchIgnoresUsersInactiveFor72h', async () => {
    const world = makeWorld();
    const now = world.clock.now;
    await pool(world, { me: 0.5 });
    await pool(world, { stale: 0.5 }, now - 72 * HOUR - 1);
    await pool(world, { edge: 0.9 }, now - 72 * HOUR);
    const match = await world.services.matchModel.findMatch('me', now);
    expect(match!.matchId).toBe('edge_me'); // stale is a perfect match but inactive
    expect(await world.services.matchModel.findMatch('me', now)).toBeUndefined();
  });

  it('R_HOME_19_aUsersLastActiveTimeOnlyMovesForward', async () => {
    const world = makeWorld();
    const now = world.clock.now;
    await pool(world, { me: 0.5, other: 0.5 });
    await pool(world, { other: 0.5 }, now - 100 * HOUR); // an older timestamp arriving late
    expect(await world.services.matchModel.findMatch('me', now)).toBeDefined();
  });

  it('R_HOME_19_tiesAreBrokenByUserId', async () => {
    const world = makeWorld();
    await pool(world, { me: 0.5, zed: 0.75, amy: 0.75, bob: 0.25 });
    expect((await world.services.matchModel.findMatch('me', world.clock.now))!.matchId).toBe('amy_me');
  });

  it('R_HOME_19_findMatchReturnsNothingWhenNobodyQualifies', async () => {
    const world = makeWorld();
    const model = world.services.matchModel;
    expect(await model.findMatch('me', world.clock.now)).toBeUndefined(); // not in the leaderboards
    await pool(world, { me: 0.5 });
    expect(await model.findMatch('me', world.clock.now)).toBeUndefined(); // alone
  });

  it('R_HOME_22_afterARejectionFindMatchReturnsTheNextHighestAndNeverRepeatsAPair', async () => {
    const world = makeWorld();
    const model = world.services.matchModel;
    await pool(world, { me: 0.5, first: 0.55, second: 0.6, third: 0.9 });
    const now = world.clock.now;
    const one = (await model.findMatch('me', now))!;
    expect(one.matchId).toBe('first_me');
    await model.recordDecision(one.matchId, 'me', false);
    const two = (await model.findMatch('me', now))!;
    expect(two.matchId).toBe('me_second');
    // a pending or confirmed pair is not proposed again either
    await model.recordDecision(two.matchId, 'me', true);
    expect((await model.findMatch('me', now))!.matchId).toBe('me_third');
    expect(await model.findMatch('me', now)).toBeUndefined();
    // and not from the other side
    expect(await model.findMatch('first', now)).toMatchObject({ matchId: 'first_second' });
  });

  it('R_HOME_20_aProposedMatchIsPendingForBothUsers', async () => {
    const world = makeWorld();
    const model = world.services.matchModel;
    await pool(world, { me: 0.5, you: 0.6, third: 0.9 });
    const match = (await model.findMatch('me', world.clock.now))!;
    expect(await model.getPendingMatches('me')).toEqual([match]);
    expect(await model.getPendingMatches('you')).toEqual([match]);
    expect(await model.getPendingMatches('third')).toEqual([]);
    expect(await model.getMatch(match.matchId)).toEqual(match);
    // getPendingMatch: only for its two users, only while they can still answer
    expect(await model.getPendingMatch(match.matchId, 'me')).toEqual(match);
    expect(await model.getPendingMatch(match.matchId, 'you')).toEqual(match);
    expect(await model.getPendingMatch(match.matchId, 'third')).toBeUndefined();
    expect(await model.getPendingMatch('no_match', 'me')).toBeUndefined();
    await model.recordDecision(match.matchId, 'me', true);
    expect(await model.getPendingMatch(match.matchId, 'me')).toBeUndefined(); // answered
    expect(await model.getPendingMatch(match.matchId, 'you')).toEqual(match);
    await model.recordDecision(match.matchId, 'you', false);
    expect(await model.getPendingMatch(match.matchId, 'you')).toBeUndefined();
  });

  // spec: pending = I have not decided and the other user has not declined; best first
  it('R_HOME_20_pendingMatchesLeaveOutDecidedAndDeclinedOnesAndAreSortedBestFirst', async () => {
    const world = makeWorld();
    const model = world.services.matchModel;
    await pool(world, { me: 0.5, a: 0.55, b: 0.6, c: 0.7, d: 0.8 });
    const now = world.clock.now;
    for (let i = 0; i < 4; i++) {
      await model.findMatch('me', now);
    }
    expect((await model.getPendingMatches('me')).map((m) => m.matchId)).toEqual(['a_me', 'b_me', 'c_me', 'd_me']);
    await model.recordDecision('a_me', 'me', true); // I confirmed: no longer pending for me
    await model.recordDecision('b_me', 'b', false); // they declined: gone for me
    await model.recordDecision('c_me', 'c', true); // they confirmed: still pending for me
    expect((await model.getPendingMatches('me')).map((m) => m.matchId)).toEqual(['c_me', 'd_me']);
    expect((await model.getPendingMatches('a')).map((m) => m.matchId)).toEqual(['a_me']);
    expect(await model.getPendingMatches('b')).toEqual([]);
  });

  it('concurrency_twoUsersOfferedEachOtherAtOnceGetExactlyOneMatch', async () => {
    for (let round = 0; round < 10; round++) {
      const world = makeWorld();
      const model = world.services.matchModel;
      await pool(world, { me: 0.5, you: 0.5 });
      const [mine, yours] = await Promise.all([model.findMatch('me', world.clock.now), model.findMatch('you', world.clock.now)]);
      expect([mine, yours].filter((m) => m !== undefined)).toHaveLength(1);
      expect(await model.getPendingMatches('me')).toHaveLength(1);
      expect(await model.getPendingMatches('you')).toHaveLength(1);
    }
  });
});

describe('MatchModel.recordDecision', () => {
  async function proposed() {
    const world = makeWorld();
    await pool(world, { me: 0.5, you: 0.6 });
    const match = (await world.services.matchModel.findMatch('me', world.clock.now))!;
    return { world, model: world.services.matchModel, matchId: match.matchId };
  }

  it('R_HOME_21_theSecondConfirmationCompletesTheMatch', async () => {
    const { model, matchId } = await proposed();
    expect(await model.isMutual(matchId)).toBe(false);
    expect(await model.recordDecision(matchId, 'me', true)).toBe(false);
    expect(await model.isMutual(matchId)).toBe(false);
    expect(await model.recordDecision(matchId, 'me', true)).toBe(false); // repeating changes nothing
    expect(await model.recordDecision(matchId, 'you', true)).toBe(true);
    expect(await model.isMutual(matchId)).toBe(true);
    expect(await model.recordDecision(matchId, 'you', true)).toBe(false); // already recorded
  });

  it('R_HOME_21_aDeclineNeverCompletesAndAFirstDecisionStands', async () => {
    const { model, matchId } = await proposed();
    expect(await model.recordDecision(matchId, 'me', false)).toBe(false);
    expect(await model.recordDecision(matchId, 'you', true)).toBe(false);
    expect(await model.recordDecision(matchId, 'me', true)).toBe(false); // cannot undo the decline
    expect(await model.isMutual(matchId)).toBe(false);
    const other = await proposed();
    await other.model.recordDecision(other.matchId, 'me', true);
    expect(await other.model.recordDecision(other.matchId, 'you', false)).toBe(false);
    expect(await other.model.isMutual(other.matchId)).toBe(false);
  });

  // spec: 404 for an unknown match, 403 for a user who is not part of it
  it('rejects unknown matches and outsiders', async () => {
    const { model, matchId } = await proposed();
    expect(await statusOf(model.recordDecision('no_match', 'me', true))).toBe(404);
    expect(await statusOf(model.recordDecision(matchId, 'intruder', true))).toBe(403);
    expect(await statusOf(model.isMutual('no_match'))).toBe(404);
    expect(await statusOf(model.getMatch('no_match'))).toBe(404);
  });

  it('concurrency_amongConcurrentConfirmationsExactlyOneCompletesTheMatch', async () => {
    for (let round = 0; round < 10; round++) {
      const { model, matchId } = await proposed();
      const calls = Array.from({ length: 16 }, (_, i) => model.recordDecision(matchId, i % 2 === 0 ? 'me' : 'you', true));
      expect((await Promise.all(calls)).filter(Boolean)).toHaveLength(1);
      expect(await model.isMutual(matchId)).toBe(true);
    }
  });
});

describe('MatchController', () => {
  async function matched() {
    const world = makeWorld();
    const me = await world.join('me@example.com');
    const you = await world.join('you@example.com');
    await pool(world, { [me.userId]: 0.5, [you.userId]: 0.6 });
    const match = (await world.services.matchModel.findMatch(me.userId, world.clock.now))!;
    return { world, matches: world.services.matches, me: me.userId, you: you.userId, match };
  }

  it('R_HOME_20_bothUsersAreServedThePendingMatchAndTheOtherProfile', async () => {
    const { world, matches, me, you, match } = await matched();
    await world.services.accounts.updateUsername(you, 'You');
    expect(await matches.getPendingMatches(me)).toEqual([match]);
    expect(await matches.getPendingMatches(you)).toEqual([match]);
    expect(await matches.getMatch(match.matchId, you)).toEqual(match);
    expect(await matches.getMatch(match.matchId, 'intruder')).toBeUndefined();
    expect((await matches.getOtherProfile(match, me)).username).toBe('You');
    expect((await matches.getOtherProfile(match, you)).userId).toBe(me);
    expect(await statusOf(matches.getOtherProfile(match, 'intruder'))).toBe(403);
  });

  it('R_HOME_23_aChatIsCreatedOnlyWhenBothUsersConfirm', async () => {
    const { world, matches, me, you, match } = await matched();
    expect(await matches.confirmMatch(match.matchId, me)).toBeUndefined(); // OPEN-4: wait for the other user
    expect(await world.services.chats.getChatLog(me)).toEqual([]);
    const chatId = await matches.confirmMatch(match.matchId, you);
    expect(chatId).toBeDefined();
    expect((await world.services.chats.getChatLog(me)).map((c) => c.chatId)).toEqual([chatId]);
    expect((await world.services.chats.getChatLog(you)).map((c) => c.chatId)).toEqual([chatId]);
    // confirming again (a retry, or the first user coming back) returns the same chat
    expect(await matches.confirmMatch(match.matchId, me)).toBe(chatId);
    expect(await matches.confirmMatch(match.matchId, you)).toBe(chatId);
    expect(await world.services.chats.getChatLog(me)).toHaveLength(1);
  });

  it('R_HOME_21_R_HOME_22_decliningCreatesNoChatAndThePairIsNotProposedAgain', async () => {
    const { world, matches, me, you, match } = await matched();
    await matches.declineMatch(match.matchId, me);
    expect(await matches.confirmMatch(match.matchId, you)).toBeUndefined();
    expect(await matches.confirmMatch(match.matchId, me)).toBeUndefined();
    expect(await world.services.chats.getChatLog(you)).toEqual([]);
    expect(await matches.getPendingMatches(you)).toEqual([]);
    expect(await world.services.matchModel.findMatch(you, world.clock.now)).toBeUndefined();
    expect(await statusOf(matches.declineMatch(match.matchId, 'intruder'))).toBe(403);
    expect(await statusOf(matches.confirmMatch('no_match', me))).toBe(404);
  });

  // the project's main concurrency property (testing.md): many confirmations, exactly one chat
  it('concurrency_R_HOME_23_manyConcurrentConfirmationsYieldExactlyOneChat', async () => {
    const { world, matches, me, you, match } = await matched();
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, i) => matches.confirmMatch(match.matchId, i % 2 === 0 ? me : you)),
    );
    const chatIds = new Set(results.filter((id) => id !== undefined));
    expect(chatIds.size).toBe(1);
    expect(await world.services.chats.getChatLog(me)).toHaveLength(1);
    expect(await world.services.chats.getChatLog(you)).toHaveLength(1);
    expect(await world.table.query(`CHAT#${[...chatIds][0]}`)).toHaveLength(1); // one META, no stray items
  });
});
