/**
 * Mock of SongSuggestionModel (architecture-stubs-v2.java): a per-user cache of the next 5 songs,
 * refilled with songs near the user's taste.
 *
 * One addition the stub leaves open (notes-for-felix F-12): a brand-new user's taste is the centre
 * of feature space, where "near taste" means nothing. Their first five songs are therefore spread
 * across the library, so they can show what they like. After that, the cached song closest to the
 * current taste plays next, so a like or skip takes effect straight away.
 *
 * Abstraction function: `caches` holds each user's upcoming songs and `suggested` the song IDs
 * they have been given, oldest first.
 * Rep invariant: the library has more than CACHE_SIZE songs with unique IDs; every cache has at
 * most CACHE_SIZE songs, all from the library, with no repeats.
 */
import { HISTORY_SIZE, isNeutralTaste, tasteDistance, type TasteVector } from './mockTaste';
import type { Song } from './types';

/** Upcoming songs held per user (stub CACHE_SIZE). */
export const CACHE_SIZE = 5;

/** How songs are chosen: by taste (the app), or simply in library order (view tests). */
export type SongOrder = 'taste' | 'library';

export class MockSuggestionModel {
  private readonly library: readonly Song[];
  private readonly order: SongOrder;
  private readonly recentWindow: number;
  private readonly caches = new Map<string, Song[]>();
  private readonly suggested = new Map<string, string[]>();

  /**
   * Satisfies: R-HOME-01, R-HOME-11.
   * Requires: library has more than CACHE_SIZE songs with unique IDs.
   * Effects: stores a copy of library.
   * @throws Error if library is too small
   */
  constructor(library: readonly Song[], order: SongOrder = 'taste') {
    if (library.length <= CACHE_SIZE) {
      throw new Error(`MockSuggestionModel: the library needs more than ${CACHE_SIZE} songs`);
    }
    this.library = [...library];
    this.order = order;
    // With a small library, only the most recent songs can be kept from repeating.
    this.recentWindow = Math.min(HISTORY_SIZE, this.library.length - CACHE_SIZE);
  }

  /**
   * Stub getLibrary.
   * Requires: none.
   * Effects: none.
   * @returns every song in the library
   */
  getLibrary(): readonly Song[] {
    return [...this.library];
  }

  /**
   * Stub preloadCache.
   * Requires: none.
   * Effects: the user's cache holds CACHE_SIZE songs not recently suggested: spread across the
   *          library for a new user, otherwise the nearest to taste.
   */
  preloadCache(userId: string, taste: TasteVector): void {
    const recent = this.recentIds(userId);
    const cache = isNeutralTaste(taste)
      ? this.spreadFrom(taste, CACHE_SIZE, recent)
      : this.findNearest(taste, CACHE_SIZE, recent);
    this.caches.set(userId, cache);
    this.checkRep();
  }

  /**
   * Stub nextSuggestion.
   * Satisfies: R-HOME-15.
   * Requires: none.
   * Effects: removes the returned song from the user's cache and adds a new one near taste, so
   *          the cache stays at CACHE_SIZE.
   * @returns a song the user has not been suggested recently
   */
  nextSuggestion(userId: string, taste: TasteVector): Song {
    const seen = this.suggested.get(userId) ?? [];
    this.suggested.set(userId, seen);
    if (this.order === 'library') {
      const song = this.library[seen.length % this.library.length];
      seen.push(song.id);
      return song;
    }

    if (!this.caches.has(userId)) this.preloadCache(userId, taste);
    const cache = this.caches.get(userId)!;
    const index = seen.length < CACHE_SIZE ? 0 : this.closestIndex(cache, taste);
    const [song] = cache.splice(index, 1);
    seen.push(song.id);

    const exclude = this.recentIds(userId);
    for (const cached of cache) exclude.add(cached.id);
    cache.push(...this.findNearest(taste, CACHE_SIZE - cache.length, exclude));
    this.checkRep();
    return song;
  }

  /**
   * WEB: for the undo button. Takes back the latest suggestion.
   * Requires: song is the user's latest suggestion.
   * Effects: song is no longer counted as suggested and returns to the front of the cache, and
   *          the suggestion before it (which becomes active again) leaves the cache if present.
   */
  returnSuggestion(userId: string, song: Song): void {
    const seen = this.suggested.get(userId)!;
    seen.pop();
    if (this.order === 'library') return;
    const restored = seen.at(-1);
    const cache = this.caches.get(userId)!.filter((cached) => cached.id !== restored && cached.id !== song.id);
    cache.unshift(song);
    cache.length = Math.min(cache.length, CACHE_SIZE);
    this.caches.set(userId, cache);
    this.checkRep();
  }

  /**
   * Stub findNearest.
   * Requires: count > 0.
   * Effects: none.
   * @returns up to count songs, none in exclude, closest to taste first; ties broken by song ID
   */
  findNearest(taste: TasteVector, count: number, exclude: ReadonlySet<string>): Song[] {
    return this.library
      .filter((song) => !exclude.has(song.id))
      .map((song) => ({ song, distance: tasteDistance(song.features, taste) }))
      .sort((a, b) => a.distance - b.distance || a.song.id.localeCompare(b.song.id))
      .slice(0, count)
      .map(({ song }) => song);
  }

  /** Asserts the rep invariant. */
  checkRep(): void {
    const libraryIds = new Set(this.library.map((song) => song.id));
    for (const cache of this.caches.values()) {
      const ids = new Set(cache.map((song) => song.id));
      if (cache.length > CACHE_SIZE || ids.size !== cache.length || ![...ids].every((id) => libraryIds.has(id))) {
        throw new Error('MockSuggestionModel rep invariant violated: bad cache');
      }
    }
  }

  /** @returns the IDs of the songs most recently suggested to the user */
  private recentIds(userId: string): Set<string> {
    return new Set((this.suggested.get(userId) ?? []).slice(-this.recentWindow));
  }

  /** @returns the index of the song in cache closest to taste (the first, on a tie) */
  private closestIndex(cache: readonly Song[], taste: TasteVector): number {
    let best = 0;
    for (let i = 1; i < cache.length; i++) {
      if (tasteDistance(cache[i].features, taste) < tasteDistance(cache[best].features, taste)) best = i;
    }
    return best;
  }

  /**
   * Picks the song nearest taste, then repeatedly the song farthest from everything picked, so
   * the picks cover different parts of the library.
   * Requires: count > 0.
   * Effects: none.
   * @returns up to count songs, none in exclude
   */
  private spreadFrom(taste: TasteVector, count: number, exclude: ReadonlySet<string>): Song[] {
    const pool = this.findNearest(taste, this.library.length, exclude);
    const picked = pool.splice(0, 1);
    while (picked.length < count && pool.length > 0) {
      let bestIndex = 0;
      let bestGap = -1;
      pool.forEach((song, index) => {
        const gap = Math.min(...picked.map((p) => tasteDistance(p.features, song.features)));
        if (gap > bestGap) {
          bestGap = gap;
          bestIndex = index;
        }
      });
      picked.push(...pool.splice(bestIndex, 1));
    }
    return picked;
  }
}
