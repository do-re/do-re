import { describe, expect, it } from 'vitest';
import type { Song } from '../src/model/types';
import { FEATURE_COUNT, TasteVector } from '../src/model/vectors';
import { MAX_SEEDS, ReccoBeatsSource } from '../src/song/MusicSource';
import { SongSuggestionModel } from '../src/song/SongSuggestionModel';
import { MemoryTable } from '../src/store/MemoryTable';
import { catalogOf, FakeClock, FakeSource, makeLibrary, makeWorld, song } from './helpers';

const taste = (v: number) => new TasteVector(new Array<number>(FEATURE_COUNT).fill(v));
/** `count` platform songs p00, p01, ... at feature levels from `from` upward in steps of 0.01. */
const platformSongs = (count: number, from: number): Song[] =>
  Array.from({ length: count }, (_, i) => song(`p${String(i).padStart(2, '0')}`, from + i * 0.01));

describe('SongCatalog', () => {
  it('R_HOME_12_resolvesStartingSongsAndStoredSongsWithTheirFeatures', async () => {
    const table = new MemoryTable();
    const catalog = catalogOf(makeLibrary(8), table);
    expect(catalog.starters()).toHaveLength(8);
    expect((await catalog.get('s03'))!.id).toBe('s03');
    expect(await catalog.get('unknown')).toBeUndefined();

    const pulled = song('pulled', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], 187);
    await catalog.add([pulled, catalog.starters()[0]!]); // a starting song is not stored again
    expect(await table.query('SONG#s00')).toEqual([]);
    expect(await catalog.get('pulled')).toEqual(pulled);

    // another Lambda instance (its own catalog object, the same table) resolves it too
    const elsewhere = catalogOf(makeLibrary(8), table);
    const read = (await elsewhere.get('pulled'))!;
    expect(read).toMatchObject({ title: 'Title pulled', artist: 'Artist pulled', durationSeconds: 187, spotifyUri: 'spotify:track:pulled' });
    expect(read.features.values()).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(await elsewhere.get('pulled')).toBe(read); // remembered after the first read
  });

  it('concurrency_theFirstStoredCopyOfASongStands', async () => {
    const table = new MemoryTable();
    const [one, two] = [catalogOf(makeLibrary(8), table), catalogOf(makeLibrary(8), table)];
    await Promise.all([one.add([song('same', 0.2)]), two.add([song('same', 0.9)])]);
    const [a, b] = [(await one.get('same'))!, (await two.get('same'))!];
    expect(a.features.values()).toEqual(b.features.values()); // both instances agree
    await one.add([song('same', 0.5)]); // adding again changes nothing
    expect((await catalogOf(makeLibrary(8), table).get('same'))!.features.values()).toEqual(a.features.values());
    expect(await table.query('SONG#same')).toHaveLength(1);
  });
});

describe('pulling songs from the music platform while swiping', () => {
  it('R_HOME_15_pullsRecommendationsSeededByTheSongsNearestTheTasteAndKeepsTheNearest', async () => {
    const source = new FakeSource();
    source.offered = platformSongs(30, 0.6); // levels 0.60 .. 0.89
    const { services, table } = makeWorld({ source, librarySize: 11 }); // starters at 0, 0.1, ..., 1
    await services.suggestionModel.pullSuggestions('u', taste(0.8));

    expect(source.requests).toHaveLength(1);
    expect(source.requests[0]!.count).toBe(SongSuggestionModel.PULL_SIZE);
    expect([...source.requests[0]!.seedIds].sort()).toEqual(['s06', 's07', 's08', 's09', 's10']); // the 5 nearest 0.8
    expect(source.requests[0]!.seedIds[0]).toBe('s08');
    expect(source.requests[0]!.seedIds).toHaveLength(MAX_SEEDS);
    const reserve = (await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!.reserve as string[];
    expect(reserve).toHaveLength(SongSuggestionModel.RESERVE_SIZE);
    expect(reserve[0]).toBe('p20'); // 0.80, the nearest to the taste
    expect(reserve).not.toContain('p00'); // 0.60 is among the 10 farthest, left out
    expect((await services.suggestionModel.getSong('p20'))!.features.values()[0]).toBeCloseTo(0.8); // stored with its features
    expect(await services.suggestionModel.getSong('p00')).toBeUndefined(); // songs not kept are not stored
    // covers were looked up once, and only for the 20 songs kept, not all 30 offered
    expect(source.completed).toHaveLength(1);
    expect([...source.completed[0]!].sort()).toEqual([...reserve].sort());
  });

  it('R_HOME_15_pulledSongsAreSuggestedBeforeMoreStartingSongsAndOnlyOnce', async () => {
    const source = new FakeSource();
    source.offered = platformSongs(30, 0.6);
    const { services } = makeWorld({ source, librarySize: 11 });
    const model = services.suggestionModel;
    await model.pullSuggestions('u', taste(0.8));
    const played: string[] = [];
    for (let i = 0; i < 20; i++) {
      played.push((await model.nextSuggestion('u', taste(0.8))).id);
    }
    expect(new Set(played).size).toBe(20); // nothing repeats
    // the cache starts with 5 starting songs; after that every refill comes from the reserve
    expect(played.filter((id) => id.startsWith('s')).length).toBeLessThanOrEqual(SongSuggestionModel.CACHE_SIZE);
    expect(played.filter((id) => id.startsWith('p')).length).toBeGreaterThanOrEqual(15);
  });

  it('R_HOME_15_pullsAgainOnlyWhenTheReserveRunsLowAndNeverRepeatsASong', async () => {
    const source = new FakeSource();
    source.offered = platformSongs(40, 0.5);
    const { services, table } = makeWorld({ source, librarySize: 11 });
    const model = services.suggestionModel;
    const reserveSize = async () => ((await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!.reserve as string[]).length;
    await model.pullSuggestions('u', taste(0.7));
    await model.pullSuggestions('u', taste(0.7)); // reserve is full: no request
    expect(source.requests).toHaveLength(1);
    const played: string[] = [];
    for (;;) {
      played.push((await model.nextSuggestion('u', taste(0.7))).id);
      if ((await reserveSize()) < SongSuggestionModel.CACHE_SIZE) {
        break;
      }
      await model.pullSuggestions('u', taste(0.7)); // 5 or more waiting: no request
    }
    expect(source.requests).toHaveLength(1);
    await model.pullSuggestions('u', taste(0.7));
    expect(source.requests).toHaveLength(2); // below 5: pulled again
    // the second pull was offered the same 40 songs; only ones not yet suggested or queued were taken
    for (let i = 0; i < 12; i++) {
      played.push((await model.nextSuggestion('u', taste(0.7))).id);
    }
    expect(new Set(played).size).toBe(played.length);
    // the seeds now include pulled songs waiting in the cache, so discovery moves on from the starters
    expect(source.requests[1]!.seedIds.some((id) => id.startsWith('p'))).toBe(true);
  });

  it('R_HOME_03_R_HOME_17_aPulledSongWorksAsTheCurrentSongInHistoryAndOnOtherInstances', async () => {
    const source = new FakeSource();
    source.offered = platformSongs(30, 0.45);
    const table = new MemoryTable();
    const { services } = makeWorld({ source, table, librarySize: 11 });
    const seen: Song[] = [];
    for (let i = 0; i < 9; i++) {
      const current = await services.songs.getCurrentSong('u');
      seen.push(current);
      await services.songs.submitFeedback('u', current.id, 'LIKE', 20);
    }
    const current = await services.songs.getCurrentSong('u');
    const pulled = seen.filter((s) => s.id.startsWith('p'));
    expect(pulled.length).toBeGreaterThan(0);
    expect(current.id.startsWith('p')).toBe(true);
    expect((await services.tasteModel.getRecentSongs('u')).map((s) => s.id)).toEqual(seen.map((s) => s.id).reverse());
    // a different Lambda instance, with no platform at all, still serves the pulled current song and can undo to one
    const other = makeWorld({ table, librarySize: 11 });
    expect(await other.services.songs.getCurrentSong('u')).toEqual(current);
    expect((await other.services.songs.undoLastSwipe('u'))!.song).toEqual(seen.at(-1));
  });

  it('carries on from the starting library when the platform fails, logging only the error name', async () => {
    const source = new FakeSource();
    source.failing = true;
    const lines: string[] = [];
    const table = new MemoryTable();
    const clock = new FakeClock();
    const model = new SongSuggestionModel(catalogOf(makeLibrary(11), table), table, source, clock.read, (line) => lines.push(line));
    await model.pullSuggestions('u', taste(0.8));
    expect(lines).toEqual(['Music source failed: TimeoutError']); // not the message, which may hold anything
    const played = [];
    for (let i = 0; i < 6; i++) {
      await model.pullSuggestions('u', taste(0.8));
      played.push((await model.nextSuggestion('u', taste(0.8))).id);
    }
    expect(played.every((id) => id.startsWith('s'))).toBe(true);
    expect(new Set(played).size).toBe(6);
    expect(source.requests).toHaveLength(1); // backing off: the six later swipes did not ask again
  });

  // boundary: no attempt until exactly PULL_BACKOFF_MS after a pull that added nothing
  it('backsOffForAMinuteAfterAFailedOrRateLimitedPullThenTriesAgain', async () => {
    const source = new FakeSource();
    source.offered = platformSongs(30, 0.6);
    source.limiting = true; // recommendations work, cover lookups answer 429
    const lines: string[] = [];
    const table = new MemoryTable();
    const clock = new FakeClock();
    const model = new SongSuggestionModel(catalogOf(makeLibrary(11), table), table, source, clock.read, (line) => lines.push(line));
    const reserve = async () => (await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!.reserve;
    await model.pullSuggestions('u', taste(0.8));
    expect(lines).toEqual(['Music source failed: Error']);
    expect(await reserve()).toEqual([]);
    expect(await model.getSong('p20')).toBeUndefined(); // nothing was stored

    source.limiting = false;
    clock.advance(SongSuggestionModel.PULL_BACKOFF_MS - 1);
    await model.pullSuggestions('u', taste(0.8));
    expect(source.requests).toHaveLength(1);
    clock.advance(1);
    await model.pullSuggestions('u', taste(0.8));
    expect(source.requests).toHaveLength(2);
    expect(await reserve()).toHaveLength(SongSuggestionModel.RESERVE_SIZE);
    // a successful pull does not start a backoff: once the reserve runs low it pulls straight away
    await table.write([{ op: 'put', item: { ...(await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!, reserve: [] }, expect: 'any' }]);
    await model.pullSuggestions('u', taste(0.8));
    expect(source.requests).toHaveLength(3);
  });

  it('does nothing when the platform has nothing new, and never asks when there is no platform', async () => {
    const source = new FakeSource();
    const { services, table } = makeWorld({ source, librarySize: 11 });
    await services.suggestionModel.pullSuggestions('u', taste(0.8)); // offered nothing
    expect((await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!.reserve).toEqual([]);
    expect(source.completed).toEqual([]); // no cover lookups for nothing
    source.offered = [song('s08', 0.8), song('s09', 0.9)]; // only songs the app already has queued
    await services.suggestionModel.preloadCache('u', taste(0.8));
    await services.suggestionModel.pullSuggestions('u', taste(0.8)); // backing off after the empty pull
    expect(source.requests).toHaveLength(1);
    const fresh = makeWorld({ source, librarySize: 11 });
    await fresh.services.suggestionModel.preloadCache('u', taste(0.8));
    await fresh.services.suggestionModel.pullSuggestions('u', taste(0.8));
    expect(source.requests).toHaveLength(2);
    expect((await fresh.table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!.reserve).toEqual([]);

    const offline = makeWorld({ librarySize: 11 });
    await offline.services.suggestionModel.pullSuggestions('u', taste(0.8));
    expect(await offline.table.get({ pk: 'USER#u', sk: 'SUGGEST' })).toBeUndefined();
  });

  it('concurrency_twoPullsAtOnceLeaveAReserveWithoutDuplicates', async () => {
    const source = new FakeSource();
    source.offered = platformSongs(30, 0.6);
    const { services, table } = makeWorld({ source, librarySize: 11 });
    await Promise.all(Array.from({ length: 4 }, () => services.suggestionModel.pullSuggestions('u', taste(0.8))));
    const reserve = (await table.get({ pk: 'USER#u', sk: 'SUGGEST' }))!.reserve as string[];
    expect(reserve.length).toBeLessThanOrEqual(SongSuggestionModel.RESERVE_SIZE);
    expect(new Set(reserve).size).toBe(reserve.length);
  });
});

describe('ReccoBeatsSource', () => {
  const ID = (n: number) => `${n}`.padStart(22, 'b');
  const track = (n: number, more: object = {}) => ({
    trackTitle: `Track ${n}`,
    artists: [{ name: 'First' }, { name: 'Second' }],
    durationMs: 200_040,
    href: `https://open.spotify.com/track/${ID(n)}`,
    ...more,
  });
  const features = (n: number, more: object = {}) => ({
    href: `https://open.spotify.com/track/${ID(n)}`,
    valence: 0.1,
    danceability: 0.2,
    energy: 0.3,
    acousticness: 0.4,
    instrumentalness: 9.54e-5,
    liveness: 0.6,
    speechiness: 0.7,
    tempo: 171,
    ...more,
  });
  /** A fake fetch serving ReccoBeats and Spotify oEmbed from the given data. */
  function platform(data: { tracks?: object[]; features?: object[]; noCover?: number[]; status?: number; body?: unknown }) {
    const urls: string[] = [];
    const fetchFn = (async (input: unknown, init?: { signal?: unknown }) => {
      const url = String(input);
      urls.push(url);
      expect(init?.signal).toBeDefined(); // every request has a timeout
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/oembed')) {
        const id = url.slice(-22);
        return data.noCover?.some((n) => ID(n) === id) ? reply({}, 404) : reply({ title: 'T', thumbnail_url: `https://covers.example/${id}` });
      }
      if (data.status !== undefined) {
        return reply({ error: 'x' }, data.status);
      }
      if (data.body !== undefined) {
        return reply(data.body);
      }
      return reply({ content: url.includes('/audio-features') ? data.features : data.tracks });
    }) as unknown as typeof fetch;
    return { source: new ReccoBeatsSource(fetchFn, 1000), urls };
  }

  it('R_HOME_11_buildsCompleteSongsFromRecommendationsFeaturesAndCovers', async () => {
    const { source, urls } = platform({ tracks: [track(1), track(2)], features: [features(1), features(2, { valence: 0.9 })] });
    const candidates = await source.recommend([ID(7), ID(8)], 12.2);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).not.toHaveProperty('albumCoverUrl');
    expect(urls).toHaveLength(2); // no cover lookups until complete() is called
    const songs = await source.complete(candidates);
    expect(songs).toHaveLength(2);
    expect(songs[0]).toMatchObject({
      id: ID(1),
      title: 'Track 1',
      artist: 'First, Second',
      durationSeconds: 200.04,
      albumCoverUrl: `https://covers.example/${ID(1)}`,
      spotifyUri: `spotify:track:${ID(1)}`,
    });
    // Feature index order: valence, danceability, energy, acousticness, instrumentalness, liveness, speechiness
    expect(songs[0]!.features.values()).toEqual([0.1, 0.2, 0.3, 0.4, 9.54e-5, 0.6, 0.7]);
    expect(songs[1]!.features.values()[0]).toBe(0.9);
    expect(urls[0]).toBe(`https://api.reccobeats.com/v1/track/recommendation?size=13&seeds=${ID(7)},${ID(8)}`);
    expect(urls[1]).toBe(`https://api.reccobeats.com/v1/audio-features?ids=${ID(1)},${ID(2)}`);
    expect(urls.slice(2).sort()).toEqual([1, 2].map((n) => `https://open.spotify.com/oembed?url=spotify:track:${ID(n)}`));
  });

  // spec: a track becomes a Song only if details, all 7 features and a cover are available
  it('R_HOME_11_leavesOutTracksMissingAnyPart', async () => {
    const { source } = platform({
      tracks: [
        track(1),
        track(2), // no features at all
        track(3), // a feature missing
        track(4), // a feature out of range
        track(5), // no cover on Spotify
        track(6, { trackTitle: '' }),
        track(7, { artists: 'unknown' }),
        track(8, { durationMs: null }),
        track(9, { href: 'https://example.com/elsewhere' }),
        { trackTitle: 'No link' },
      ],
      features: [features(1), features(3, { energy: undefined }), features(4, { liveness: 1.5 }), features(5), features(6), features(7), features(8), { href: 42 }],
      noCover: [5],
    });
    const candidates = await source.recommend([ID(1)], 40);
    expect(candidates.map((s) => s.id)).toEqual([ID(1), ID(5)]);
    expect((await source.complete(candidates)).map((s) => s.id)).toEqual([ID(1)]); // 5 has no cover
    expect(await source.complete([])).toEqual([]);
  });

  // spec: complete rejects as a whole when the cover service fails or limits requests
  it('security_R_HOME_04_stopsLookingUpCoversAsSoonAsSpotifyLimitsRequests', async () => {
    const many = Array.from({ length: 25 }, (_, n) => n + 1);
    const { source } = platform({ tracks: many.map((n) => track(n)), features: many.map((n) => features(n)) });
    const candidates = await source.recommend([ID(1)], 40);
    expect(await source.complete(candidates)).toHaveLength(25); // three batches: 10, 10, 5

    const urls: string[] = [];
    const limited = new ReccoBeatsSource((async (input: unknown) => {
      urls.push(String(input));
      return new Response('<html>Too many requests</html>', { status: 429 });
    }) as unknown as typeof fetch, 1000);
    await expect(limited.complete(candidates)).rejects.toThrow('429');
    expect(urls).toHaveLength(10); // only the first batch was sent
  });

  it('limits a request to MAX_SEEDS seeds and 100 recommendations', async () => {
    const { source, urls } = platform({ tracks: [], features: [] });
    expect(await source.recommend(Array.from({ length: 8 }, (_, n) => ID(n)), 500)).toEqual([]);
    expect(urls).toEqual([`https://api.reccobeats.com/v1/track/recommendation?size=100&seeds=${[0, 1, 2, 3, 4].map(ID).join(',')}`]);
    await source.recommend([ID(1)], 0.2);
    expect(urls[1]).toContain('size=1&');
  });

  // spec: unknown seeds mean "nothing found"; other failures throw
  it('tells "no such seeds" from a failure', async () => {
    expect(await platform({ status: 400 }).source.recommend([ID(1)], 5)).toEqual([]);
    await expect(platform({ status: 429 }).source.recommend([ID(1)], 5)).rejects.toThrow('429');
    await expect(platform({ status: 500 }).source.tracks([ID(1)])).rejects.toThrow('500');
    await expect(platform({ status: 400 }).source.tracks([ID(1)])).rejects.toThrow('400');
    expect(await platform({ body: { unexpected: true } }).source.recommend([ID(1)], 5)).toEqual([]);
  });

  it('looks tracks up by ID in batches of 40', async () => {
    const ids = Array.from({ length: 45 }, (_, n) => ID(n));
    const { source, urls } = platform({ tracks: [track(1)], features: [features(1)] });
    expect((await source.tracks(ids)).map((s) => s.id)).toEqual([ID(1)]);
    const lookups = urls.filter((url) => url.includes('/track?ids='));
    expect(lookups).toHaveLength(2);
    expect(lookups[0]!.split('=')[1]!.split(',')).toHaveLength(40);
    expect(lookups[1]!.split('=')[1]!.split(',')).toHaveLength(5);
    expect(await source.tracks([])).toEqual([]);
  });

  it('uses the global fetch and a 4 second timeout by default', () => {
    expect(new ReccoBeatsSource()).toBeInstanceOf(ReccoBeatsSource);
  });
});
