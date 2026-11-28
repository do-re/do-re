import type { Song } from '../model/types';
import { TasteVector } from '../model/vectors';
import type { Clock } from '../deps';
import { type Item, type Key, type Table, updateItem } from '../store/Table';
import { MAX_SEEDS, type MusicSource } from './MusicSource';
import type { SongCatalog } from './SongCatalog';

const suggestKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'SUGGEST' });

interface SuggestState {
  /** Upcoming songs. */
  readonly cache: string[];
  /** Songs most recently suggested, newest first. */
  readonly recent: string[];
  /** How many suggestions the user has been given (undone ones not counted). */
  readonly count: number;
  /** Songs pulled from the music platform for this user that are not in the cache yet. */
  readonly reserve: string[];
  /** No pull is attempted for this user before this time (set after a pull that added nothing). */
  readonly pullAfter: number;
}

/**
 * SongSuggestionModel: finds songs near a user's music taste and caches the next 5
 * suggestions. Holds the song library, and pulls new songs from the music platform while
 * the user swipes.
 * Resides on: server. Communicates with: SongController, the music platform (MusicSource).
 *
 * Where songs come from:
 *  - The starting library (bundled file, R-HOME-01) always works, with no network.
 *  - If a MusicSource is given, pullSuggestions asks it for tracks recommended for listeners
 *    of the songs nearest the user's taste, keeps the ones nearest that taste, stores them in
 *    the catalog and holds them in the user's reserve. The cache is refilled from the reserve
 *    first and from the starting library only when the reserve is empty. If the platform is
 *    unreachable, slow or knows nothing useful, suggestions carry on from the starting library.
 *
 * Two rules the stubs leave open follow the frontend demo the team tuned
 * (frontend/src/api/mockSuggestions.ts, notes-for-felix F-12):
 *  - Cold start. A new user's taste is the centre of feature space, where "near taste" means
 *    nothing, so a cache filled for a neutral taste is spread across the starting library.
 *  - After a user's first CACHE_SIZE suggestions, the cached song closest to their current
 *    taste plays next, so a like or skip takes effect straight away.
 *
 * Stored state: USER#<id> / SUGGEST with cache, recent, count and reserve (see SuggestState).
 *
 * Abstraction function: AF(catalog, table) = the starting library, plus for each user the
 *   songs they will be suggested next, the songs they were suggested recently, and the songs
 *   pulled for them that are waiting their turn.
 * Rep invariant: the starting library has more than CACHE_SIZE songs; for each user, cache
 *   has no duplicates and at most CACHE_SIZE entries, recent has at most RECENT_SIZE entries,
 *   reserve has no duplicates and at most RESERVE_SIZE entries, and count >= 0. The first
 *   recentWindow entries of recent leave at least CACHE_SIZE starting songs outside them.
 *
 * Concurrency: every change to a user's state is a read-modify-write of one item through
 * updateItem, so concurrent calls for one user each see the other's result and no
 * suggestion is handed out twice from one cache state. The platform is called outside that
 * step (in pullSuggestions), so a slow or failed request never holds up or repeats a write;
 * its result is merged into whatever the state is by then.
 */
export class SongSuggestionModel {
  static readonly CACHE_SIZE = 5;
  /** How many past suggestions are remembered, to avoid suggesting them again. */
  static readonly RECENT_SIZE = 100;
  /** Most pulled songs held in a user's reserve. */
  static readonly RESERVE_SIZE = 20;
  /** How many recommendations one pull asks the platform for, before keeping the nearest. */
  static readonly PULL_SIZE = 40;
  /**
   * After a pull that failed or found nothing new, how long before the next attempt for that
   * user. Keeps a struggling or rate-limiting platform from being asked again on every swipe.
   */
  static readonly PULL_BACKOFF_MS = 60 * 1000;
  /**
   * How many recent suggestions the starting library is kept clear of: RECENT_SIZE, or less
   * for a small library, where only so many songs can be kept from repeating.
   */
  private readonly recentWindow: number;

  /**
   * Satisfies: R-HOME-01, R-HOME-11.
   *
   * Requires: the catalog's starting library has more than CACHE_SIZE songs.
   * @param source the music platform to pull songs from; omit to use the starting library only
   * @param clock  the current time, for backing off after a failed pull
   * @param log    where platform failures are reported (the error's name only)
   * @throws RangeError if the starting library is too small
   */
  constructor(
    private readonly catalog: SongCatalog,
    private readonly table: Table,
    private readonly source?: MusicSource,
    private readonly clock: Clock = Date.now,
    private readonly log: (line: string) => void = console.error,
  ) {
    const starters = catalog.starters().length;
    if (starters <= SongSuggestionModel.CACHE_SIZE) {
      throw new RangeError(`the song library needs more than ${SongSuggestionModel.CACHE_SIZE} songs`);
    }
    this.recentWindow = Math.min(SongSuggestionModel.RECENT_SIZE, starters - SongSuggestionModel.CACHE_SIZE);
  }

  /** @returns every song in the starting library (unmodifiable) */
  getLibrary(): readonly Song[] {
    return this.catalog.starters();
  }

  /**
   * Effects: none.
   * @returns the song with this ID, from the starting library or pulled earlier, or
   *          undefined if the app does not know it
   */
  getSong(songId: string): Promise<Song | undefined> {
    return this.catalog.get(songId);
  }

  /**
   * Fills the user's suggestion cache from the starting library.
   *
   * Requires: userId belongs to an existing account.
   * Effects: the user's cache holds CACHE_SIZE starting songs that are not among the user's
   *          recent suggestions: spread across the library if taste is neutral, otherwise
   *          the nearest to taste. Replaces previous contents.
   */
  async preloadCache(userId: string, taste: TasteVector): Promise<void> {
    await updateItem(this.table, suggestKey(userId), (current) => {
      const state = stateOf(current);
      return { attrs: { ...state, cache: this.choose(taste, state.recent) }, result: undefined };
    });
  }

  /**
   * Pulls new songs for the user from the music platform, if their reserve is running low.
   * Called by SongController before it asks for the next suggestion. Added to stubs v2.
   * Satisfies: R-HOME-01, R-HOME-11, R-HOME-15.
   *
   * Requires: userId belongs to an existing account.
   * Effects: if a MusicSource was given, the user's reserve has fewer than CACHE_SIZE songs
   *          and the user is not backing off: asks the platform for PULL_SIZE
   *          recommendations seeded with the songs nearest taste (from the starting library
   *          and the user's cache); of those the user has not been suggested or queued,
   *          takes the ones nearest taste, as many as the reserve has room for, fetches
   *          their covers, stores them in the catalog and adds them to the reserve.
   *          Otherwise nothing. Never throws: if the platform fails the failure is logged,
   *          and if nothing was added (failure or nothing new) the user backs off for
   *          PULL_BACKOFF_MS.
   */
  async pullSuggestions(userId: string, taste: TasteVector): Promise<void> {
    if (this.source === undefined) {
      return;
    }
    const state = stateOf(await this.table.get(suggestKey(userId)));
    if (state.reserve.length >= SongSuggestionModel.CACHE_SIZE || this.clock() < state.pullAfter) {
      return;
    }
    let picks: Song[] = [];
    try {
      const candidates = new Map([...this.catalog.starters(), ...(await this.resolve(state.cache))].map((s) => [s.id, s]));
      const seeds = byDistance([...candidates.values()], taste).slice(0, MAX_SEEDS);
      const found = await this.source.recommend(seeds.map((song) => song.id), SongSuggestionModel.PULL_SIZE);
      const seen = new Set([...state.recent, ...state.cache, ...state.reserve]);
      const fresh = new Map(found.filter((song) => !seen.has(song.id)).map((song) => [song.id, song]));
      const room = SongSuggestionModel.RESERVE_SIZE - state.reserve.length;
      const nearest = byDistance([...fresh.values()], taste).slice(0, room);
      picks = nearest.length === 0 ? [] : await this.source.complete(nearest);
      await this.catalog.add(picks);
    } catch (error) {
      picks = [];
      this.log(`Music source failed: ${(error as Error).name}`);
    }
    await updateItem(this.table, suggestKey(userId), (current) => {
      const latest = stateOf(current);
      const taken = new Set([...latest.recent, ...latest.cache, ...latest.reserve]);
      const added = picks.map((song) => song.id).filter((id) => !taken.has(id));
      const reserve = [...latest.reserve, ...added].slice(0, SongSuggestionModel.RESERVE_SIZE);
      const pullAfter = picks.length === 0 ? this.clock() + SongSuggestionModel.PULL_BACKOFF_MS : latest.pullAfter;
      return { attrs: { ...latest, reserve, pullAfter }, result: undefined };
    });
  }

  /**
   * Returns the next suggested song.
   * Satisfies: R-HOME-15.
   *
   * Requires: userId belongs to an existing account.
   * Effects: removes the returned song from the user's cache (filling the cache first, as
   *          preloadCache does, if it is empty), records it as recently suggested, and tops
   *          the cache back up to CACHE_SIZE: with the reserve songs nearest taste, then,
   *          if the reserve runs out, with the starting songs nearest taste.
   * @returns for the user's first CACHE_SIZE suggestions, the song at the front of the
   *          cache; after that, the cached song nearest taste. It is not among the user's
   *          previous suggestions, as far back as RECENT_SIZE for pulled songs and
   *          min(RECENT_SIZE, library size - CACHE_SIZE) for starting songs.
   */
  async nextSuggestion(userId: string, taste: TasteVector): Promise<Song> {
    return updateItem(this.table, suggestKey(userId), async (current) => {
      const state = stateOf(current);
      let cached = await this.resolve(state.cache);
      if (cached.length === 0) {
        cached = await this.resolve(this.choose(taste, state.recent));
      }
      const next = state.count < SongSuggestionModel.CACHE_SIZE ? cached[0]! : byDistance(cached, taste)[0]!;
      const rest = cached.filter((song) => song.id !== next.id).map((song) => song.id);
      const recent = [next.id, ...state.recent].slice(0, SongSuggestionModel.RECENT_SIZE);

      const need = SongSuggestionModel.CACHE_SIZE - rest.length;
      const blocked = new Set([...recent, ...rest]);
      const waiting = (await this.resolve(state.reserve)).filter((song) => !blocked.has(song.id));
      const fromReserve = byDistance(waiting, taste)
        .slice(0, need)
        .map((song) => song.id);
      const fromLibrary = this.nearestIds(taste, need - fromReserve.length, recent, [...rest, ...fromReserve]);
      const attrs: SuggestState = {
        cache: [...rest, ...fromReserve, ...fromLibrary],
        recent,
        count: state.count + 1,
        reserve: waiting.map((song) => song.id).filter((id) => !fromReserve.includes(id)),
        pullAfter: state.pullAfter,
      };
      return { attrs: { ...attrs }, result: next };
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
        ...state,
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
   * @returns up to count starting-library songs, none in exclude, ordered from closest to
   *          farthest from taste (Euclidean distance in feature space; ties in ascending
   *          song ID order)
   */
  findNearest(taste: TasteVector, count: number, exclude: ReadonlySet<string>): Song[] {
    const allowed = this.catalog.starters().filter((song) => !exclude.has(song.id));
    return byDistance(allowed, taste).slice(0, count);
  }

  /**
   * Chooses CACHE_SIZE starting-song IDs for an empty cache: the nearest to taste, or, for a
   * neutral taste, a spread: the song nearest the centre, then repeatedly the candidate
   * farthest from everything picked so far, so the picks cover different parts of the
   * library. No pick is among the user's last recentWindow suggestions.
   */
  private choose(taste: TasteVector, recent: readonly string[]): string[] {
    const size = SongSuggestionModel.CACHE_SIZE;
    if (!taste.equals(TasteVector.neutral())) {
      return this.nearestIds(taste, size, recent, []);
    }
    const avoid = new Set(recent.slice(0, this.recentWindow));
    const pool = this.findNearest(taste, this.catalog.starters().length, avoid);
    const picked = pool.splice(0, 1);
    while (picked.length < size) {
      const gaps = pool.map((song) => Math.min(...picked.map((p) => p.features.distanceTo(song.features))));
      picked.push(...pool.splice(gaps.indexOf(Math.max(...gaps)), 1));
    }
    return picked.map((song) => song.id);
  }

  /**
   * Chooses `count` starting-song IDs nearest taste for a cache that already holds `held`;
   * none is in held or among the user's last recentWindow suggestions. By the rep invariant
   * there are enough whenever held.length + count <= CACHE_SIZE.
   */
  private nearestIds(taste: TasteVector, count: number, recent: readonly string[], held: readonly string[]): string[] {
    const exclude = new Set([...recent.slice(0, this.recentWindow), ...held]);
    return this.findNearest(taste, count, exclude).map((song) => song.id);
  }

  /** @returns the known songs among ids, in the same order (unknown IDs are dropped) */
  private async resolve(ids: readonly string[]): Promise<Song[]> {
    const songs = await Promise.all(ids.map((id) => this.catalog.get(id)));
    return songs.filter((song) => song !== undefined);
  }
}

/** @returns songs ordered from closest to farthest from taste, ties in ascending ID order */
function byDistance<T extends Pick<Song, 'id' | 'features'>>(songs: readonly T[], taste: TasteVector): T[] {
  return songs
    .map((song) => ({ song, distance: taste.distanceTo(song.features) }))
    .sort((a, b) => a.distance - b.distance || (a.song.id < b.song.id ? -1 : 1))
    .map((entry) => entry.song);
}

function stateOf(item: Item | undefined): SuggestState {
  return {
    cache: (item?.cache ?? []) as string[],
    recent: (item?.recent ?? []) as string[],
    count: (item?.count ?? 0) as number,
    reserve: (item?.reserve ?? []) as string[],
    pullAfter: (item?.pullAfter ?? 0) as number,
  };
}
