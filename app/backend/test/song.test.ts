import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Feedback, ListeningEvent, Song } from '../src/model/types';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { MusicTasteModel } from '../src/song/MusicTasteModel';
import { SongLibrary } from '../src/song/SongLibrary';
import { SongController } from '../src/song/SongController';
import { SongSuggestionModel } from '../src/song/SongSuggestionModel';
import { MemoryTable } from '../src/store/MemoryTable';
import { catalogOf, makeLibrary, makeWorld, song, statusOf } from './helpers';

const seven = (v: number) => new Array<number>(FEATURE_COUNT).fill(v);
const listen = (s: Song, feedback: Feedback, secondsListened = s.durationSeconds): ListeningEvent => ({
  song: s,
  feedback,
  secondsListened,
  time: 0,
});
const MAX = MusicTasteModel.MAX_STEP;
const SKIP = MusicTasteModel.SKIP_STRENGTH;

describe('MusicTasteModel', () => {
  // spec: computeWeight is in [-MAX_STEP, MAX_STEP], increasing in the fraction listened,
  // > 0 for LIKE and <= 0 for SKIP (boundaries: 0%, 100%)
  it('R_HOME_17_computeWeightFollowsItsSpecAtTheBoundaries', () => {
    const model = makeWorld().services.tasteModel;
    const s = song('a', 0.5, 200);
    expect(model.computeWeight(listen(s, 'LIKE', 0))).toBeCloseTo(MAX / 2);
    expect(model.computeWeight(listen(s, 'LIKE', 100))).toBeCloseTo(MAX * 0.75);
    expect(model.computeWeight(listen(s, 'LIKE', 200))).toBeCloseTo(MAX);
    expect(model.computeWeight(listen(s, 'SKIP', 0))).toBeCloseTo(-MAX * SKIP);
    expect(model.computeWeight(listen(s, 'SKIP', 100))).toBeCloseTo((-MAX * SKIP) / 2);
    expect(model.computeWeight(listen(s, 'SKIP', 200))).toBe(0);
    // out-of-range listen times are treated as the nearest bound
    expect(model.computeWeight(listen(s, 'LIKE', 999))).toBeCloseTo(MAX);
    expect(model.computeWeight(listen(s, 'SKIP', -5))).toBeCloseTo(-MAX * SKIP);
  });

  it('R_HOME_17_aNewUserHasTheNeutralTasteVectorAndNoHistory', async () => {
    const model = makeWorld().services.tasteModel;
    expect((await model.getTasteVector('u')).values()).toEqual(seven(0.5));
    expect(await model.getRecentSongs('u')).toEqual([]);
  });

  it('R_HOME_17_aLikeMovesTheTasteVectorTowardTheSongAndASkipMovesItAway', async () => {
    const model = makeWorld().services.tasteModel;
    const s = song('a', [1, 1, 1, 0, 0, 0, 0.5]);
    await model.recordListen('liker', listen(s, 'LIKE')); // w = +0.2
    const liked = (await model.getTasteVector('liker')).values();
    expect(liked[0]).toBeCloseTo(0.6);
    expect(liked[3]).toBeCloseTo(0.4);
    expect(liked[6]).toBeCloseTo(0.5);
    await model.recordListen('skipper', listen(s, 'SKIP', 0)); // w = -0.05: a skip is weaker than a like
    const skipped = (await model.getTasteVector('skipper')).values();
    expect(skipped[0]).toBeCloseTo(0.475);
    expect(skipped[3]).toBeCloseTo(0.525);
    expect(skipped[6]).toBeCloseTo(0.5);
  });

  it('R_HOME_12_theSongsOwnFeaturesAreWhatIsFoldedIn', async () => {
    const model = makeWorld().services.tasteModel;
    await model.recordListen('u', listen(song('x', [1, 0, 1, 0, 1, 0, 1]), 'LIKE'));
    const v = (await model.getTasteVector('u')).values();
    expect(v.map((x) => Math.round(x * 10) / 10)).toEqual([0.6, 0.4, 0.6, 0.4, 0.6, 0.4, 0.6]);
  });

  // spec: entries are clamped to [0, 1] (skipping songs at the far corner repeatedly)
  it('R_HOME_17_theTasteVectorIsClampedAtItsBounds', async () => {
    const model = makeWorld().services.tasteModel;
    for (let i = 0; i < 400; i++) {
      await model.recordListen('u', listen(song('zero', 0), 'SKIP', 0));
    }
    expect((await model.getTasteVector('u')).values()).toEqual(seven(1));
    for (let i = 0; i < 400; i++) {
      await model.recordListen('v', listen(song('one', 1), 'SKIP', 0));
    }
    expect((await model.getTasteVector('v')).values()).toEqual(seven(0));
  });

  // boundary: 100th vs 101st history entry
  it('R_HOME_17_historyKeepsTheLatest100SongsMostRecentFirst', async () => {
    const library = new SongLibrary(Array.from({ length: 101 }, (_, i) => song(`h${String(i).padStart(3, '0')}`)));
    const model = new MusicTasteModel(new MemoryTable(), catalogOf(library));
    for (const s of library.all().slice(0, 100)) {
      await model.recordListen('u', listen(s, 'LIKE'));
    }
    let recent = await model.getRecentSongs('u');
    expect(recent).toHaveLength(100);
    expect(recent[0]!.id).toBe('h099');
    expect(recent[99]!.id).toBe('h000');
    await model.recordListen('u', listen(library.get('h100')!, 'SKIP'));
    recent = await model.getRecentSongs('u');
    expect(recent).toHaveLength(MusicTasteModel.HISTORY_SIZE);
    expect(recent[0]!.id).toBe('h100');
    expect(recent[99]!.id).toBe('h001'); // h000 dropped
    expect(recent[0]!.features).toBeDefined(); // R-HOME-12: features come with the song
  });

  // spec: songs no longer in the library are left out of getRecentSongs
  it('leaves out history entries whose song left the library', async () => {
    const { services, library } = makeWorld();
    await services.tasteModel.recordListen('u', listen(song('gone'), 'LIKE'));
    await services.tasteModel.recordListen('u', listen(library.get('s03')!, 'LIKE'));
    expect((await services.tasteModel.getRecentSongs('u')).map((s) => s.id)).toEqual(['s03']);
  });

  // proof 2 (testing.md): for any sequence of listens every entry stays in [0, 1]
  it('proof_theTasteVectorNeverLeavesTheUnitCubeForAnyListeningBehaviour', async () => {
    const unit = fc.double({ min: 0, max: 1, noNaN: true });
    const event = fc.record({
      features: fc.array(unit, { minLength: FEATURE_COUNT, maxLength: FEATURE_COUNT }),
      feedback: fc.constantFrom<Feedback>('LIKE', 'SKIP'),
      fraction: fc.oneof(unit, fc.constantFrom(0, 1)),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(event, { minLength: 1, maxLength: 40 }), async (events) => {
        const model = new MusicTasteModel(new MemoryTable(), catalogOf(makeLibrary()));
        for (const [i, e] of events.entries()) {
          const s = song(`p${i}`, e.features, 100);
          const w = model.computeWeight(listen(s, e.feedback, e.fraction * 100));
          expect(Math.abs(w)).toBeLessThanOrEqual(MAX);
          expect(e.feedback === 'LIKE' ? w > 0 : w <= 0).toBe(true);
          await model.recordListen('u', listen(s, e.feedback, e.fraction * 100));
          const vector = await model.getTasteVector('u'); // constructing it checks the rep invariant
          expect(vector.values().every((x) => x >= 0 && x <= 1)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('concurrency_noConcurrentListenIsLost', async () => {
    const { services, library } = makeWorld({ librarySize: 30 });
    await Promise.all(library.all().slice(0, 25).map((s) => services.tasteModel.recordListen('u', listen(s, 'LIKE'))));
    const ids = (await services.tasteModel.getRecentSongs('u')).map((s) => s.id);
    expect(new Set(ids).size).toBe(25);
  });
});

describe('SongSuggestionModel', () => {
  const taste = (v: number) => new TasteVector(seven(v));

  it('R_HOME_01_holdsTheLibraryAndNeedsMoreThanCacheSizeSongs', async () => {
    const { services, library } = makeWorld();
    expect(services.suggestionModel.getLibrary()).toBe(library.all());
    expect((await services.suggestionModel.getSong('s01'))!.id).toBe('s01');
    expect(await services.suggestionModel.getSong('nope')).toBeUndefined();
    expect(() => new SongSuggestionModel(catalogOf(makeLibrary(SongSuggestionModel.CACHE_SIZE)), new MemoryTable())).toThrow(RangeError);
    expect(() => new SongSuggestionModel(catalogOf(makeLibrary(SongSuggestionModel.CACHE_SIZE + 1)), new MemoryTable())).not.toThrow();
  });

  // spec: up to count songs, none excluded, closest first, ties by ID
  it('findNearest orders by distance, breaks ties by ID and honours exclude and count', () => {
    const model = makeWorld({ librarySize: 11 }).services.suggestionModel; // levels 0, 0.1, ..., 1
    const ids = (v: number, count: number, exclude: string[] = []) =>
      model.findNearest(taste(v), count, new Set(exclude)).map((s) => s.id);
    expect(ids(0, 3)).toEqual(['s00', 's01', 's02']);
    expect(ids(1, 2)).toEqual(['s10', 's09']);
    expect(ids(0.5, 3)).toEqual(['s05', 's04', 's06']); // s04 and s06 tie; lower ID first
    expect(ids(0.5, 1, ['s05', 's04'])).toEqual(['s06']);
    expect(ids(0.5, 99)).toHaveLength(11);
    expect(ids(0.5, 5, model.getLibrary().map((s) => s.id))).toEqual([]);
  });

  it('R_HOME_15_suggestionsComeNearestFirstFromThePreloadedCache', async () => {
    const model = makeWorld({ librarySize: 11 }).services.suggestionModel;
    await model.preloadCache('u', taste(0));
    expect((await model.nextSuggestion('u', taste(0))).id).toBe('s00');
    expect((await model.nextSuggestion('u', taste(0))).id).toBe('s01');
    // preloading again replaces the cache but still avoids recent suggestions
    await model.preloadCache('u', taste(1));
    expect((await model.nextSuggestion('u', taste(1))).id).toBe('s10');
  });

  it('R_HOME_15_withoutAPreloadTheCacheFillsItselfAndNoSongRepeatsWhileOthersRemain', async () => {
    const model = makeWorld({ librarySize: 12 }).services.suggestionModel;
    // 12 songs, cache of 5: a song cannot come back within the next 12 - 5 = 7 suggestions
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const next = (await model.nextSuggestion('u', taste(i < 20 ? 0.5 : 0.9))).id;
      expect(seen.slice(-7)).not.toContain(next);
      seen.push(next);
    }
    expect(new Set(seen).size).toBeGreaterThanOrEqual(8);
  });

  // boundary: the smallest allowed library (CACHE_SIZE + 1 songs)
  it('R_HOME_15_theSmallestLibraryStillAlwaysHasANextSong', async () => {
    const model = new SongSuggestionModel(catalogOf(makeLibrary(6)), new MemoryTable());
    await model.preloadCache('u', taste(0.2));
    let previous = '';
    for (let i = 0; i < 25; i++) {
      const next = (await model.nextSuggestion('u', taste(0.2))).id;
      expect(next).not.toBe(previous);
      previous = next;
    }
    await model.preloadCache('u', taste(0.2)); // also works when every song is recent
    expect((await model.nextSuggestion('u', taste(0.2))).id).not.toBe(previous);
  });

  // spec: cached songs that left the library are dropped
  it('skips cached songs that are no longer in the library', async () => {
    const table = new MemoryTable();
    const model = new SongSuggestionModel(catalogOf(makeLibrary(12), table), table);
    const item = { pk: 'USER#u', sk: 'SUGGEST', version: 1, cache: ['gone', 's07', 'gone-too'], recent: [] };
    await table.write([{ op: 'put', item, expect: 'any' }]);
    expect((await model.nextSuggestion('u', taste(0))).id).toBe('s07');
    const stored = (await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!;
    expect(stored.cache).toHaveLength(SongSuggestionModel.CACHE_SIZE);
    expect(stored.cache).not.toContain('gone');
  });

  it('concurrency_concurrentRequestsNeverGetTheSameSuggestion', async () => {
    const model = makeWorld({ librarySize: 30 }).services.suggestionModel;
    const songs = await Promise.all(Array.from({ length: 10 }, () => model.nextSuggestion('u', taste(0.5))));
    expect(new Set(songs.map((s) => s.id)).size).toBe(10);
  });
});

describe('SongController', () => {
  it('R_HOME_03_thereIsAlwaysACurrentSongAndItStaysUntilTheUserLeavesIt', async () => {
    const { services } = makeWorld();
    const first = await services.songs.getCurrentSong('u');
    expect(await services.songs.getCurrentSong('u')).toEqual(first);
    await services.songs.onAppOpened('u'); // reopening the app keeps the active song
    expect(await services.songs.getCurrentSong('u')).toEqual(first);
    expect((await services.songs.getTasteVector('u')).values()).toEqual(seven(0.5));
  });

  it('R_HOME_15_R_HOME_16_aSwipeMovesToANewSong', async () => {
    const { services } = makeWorld();
    const first = await services.songs.getCurrentSong('u');
    const result = await services.songs.submitFeedback('u', first.id, 'SKIP', 3);
    expect(result.nextSong.id).not.toBe(first.id);
    expect(result.offeredMatch).toBeUndefined();
    expect(await services.songs.getCurrentSong('u')).toEqual(result.nextSong);
    expect((await services.tasteModel.getRecentSongs('u')).map((s) => s.id)).toEqual([first.id]);
  });

  it('R_HOME_17_aSwipeUpdatesTheTasteVectorAndTheLeaderboards', async () => {
    const { services, clock } = makeWorld({ librarySize: 12 });
    await services.songs.onAppOpened('u');
    // push the taste to one side first so the next songs are not at the neutral point
    await services.tasteModel.recordListen('u', listen(song('far', 1), 'LIKE'));
    const before = (await services.songs.getTasteVector('u')).values()[0]!;
    const current = await services.songs.getCurrentSong('u');
    await services.songs.submitFeedback('u', current.id, 'LIKE', current.durationSeconds);
    const after = await services.songs.getTasteVector('u');
    const level = current.features.values()[0]!;
    expect(after.values()[0]).toBeCloseTo(before + MAX * (level - before));
    expect(await services.matchModel.getLeaderboard(0, 5)).toEqual(['u']);
    await services.matchModel.updateUser('twin', after, clock.now);
    expect(await services.matchModel.compatibility('u', 'twin')).toBeCloseTo(100);
  });

  it('R_HOME_25_theLikeButtonKeepsTheSongAndCountsOnceWhenTheUserLeaves', async () => {
    const { services } = makeWorld();
    await services.tasteModel.recordListen('a', listen(song('far', 1), 'LIKE'));
    await services.tasteModel.recordListen('b', listen(song('far', 1), 'LIKE'));
    const current = await services.songs.getCurrentSong('a');
    expect((await services.songs.getCurrentSong('b')).id).toBe(current.id);

    await services.songs.markLiked('a', current.id);
    await services.songs.markLiked('a', current.id); // idempotent
    expect(await services.songs.getCurrentSong('a')).toEqual(current); // same song keeps playing
    // a liked the song then swiped left; b swiped right: both count as one like
    await services.songs.submitFeedback('a', current.id, 'SKIP', 50);
    await services.songs.submitFeedback('b', current.id, 'LIKE', 50);
    expect((await services.songs.getTasteVector('a')).values()).toEqual((await services.songs.getTasteVector('b')).values());
    expect((await services.tasteModel.getRecentSongs('a')).map((s) => s.id)).toEqual([current.id]); // once

    // the like does not carry over to the next song
    const next = await services.songs.getCurrentSong('a');
    const beforeSkip = (await services.songs.getTasteVector('a')).values()[0]!;
    await services.songs.submitFeedback('a', next.id, 'SKIP', 0);
    const level = next.features.values()[0]!;
    expect((await services.songs.getTasteVector('a')).values()[0]).toBeCloseTo(beforeSkip - MAX * SKIP * (level - beforeSkip));
  });

  // spec: Requires songId is the active song -> 409; secondsListened finite and >= 0 -> 400
  it('rejects feedback and likes for a song that is not active, and invalid listen times', async () => {
    const { services } = makeWorld();
    expect(await statusOf(services.songs.markLiked('u', 's00'))).toBe(409); // no active song yet
    expect(await statusOf(services.songs.submitFeedback('u', 's00', 'LIKE', 1))).toBe(409);
    const current = await services.songs.getCurrentSong('u');
    const other = current.id === 's00' ? 's01' : 's00';
    expect(await statusOf(services.songs.markLiked('u', other))).toBe(409);
    expect(await statusOf(services.songs.submitFeedback('u', other, 'LIKE', 1))).toBe(409);
    expect(await statusOf(services.songs.submitFeedback('u', current.id, 'LIKE', -1))).toBe(400);
    expect(await statusOf(services.songs.submitFeedback('u', current.id, 'LIKE', NaN))).toBe(400);
    expect(await services.songs.getCurrentSong('u')).toEqual(current); // nothing changed
    expect(await services.tasteModel.getRecentSongs('u')).toEqual([]);
  });

  // spec: listen times above the duration count as the whole song
  it('treats a listen time beyond the duration as the whole song', async () => {
    const { services } = makeWorld();
    for (const user of ['a', 'b']) {
      await services.tasteModel.recordListen(user, listen(song('far', 0), 'LIKE'));
    }
    const current = await services.songs.getCurrentSong('a');
    await services.songs.getCurrentSong('b');
    await services.songs.submitFeedback('a', current.id, 'LIKE', current.durationSeconds);
    await services.songs.submitFeedback('b', current.id, 'LIKE', current.durationSeconds + 500);
    expect((await services.songs.getTasteVector('a')).values()).toEqual((await services.songs.getTasteVector('b')).values());
  });

  it('R_HOME_19_aSwipeOffersAMatchWhenTheRandomIntervalIsReached', async () => {
    const { services, random, clock } = makeWorld();
    await services.matchModel.updateUser('other', TasteVector.neutral(), clock.now);
    random.ints.push(2); // first interval: offer due at swipe 1 + 2 = 3
    const offers: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const current = await services.songs.getCurrentSong('u');
      const result = await services.songs.submitFeedback('u', current.id, 'LIKE', 10);
      offers.push(result.offeredMatch !== undefined);
      if (result.offeredMatch) {
        expect([result.offeredMatch.userA, result.offeredMatch.userB].sort()).toEqual(['other', 'u']);
      }
    }
    expect(offers).toEqual([false, false, true]);
  });

  it('concurrency_aSwipeSentSeveralTimesCountsOnce', async () => {
    const { services } = makeWorld();
    const current = await services.songs.getCurrentSong('u');
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => services.songs.submitFeedback('u', current.id, 'LIKE', 20)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason.code).toBe('SONG_NOT_ACTIVE');
      }
    }
    expect(await services.tasteModel.getRecentSongs('u')).toHaveLength(1);
  });

  it('concurrency_concurrentFirstRequestsAgreeOnTheCurrentSong', async () => {
    const { services } = makeWorld();
    const songs = await Promise.all(Array.from({ length: 8 }, () => services.songs.getCurrentSong('u')));
    expect(new Set(songs.map((s) => s.id)).size).toBe(1);
  });
});

describe('cold start and taste-led order (notes-for-felix F-12)', () => {
  const taste = (v: number) => new TasteVector(seven(v));

  // spec: a cache filled for a neutral taste is spread across the library
  it('R_HOME_15_aNewUsersFirstSongsAreSpreadAcrossTheLibrary', async () => {
    const model = makeWorld({ librarySize: 21 }).services.suggestionModel; // levels 0, 0.05, ..., 1
    const first: number[] = [];
    for (let i = 0; i < SongSuggestionModel.CACHE_SIZE; i++) {
      first.push((await model.nextSuggestion('new', TasteVector.neutral())).features.values()[0]!);
    }
    expect(first[0]).toBeCloseTo(0.5); // starts at the centre
    expect(Math.min(...first)).toBe(0); // and reaches both ends of the library
    expect(Math.max(...first)).toBe(1);
    // a user with a taste gets the nearest songs instead
    const near: number[] = [];
    for (let i = 0; i < SongSuggestionModel.CACHE_SIZE; i++) {
      near.push((await model.nextSuggestion('old', taste(0.2))).features.values()[0]!);
    }
    expect(Math.max(...near)).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  // spec: after the first CACHE_SIZE suggestions the cached song nearest taste plays next
  it('R_HOME_15_afterTheFirstFiveTheCachedSongNearestTheCurrentTasteIsNext', async () => {
    const model = makeWorld({ librarySize: 21 }).services.suggestionModel;
    for (let i = 0; i < SongSuggestionModel.CACHE_SIZE; i++) {
      await model.nextSuggestion('u', taste(0.2));
    }
    // the cache was filled near 0.2; the taste has since moved to the top end
    const next = await model.nextSuggestion('u', taste(1));
    const after = await model.nextSuggestion('u', taste(1));
    expect(next.features.values()[0]).toBeGreaterThan(0.2);
    expect(after.features.values()[0]).toBe(1); // the refill near the new taste is picked at once
  });
});

describe('undo (api.md Q-14)', () => {
  it('undoLastListen restores the Taste Vector and history, up to UNDO_LIMIT listens back', async () => {
    const { services, library } = makeWorld({ librarySize: 30 });
    const model = services.tasteModel;
    expect(await model.undoLastListen('u')).toBe(false); // nothing to undo
    const snapshots: { vector: number[]; history: string[] }[] = [];
    const snapshot = async () => ({
      vector: (await model.getTasteVector('u')).values(),
      history: (await model.getRecentSongs('u')).map((s) => s.id),
    });
    const total = MusicTasteModel.UNDO_LIMIT + 3;
    for (const s of library.all().slice(0, total)) {
      snapshots.push(await snapshot());
      await model.recordListen('u', listen(s, 'LIKE', 30));
    }
    for (let i = 0; i < MusicTasteModel.UNDO_LIMIT; i++) {
      expect(await model.undoLastListen('u')).toBe(true);
      expect(await snapshot()).toEqual(snapshots[total - 1 - i]);
    }
    expect(await model.undoLastListen('u')).toBe(false); // only the last UNDO_LIMIT can be undone
    expect((await model.getRecentSongs('u')).length).toBe(3);
  });

  // boundary: undoing the listen that pushed the 100th-oldest entry out brings it back
  it('undoLastListen brings back the history entry the listen pushed out', async () => {
    const library = new SongLibrary(Array.from({ length: 101 }, (_, i) => song(`h${String(i).padStart(3, '0')}`)));
    const model = new MusicTasteModel(new MemoryTable(), catalogOf(library));
    for (const s of library.all()) {
      await model.recordListen('u', listen(s, 'LIKE'));
    }
    expect((await model.getRecentSongs('u')).at(-1)!.id).toBe('h001');
    expect(await model.undoLastListen('u')).toBe(true);
    const recent = await model.getRecentSongs('u');
    expect(recent).toHaveLength(100);
    expect(recent[0]!.id).toBe('h099');
    expect(recent.at(-1)!.id).toBe('h000');
  });

  it('returnSuggestion puts the song back at the front of the cache and forgets it was suggested', async () => {
    const { services, table } = makeWorld({ librarySize: 21 });
    const model = services.suggestionModel;
    const t = new TasteVector(seven(0.2));
    const first = await model.nextSuggestion('u', t);
    const second = await model.nextSuggestion('u', t);
    await model.returnSuggestion('u', second);
    const state = (await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!;
    expect((state.cache as string[])[0]).toBe(second.id);
    expect(state.cache).toHaveLength(SongSuggestionModel.CACHE_SIZE);
    expect(new Set(state.cache as string[]).size).toBe(SongSuggestionModel.CACHE_SIZE);
    expect(state.cache).not.toContain(first.id);
    expect(state.recent).toEqual([first.id]);
    expect(state.count).toBe(1);
    expect((await model.nextSuggestion('u', t)).id).toBe(second.id); // and it is suggested again next
    // returning a song that is not the latest suggestion leaves the recent list alone
    await model.returnSuggestion('other', first);
    expect((await table.get({ pk: 'USER#other', sk: 'SUGGEST' }))!).toMatchObject({ cache: [first.id], recent: [], count: 0 });
  });

  it('undoLastSwipe goes back one song and reverses the swipe, so a song swiped again counts once', async () => {
    const { services } = makeWorld({ librarySize: 21 });
    const songs = services.songs;
    expect(await songs.canUndo('u')).toBe(false);
    expect(await songs.undoLastSwipe('u')).toBeUndefined();

    // move the taste off the centre first, so the first song (at the centre) can change it
    await services.tasteModel.recordListen('u', listen(song('far', 1), 'LIKE', 50)); // lands between songs
    const first = await songs.getCurrentSong('u');
    await songs.markLiked('u', first.id);
    const tasteBefore = (await songs.getTasteVector('u')).values();
    const { nextSong: second } = await songs.submitFeedback('u', first.id, 'SKIP', 40);
    expect(await songs.canUndo('u')).toBe(true);
    expect((await songs.getTasteVector('u')).values()).not.toEqual(tasteBefore);

    const undone = (await songs.undoLastSwipe('u'))!;
    expect(undone).toEqual({ song: first, liked: true, canUndo: false }); // the heart is as it was
    expect(await songs.getCurrentSong('u')).toEqual(first);
    expect((await songs.getTasteVector('u')).values()).toEqual(tasteBefore);
    expect(await services.tasteModel.getRecentSongs('u')).toEqual([]);
    expect(await songs.canUndo('u')).toBe(false);
    expect(await songs.undoLastSwipe('u')).toBeUndefined();

    // swiping the restored song again leads to the same next song, and it is in the history once
    const again = await songs.submitFeedback('u', first.id, 'SKIP', 40);
    expect(again.nextSong).toEqual(second);
    expect((await services.tasteModel.getRecentSongs('u')).map((s) => s.id)).toEqual([first.id]);
    expect(await statusOf(songs.submitFeedback('u', first.id, 'SKIP', 40))).toBe(409);
  });

  // boundary: UNDO_LIMIT swipes can be undone in a row, the one before them cannot
  it('undoLastSwipe reverses up to UNDO_LIMIT swipes in a row', async () => {
    const { services } = makeWorld({ librarySize: 40 });
    const songs = services.songs;
    const visited: string[] = [];
    for (let i = 0; i < SongController.UNDO_LIMIT + 2; i++) {
      const current = await songs.getCurrentSong('u');
      visited.push(current.id);
      await songs.submitFeedback('u', current.id, i % 2 ? 'LIKE' : 'SKIP', 20);
    }
    for (let i = 0; i < SongController.UNDO_LIMIT; i++) {
      const undone = (await songs.undoLastSwipe('u'))!;
      expect(undone.song.id).toBe(visited[visited.length - 1 - i]);
      expect(undone.canUndo).toBe(i < SongController.UNDO_LIMIT - 1);
    }
    expect(await songs.undoLastSwipe('u')).toBeUndefined();
    expect(await services.tasteModel.getRecentSongs('u')).toHaveLength(2); // the two oldest swipes stay
  });

  it('undoLastSwipe skips a swipe whose song has left the library', async () => {
    const { services, table } = makeWorld();
    const item = { pk: 'USER#u', sk: 'SONGSTATE', version: 1, active: 's01', liked: false, swipeCount: 1, undo: [{ songId: 'gone', liked: false }] };
    await table.write([{ op: 'put', item, expect: 'any' }]);
    expect(await services.songs.undoLastSwipe('u')).toBeUndefined();
    expect((await services.songs.getCurrentSong('u')).id).toBe('s01');
  });

  it('concurrency_concurrentUndosEachReverseADifferentSwipe', async () => {
    const { services } = makeWorld({ librarySize: 40 });
    const songs = services.songs;
    for (let i = 0; i < 3; i++) {
      const current = await songs.getCurrentSong('u');
      await songs.submitFeedback('u', current.id, 'LIKE', 20);
    }
    const results = await Promise.all(Array.from({ length: 6 }, () => songs.undoLastSwipe('u')));
    const undone = results.filter((r) => r !== undefined);
    expect(undone).toHaveLength(3);
    expect(new Set(undone.map((r) => r.song.id)).size).toBe(3);
    expect(await songs.canUndo('u')).toBe(false);
  });
});
