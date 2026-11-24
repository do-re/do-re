import { describe, expect, it } from 'vitest';
import { ACTIVE_WINDOW_MS, MAX_SWIPES_PER_MATCH, MIN_SWIPES_PER_MATCH, MockMatchModel } from './mockMatch';
import { SEED_SONGS, songsInGenre } from './mockSeed';
import { CACHE_SIZE, MockSuggestionModel } from './mockSuggestions';
import {
  compatibilityPercent,
  computeWeight,
  HISTORY_SIZE,
  isNeutralTaste,
  MAX_STEP,
  MockTasteModel,
  moveTaste,
  NEUTRAL_VALUE,
  tasteDistance,
  type TasteVector,
} from './mockTaste';
import { FEATURE_COUNT, type Match, type Song } from './types';

const neutral: TasteVector = Array(FEATURE_COUNT).fill(NEUTRAL_VALUE);
const zeros: TasteVector = Array(FEATURE_COUNT).fill(0);
const ones: TasteVector = Array(FEATURE_COUNT).fill(1);

/** A small deterministic random number generator, so the property tests are repeatable. */
function seededRandom(seed: number) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

describe('computeWeight', () => {
  it.each([
    ['LIKE', 0, 0.1],
    ['LIKE', 15, 0.15],
    ['LIKE', 30, 0.2],
    ['SKIP', 0, -0.05],
    ['SKIP', 15, -0.025],
    ['SKIP', 30, 0],
  ] as const)('%s after %d of 30 s is %d', (feedback, seconds, expected) => {
    expect(computeWeight(feedback, seconds, 30)).toBeCloseTo(expected);
  });

  it('R_HOME_17 is within MAX_STEP, positive for likes, non-positive for skips, and rises with listening', () => {
    for (const feedback of ['LIKE', 'SKIP'] as const) {
      let previous = -Infinity;
      for (let s = 0; s <= 30; s++) {
        const w = computeWeight(feedback, s, 30);
        expect(Math.abs(w)).toBeLessThanOrEqual(MAX_STEP);
        expect(feedback === 'LIKE' ? w > 0 : w <= 0).toBe(true);
        expect(w).toBeGreaterThanOrEqual(previous);
        previous = w;
      }
    }
  });

  it('treats listening past the end as a full listen', () => {
    expect(computeWeight('LIKE', 99, 30)).toBeCloseTo(MAX_STEP);
  });
});

describe('moveTaste', () => {
  it('R_HOME_17 moves toward liked features and away from skipped ones', () => {
    const features = Array(FEATURE_COUNT).fill(0.9);
    expect(moveTaste(neutral, features, 0.2)[0]).toBeCloseTo(0.58);
    expect(moveTaste(neutral, features, -0.1)[0]).toBeCloseTo(0.46);
  });

  it('clamps to [0, 1]', () => {
    expect(moveTaste(zeros, ones, -0.2)[0]).toBe(0);
    expect(moveTaste(ones, zeros, -0.2)[0]).toBe(1);
  });

  it('proof 2 property: any listening sequence keeps every entry in [0, 1]', () => {
    const random = seededRandom(221);
    let taste = neutral;
    for (let i = 0; i < 5000; i++) {
      const features = Array.from({ length: FEATURE_COUNT }, () => (random() < 0.3 ? Math.round(random()) : random()));
      taste = moveTaste(taste, features, computeWeight(random() < 0.5 ? 'LIKE' : 'SKIP', random() * 30, 30));
      expect(taste.every((t) => Number.isFinite(t) && t >= 0 && t <= 1)).toBe(true);
    }
  });
});

describe('compatibilityPercent', () => {
  it('R_HOME_18 is 100 for equal vectors and 0 at the largest possible distance', () => {
    expect(compatibilityPercent(neutral, neutral)).toBe(100);
    expect(compatibilityPercent(zeros, ones)).toBeCloseTo(0);
  });

  it('R_HOME_18 is symmetric, in range, and falls as distance grows', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 200; i++) {
      const a = Array.from({ length: FEATURE_COUNT }, random);
      const b = Array.from({ length: FEATURE_COUNT }, random);
      const c = Array.from({ length: FEATURE_COUNT }, random);
      const ab = compatibilityPercent(a, b);
      expect(ab).toBe(compatibilityPercent(b, a));
      expect(ab).toBeGreaterThanOrEqual(0);
      expect(ab).toBeLessThanOrEqual(100);
      expect(ab > compatibilityPercent(a, c)).toBe(tasteDistance(a, b) < tasteDistance(a, c));
    }
  });
});

describe('MockTasteModel', () => {
  const song = SEED_SONGS[0];

  it('a new user starts at the centre', () => {
    const model = new MockTasteModel();
    expect(model.getTasteVector('u')).toEqual(neutral);
    expect(isNeutralTaste(model.getTasteVector('u'))).toBe(true);
    expect(model.getRecentSongs('u')).toEqual([]);
    expect(model.getLikedSongs('u')).toEqual([]);
  });

  it('R_HOME_12 R_HOME_17 recordListen folds the song in and keeps it newest-first', () => {
    const model = new MockTasteModel();
    model.recordListen('u', SEED_SONGS[0], 'LIKE', 30);
    model.recordListen('u', SEED_SONGS[1], 'SKIP', 0);
    expect(model.getRecentSongs('u')).toEqual([SEED_SONGS[1], SEED_SONGS[0]]);
    expect(model.getLikedSongs('u')).toEqual([SEED_SONGS[0]]);
    expect(isNeutralTaste(model.getTasteVector('u'))).toBe(false);
  });

  it('keeps exactly the latest 100 songs (boundary: 100th vs 101st)', () => {
    const model = new MockTasteModel();
    for (let i = 0; i < HISTORY_SIZE; i++) model.recordListen('u', song, 'SKIP', 0);
    expect(model.getRecentSongs('u')).toHaveLength(HISTORY_SIZE);
    model.recordListen('u', SEED_SONGS[1], 'SKIP', 0);
    const recent = model.getRecentSongs('u');
    expect(recent).toHaveLength(HISTORY_SIZE);
    expect(recent[0]).toBe(SEED_SONGS[1]);
  });

  it('checkRep rejects a bad Taste Vector', () => {
    const model = new MockTasteModel();
    const broken = { ...song, features: Array(FEATURE_COUNT).fill(Number.NaN) };
    expect(() => model.recordListen('u', broken, 'LIKE', 30)).toThrow(/rep invariant/);
  });

  it('checkRep rejects an over-long history', () => {
    const model = new MockTasteModel();
    model.recordListen('u', song, 'LIKE', 30);
    (model as unknown as { histories: Map<string, unknown[]> }).histories.set('u', Array(HISTORY_SIZE + 1).fill({}));
    expect(() => model.checkRep()).toThrow(/history too long/);
  });
});

describe('MockSuggestionModel', () => {
  const lovedTaste = (songs: readonly Song[]) => {
    let taste = neutral;
    for (let i = 0; i < 30; i++) taste = moveTaste(taste, songs[i % songs.length].features, MAX_STEP);
    return taste;
  };

  it('R_HOME_01 requires a library larger than the cache, and copies it', () => {
    expect(() => new MockSuggestionModel(SEED_SONGS.slice(0, CACHE_SIZE))).toThrow();
    const library = [...SEED_SONGS];
    const model = new MockSuggestionModel(library);
    library.pop();
    expect(model.getLibrary()).toHaveLength(SEED_SONGS.length);
  });

  it('R_HOME_11 every library song has 7 features in [0, 1], and IDs are unique', () => {
    expect(new Set(SEED_SONGS.map((s) => s.id)).size).toBe(SEED_SONGS.length);
    for (const song of SEED_SONGS) {
      expect(song.features).toHaveLength(FEATURE_COUNT);
      expect(song.features.every((f) => f >= 0 && f <= 1)).toBe(true);
      expect(song.spotifyUri.startsWith('spotify:track:')).toBe(true);
    }
  });

  it('findNearest is closest-first, honours exclude and count, and breaks ties by ID', () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    const rock = songsInGenre('rock')[0];
    const nearest = model.findNearest(rock.features, 3, new Set());
    expect(nearest[0]).toBe(rock);
    expect(nearest).toHaveLength(3);
    const without = model.findNearest(rock.features, 1, new Set([rock.id]));
    expect(without[0]).not.toBe(rock);

    const twins = Array.from({ length: 7 }, (_, i) => ({ ...SEED_SONGS[0], id: `z${6 - i}` }));
    const tied = new MockSuggestionModel(twins).findNearest(neutral, 2, new Set());
    expect(tied.map((s) => s.id)).toEqual(['z0', 'z1']);
  });

  it("a new user's first five songs cover all five styles", () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    const firstFive = Array.from({ length: CACHE_SIZE }, () => model.nextSuggestion('u', neutral));
    const genres = (['folk', 'pop', 'hiphop', 'rock', 'ambient'] as const).filter((g) =>
      firstFive.some((song) => songsInGenre(g).includes(song)),
    );
    expect(genres).toHaveLength(5);
  });

  it('after the first five, suggests songs near the current taste', () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    for (let i = 0; i < CACHE_SIZE; i++) model.nextSuggestion('u', neutral);
    const folk = songsInGenre('folk');
    const taste = lovedTaste(folk);
    model.nextSuggestion('u', taste); // the first refill was chosen for the old taste
    const next = Array.from({ length: 3 }, () => model.nextSuggestion('u', taste));
    expect(next.every((song) => folk.includes(song))).toBe(true);
  });

  it('a returning user with a taste gets a cache near it', () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    const ambient = songsInGenre('ambient');
    model.preloadCache('u', lovedTaste(ambient));
    expect(ambient).toContain(model.nextSuggestion('u', lovedTaste(ambient)));
  });

  it('never repeats a recent song, and always has one to offer', () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    const window = SEED_SONGS.length - CACHE_SIZE;
    const seen: string[] = [];
    const taste = lovedTaste(songsInGenre('pop'));
    for (let i = 0; i < 200; i++) {
      const song = model.nextSuggestion('u', i < CACHE_SIZE ? neutral : taste);
      expect(seen.slice(-window)).not.toContain(song.id);
      seen.push(song.id);
    }
  });

  it('works with the smallest allowed library', () => {
    const tiny = SEED_SONGS.slice(0, CACHE_SIZE + 1);
    const model = new MockSuggestionModel(tiny);
    let previous: Song | null = null;
    for (let i = 0; i < 20; i++) {
      const song = model.nextSuggestion('u', i % 2 === 0 ? neutral : tiny[0].features);
      expect(song).not.toBe(previous);
      previous = song;
    }
  });

  it('library order plays songs in turn and wraps', () => {
    const model = new MockSuggestionModel(SEED_SONGS, 'library');
    expect(model.nextSuggestion('u', neutral)).toBe(SEED_SONGS[0]);
    for (let i = 1; i < SEED_SONGS.length; i++) model.nextSuggestion('u', neutral);
    expect(model.nextSuggestion('u', neutral)).toBe(SEED_SONGS[0]);
  });

  it('checkRep rejects a bad cache', () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    (model as unknown as { caches: Map<string, Song[]> }).caches.set('u', [SEED_SONGS[0], SEED_SONGS[0]]);
    expect(() => model.checkRep()).toThrow(/rep invariant/);
  });
});

describe('MockMatchModel', () => {
  const NOW = Date.parse('2026-11-23T12:00:00.000Z');

  function model(options: { matchEvery?: number; random?: () => number } = {}) {
    let id = 1;
    return new MockMatchModel({ random: options.random ?? (() => 0), newId: (p) => `${p}-${id++}`, matchEvery: options.matchEvery });
  }

  const taste = (value: number): TasteVector => Array(FEATURE_COUNT).fill(value);

  it('updateUser keeps the latest active time', () => {
    const m = model();
    m.updateUser('a', taste(0.5), NOW);
    m.updateUser('a', taste(0.5), NOW - 1000);
    m.updateUser('b', taste(0.5), NOW - ACTIVE_WINDOW_MS);
    expect(m.findMatch('b', NOW)?.userB).toBe('a');
  });

  it('getLeaderboard ranks by metric, limits, and breaks ties by ID', () => {
    const m = model();
    m.updateUser('c', taste(0.5), NOW);
    m.updateUser('a', taste(0.9), NOW);
    m.updateUser('b', taste(0.5), NOW);
    expect(m.getLeaderboard(0, 3)).toEqual(['a', 'b', 'c']);
    expect(m.getLeaderboard(6, 1)).toEqual(['a']);
    expect(() => m.getLeaderboard(7, 1)).toThrow();
    expect(() => m.getLeaderboard(-1, 1)).toThrow();
  });

  it('shouldOfferMatch fires at a random count from 5 to 9, then chooses a new one', () => {
    for (const [r, expected] of [[0, MIN_SWIPES_PER_MATCH], [0.999, MAX_SWIPES_PER_MATCH]] as const) {
      const m = model({ random: () => r });
      for (let swipe = 1; swipe < expected; swipe++) expect(m.shouldOfferMatch('a', swipe)).toBe(false);
      expect(m.shouldOfferMatch('a', expected)).toBe(true);
      expect(m.shouldOfferMatch('a', expected + 1)).toBe(false);
      expect(m.shouldOfferMatch('a', expected * 2)).toBe(true);
    }
  });

  it('shouldOfferMatch handles a random value of exactly 1 without exceeding the maximum', () => {
    const m = model({ random: () => 1 });
    expect(m.shouldOfferMatch('a', MAX_SWIPES_PER_MATCH)).toBe(true);
  });

  it('matchEvery fixes the interval', () => {
    const m = model({ matchEvery: 2 });
    expect(m.shouldOfferMatch('a', 1)).toBe(false);
    expect(m.shouldOfferMatch('a', 2)).toBe(true);
  });

  it('R_HOME_18 compatibility is 100% for equal tastes and symmetric', () => {
    const m = model();
    m.updateUser('a', taste(0.3), NOW);
    m.updateUser('b', taste(0.3), NOW);
    m.updateUser('c', taste(0.8), NOW);
    expect(m.compatibility('a', 'b')).toBe(100);
    expect(m.compatibility('a', 'c')).toBe(m.compatibility('c', 'a'));
    expect(m.compatibility('a', 'c')).toBeLessThan(100);
  });

  it('R_HOME_19 picks the highest compatibility, then the next highest', () => {
    const m = model();
    m.updateUser('me', taste(0.5), NOW);
    m.updateUser('far', taste(0.9), NOW);
    m.updateUser('near', taste(0.52), NOW);
    expect(m.findMatch('me', NOW)?.userB).toBe('near');
    expect(m.findMatch('me', NOW)?.userB).toBe('far');
    expect(m.findMatch('me', NOW)).toBeNull();
  });

  it('R_HOME_19 ties are broken by user ID', () => {
    const m = model();
    m.updateUser('me', taste(0.5), NOW);
    m.updateUser('zed', taste(0.6), NOW);
    m.updateUser('amy', taste(0.6), NOW);
    expect(m.findMatch('me', NOW)?.userB).toBe('amy');
  });

  it.each([
    ['exactly 72 h ago is active', ACTIVE_WINDOW_MS, 'old'],
    ['72 h and 1 ms ago is not', ACTIVE_WINDOW_MS + 1, undefined],
  ])('R_HOME_19 %s', (_, age, expected) => {
    const m = model();
    m.updateUser('me', taste(0.5), NOW);
    m.updateUser('old', taste(0.5), NOW - age);
    expect(m.findMatch('me', NOW)?.userB).toBe(expected);
  });

  it('a user who never swiped has no match and is never offered', () => {
    const m = model();
    expect(m.findMatch('ghost', NOW)).toBeNull();
    m.updateUser('me', taste(0.5), NOW);
    expect(m.findMatch('me', NOW)).toBeNull();
  });

  it('R_HOME_22 a declined pair is never proposed again, from either side', () => {
    const m = model();
    m.updateUser('me', taste(0.5), NOW);
    m.updateUser('other', taste(0.5), NOW);
    const match = m.findMatch('me', NOW)!;
    m.recordDecision(match.matchId, 'other', false);
    expect(m.findMatch('me', NOW)).toBeNull();
    expect(m.findMatch('other', NOW)).toBeNull();
  });

  it('R_HOME_20 a proposed match is pending for both users until each answers', () => {
    const m = model();
    m.updateUser('a', taste(0.5), NOW);
    m.updateUser('b', taste(0.5), NOW);
    const match = m.findMatch('a', NOW)!;
    expect(m.getPendingMatches('a')).toEqual([match]);
    expect(m.getPendingMatches('b')).toEqual([match]);
    m.recordDecision(match.matchId, 'a', true);
    expect(m.getPendingMatches('a')).toEqual([]);
    expect(m.getPendingMatches('b')).toEqual([match]);
  });

  describe('recordDecision', () => {
    function pending() {
      const m = model();
      const match: Match = { matchId: 'm', userA: 'a', userB: 'b', compatibilityPercent: 50 };
      m.addMatch(match, []);
      return m;
    }

    it('R_HOME_23 only the confirmation that completes the match returns true', () => {
      const m = pending();
      expect(m.recordDecision('m', 'a', true)).toBe(false);
      expect(m.recordDecision('m', 'a', true)).toBe(false);
      expect(m.recordDecision('m', 'b', true)).toBe(true);
      m.attachChat('m', 'c');
      expect(m.chatIdOf('m')).toBe('c');
      expect(m.recordDecision('m', 'b', true)).toBe(false);
    });

    it('concurrency: when both confirm at once, exactly one call completes the match', async () => {
      const m = pending();
      const results = await Promise.all(
        ['a', 'b', 'a', 'b', 'a', 'b'].map(async (user) => m.recordDecision('m', user, true)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('a decline ends the match, even after the other user confirmed', () => {
      const m = pending();
      m.recordDecision('m', 'a', true);
      expect(m.recordDecision('m', 'b', false)).toBe(false);
      expect(m.recordDecision('m', 'b', true)).toBe(false);
      expect(m.recordDecision('m', 'a', true)).toBe(false);
      expect(m.chatIdOf('m')).toBeNull();
    });

    it('a user can take back their own yes before the match completes', () => {
      const m = pending();
      m.recordDecision('m', 'a', true);
      m.recordDecision('m', 'a', false);
      expect(m.recordDecision('m', 'b', true)).toBe(false);
    });

    it('a completed match cannot be declined', () => {
      const m = pending();
      m.recordDecision('m', 'a', true);
      m.recordDecision('m', 'b', true);
      m.attachChat('m', 'c');
      expect(m.recordDecision('m', 'a', false)).toBe(false);
      expect(m.chatIdOf('m')).toBe('c');
    });

    it('rejects outsiders and unknown matches', () => {
      const m = pending();
      expect(() => m.recordDecision('m', 'c', true)).toThrow();
      expect(() => m.recordDecision('nope', 'a', true)).toThrow();
    });
  });

  it('checkRep rejects bad matches', () => {
    const add = (match: Match, confirmedBy: string[] = [], chatId: string | null = null) => () =>
      model().addMatch(match, confirmedBy, chatId);
    const base: Match = { matchId: 'm', userA: 'a', userB: 'b', compatibilityPercent: 50 };
    expect(add({ ...base, userB: 'a' })).toThrow(/users differ/);
    expect(add({ ...base, compatibilityPercent: 101 })).toThrow(/percent/);
    expect(add({ ...base, compatibilityPercent: -1 })).toThrow(/percent/);
    expect(add(base, ['z'])).toThrow(/confirmed valid/);
    expect(add(base, ['a'], 'c')).toThrow(/chat only/);
    const m = model();
    m.addMatch(base, []);
    expect(() => m.addMatch({ ...base, matchId: 'm2', userA: 'b', userB: 'a' }, [])).toThrow(/one match per pair/);
  });

  it('checkRep rejects an invalid decline', () => {
    const m = model();
    m.addMatch({ matchId: 'm', userA: 'a', userB: 'b', compatibilityPercent: 50 }, []);
    const state = (m as unknown as { matches: Map<string, { declined: Set<string> }> }).matches.get('m')!;
    state.declined.add('z');
    expect(() => m.checkRep()).toThrow(/declined valid/);
  });
});
