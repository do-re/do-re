import type { Song } from '../model/types';
import { TasteVector } from '../model/vectors';
import { type Item, type Key, type Table, updateItem } from '../store/Table';
import type { SongLibrary } from './SongLibrary';

const suggestKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'SUGGEST' });

interface SuggestState {
  /** Upcoming songs. */
  readonly cache: string[];
  /** Songs most recently suggested, newest first. */
  readonly recent: string[];
  /** How many suggestions the user has been given (undone ones not counted). */
  readonly count: number;
}

/**
 * SongSuggestionModel: finds songs near a user's music taste and caches the next 5
 * suggestions. Holds the song library.
 * Resides on: server. Communicates with: SongController.
 *
 * Two rules the stubs leave open follow the frontend demo the team tuned
 * (frontend/src/api/mockSuggestions.ts, notes-for-felix F-12):
 *  - Cold start. A new user's taste is the centre of feature space, where "near taste" means
 *    nothing, so a cache filled for a neutral taste is spread across the library.
 *  - After a user's first CACHE_SIZE suggestions, the cached song closest to their current
 *    taste plays next, so a like or skip takes effect straight away.
 *
 * Stored state: USER#<id> / SUGGEST with cache, recent and count (see SuggestState).
 *
 * Abstraction function: AF(library, table) = the library, plus for each user the songs they
 *   will be suggested next and the songs they were suggested recently.
 * Rep invariant: library has more than CACHE_SIZE songs; for each user, cache has no
 *   duplicates and at most CACHE_SIZE entries, recent has at most recentWindow entries, and
 *   count >= 0. Since recentWindow <= library size - CACHE_SIZE, there are always at least
 *   CACHE_SIZE songs outside recent, and at least one outside recent and a part-full cache.
 *
 * Concurrency: every mutator is a read-modify-write of one item through updateItem, so
 * concurrent calls for one user each see the other's result; no suggestion is handed out
 * twice from one cache state.
 */
export class SongSuggestionModel {
  static readonly CACHE_SIZE = 5;
  /** How many past suggestions are avoided when choosing new ones, if the library allows. */
  static readonly RECENT_SIZE = 100;
  /** RECENT_SIZE, or less for a small library: only so many songs can be kept from repeating. */
  private readonly recentWindow: number;

  /**
   * Satisfies: R-HOME-01, R-HOME-11.
   *
   * Requires: library has more than CACHE_SIZE songs.
   * @throws RangeError if the library is too small
   */
  constructor(
    private readonly library: SongLibrary,
    private readonly table: Table,
  ) {
    if (library.all().length <= SongSuggestionModel.CACHE_SIZE) {
      throw new RangeError(`the song library needs more than ${SongSuggestionModel.CACHE_SIZE} songs`);
    }
    this.recentWindow = Math.min(
      SongSuggestionModel.RECENT_SIZE,
      library.all().length - SongSuggestionModel.CACHE_SIZE,
    );
  }

  /** @returns every song in the library (unmodifiable) */
  getLibrary(): readonly Song[] {
    return this.library.all();
  }

  /** @returns the library song with this ID, or undefined if there is none */
  getSong(songId: string): Song | undefined {
    return this.library.get(songId);
  }

  /**
   * Fills the user's suggestion cache.
   *
   * Requires: userId belongs to an existing account.
   * Effects: the user's cache holds CACHE_SIZE songs that are not among the user's recent
   *          suggestions: spread across the library if taste is neutral, otherwise the
   *          nearest to taste. Replaces previous contents.
   */
  async preloadCache(userId: string, taste: TasteVector): Promise<void> {
    await updateItem(this.table, suggestKey(userId), (current) => {
      const state = stateOf(current);
      const cache = this.choose(taste, state.recent);
      return { attrs: { ...state, cache }, result: undefined };
    });
  }

  /**
   * Returns the next suggested song.
   * Satisfies: R-HOME-15.
   *
   * Requires: userId belongs to an existing account.
   * Effects: removes the returned song from the user's cache (filling the cache first, as
   *          preloadCache does, if it is empty), records it as recently suggested, and adds
   *          new suggestions near taste so the cache is back at CACHE_SIZE.
   * @returns for the user's first CACHE_SIZE suggestions, the song at the front of the
   *          cache; after that, the cached song nearest taste. It is not among the user's
   *          previous min(RECENT_SIZE, library size - CACHE_SIZE) suggestions.
   */
  async nextSuggestion(userId: string, taste: TasteVector): Promise<Song> {
    return updateItem(this.table, suggestKey(userId), (current) => {
      const state = stateOf(current);
      let cache = state.cache.filter((id) => this.library.get(id) !== undefined);
      if (cache.length === 0) {
        cache = this.choose(taste, state.recent);
      }
      const index = state.count < SongSuggestionModel.CACHE_SIZE ? 0 : this.closestIndex(cache, taste);
      const next = cache[index]!;
      const rest = cache.filter((id) => id !== next);
      const recent = [next, ...state.recent].slice(0, this.recentWindow);
      const refill = this.nearestIds(taste, SongSuggestionModel.CACHE_SIZE - rest.length, recent, rest);
      const attrs: SuggestState = { cache: [...rest, ...refill], recent, count: state.count + 1 };
      return { attrs: { ...attrs }, result: this.library.get(next)! };
    });
  }

  /**
   * Takes back the user's latest suggestion, for the undo button. Added to stubs v2
   * (api.md Q-14).
   *
   * Requires: song is the user's latest suggestion (the song being left by the undo).
   * Effects: song is no longer counted as suggested and returns to the front of the cache;
   *          the suggestion before it (which becomes active again) leaves the cache if
   *          present; the cache is cut to CACHE_SIZE.
   */
  async returnSuggestion(userId: string, song: Song): Promise<void> {
    await updateItem(this.table, suggestKey(userId), (current) => {
      const state = stateOf(current);
      const recent = state.recent[0] === song.id ? state.recent.slice(1) : state.recent;
      const restored = recent[0];
      const cache = [song.id, ...state.cache.filter((id) => id !== song.id && id !== restored)];
      const attrs: SuggestState = {
        cache: cache.slice(0, SongSuggestionModel.CACHE_SIZE),
        recent,
        count: Math.max(0, state.count - 1),
      };
      return { attrs: { ...attrs }, result: undefined };
    });
  }

  /**
   * Requires: count > 0.
   * Effects: none.
   * @returns up to count songs, none in exclude, ordered from closest to farthest from taste
   *          (Euclidean distance in feature space; ties in ascending song ID order)
   */
  findNearest(taste: TasteVector, count: number, exclude: ReadonlySet<string>): Song[] {
    return this.library
      .all()
      .filter((song) => !exclude.has(song.id))
      .map((song) => ({ song, distance: taste.distanceTo(song.features) }))
      .sort((a, b) => a.distance - b.distance || (a.song.id < b.song.id ? -1 : 1))
      .slice(0, count)
      .map((entry) => entry.song);
  }

  /**
   * Chooses CACHE_SIZE song IDs for an empty cache: the nearest to taste, or, for a neutral
   * taste, a spread: the song nearest the centre, then repeatedly the candidate farthest
   * from everything picked so far, so the picks cover different parts of the library.
   * No pick is in recent.
   */
  private choose(taste: TasteVector, recent: readonly string[]): string[] {
    const size = SongSuggestionModel.CACHE_SIZE;
    if (!taste.equals(TasteVector.neutral())) {
      return this.nearestIds(taste, size, recent, []);
    }
    const pool = this.findNearest(taste, this.library.all().length, new Set(recent));
    const picked = pool.splice(0, 1);
    while (picked.length < size) {
      const gaps = pool.map((song) => Math.min(...picked.map((p) => p.features.distanceTo(song.features))));
      picked.push(...pool.splice(gaps.indexOf(Math.max(...gaps)), 1));
    }
    return picked.map((song) => song.id);
  }

  /**
   * Chooses `count` song IDs nearest taste for a cache that already holds `held`; none is in
   * held or recent. By the rep invariant there are enough whenever
   * held.length + count <= CACHE_SIZE.
   */
  private nearestIds(taste: TasteVector, count: number, recent: readonly string[], held: readonly string[]): string[] {
    return this.findNearest(taste, count, new Set([...recent, ...held])).map((song) => song.id);
  }

  /** @returns the index of the song in cache closest to taste (the first, on a tie) */
  private closestIndex(cache: readonly string[], taste: TasteVector): number {
    const distances = cache.map((id) => taste.distanceTo(this.library.get(id)!.features));
    return distances.indexOf(Math.min(...distances));
  }
}

function stateOf(item: Item | undefined): SuggestState {
  return {
    cache: (item?.cache ?? []) as string[],
    recent: (item?.recent ?? []) as string[],
    count: (item?.count ?? 0) as number,
  };
}
