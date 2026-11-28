import { makeSong, type Song } from '../model/types';
import { AudioFeatures } from '../model/vectors';
import type { Item, Key, Table } from '../store/Table';
import type { SongLibrary } from './SongLibrary';

const songKey = (songId: string): Key => ({ pk: `SONG#${songId}`, sk: 'SONG' });

/**
 * Every song the app knows: the bundled starting library, plus the songs pulled from the
 * music platform while users swipe. Pulled songs are stored in DynamoDB so that any Lambda
 * instance can resolve a song ID found in a user's cache, history or active song.
 *
 * Stored state: SONG#<id> / SONG with title, artist, durationSeconds, albumCoverUrl and
 * features (7 numbers). Written once and never changed.
 *
 * Abstraction function: AF(library, table) = the set of songs in library together with the
 *   songs stored under SONG# keys.
 * Rep invariant: every stored item makes a valid Song whose id is the one in its key; a
 *   stored song is never modified or deleted, so `remembered` (this instance's copies of
 *   songs it has read or written) never goes stale.
 *
 * Concurrency: add() writes each song on condition that it is absent, so when two requests
 * pull the same track at once the first write stands and the second is a no-op. Songs are
 * immutable afterwards, which is what makes the per-instance `remembered` map safe even
 * though Lambda instances share no memory: it can lack a song, never hold a wrong one.
 */
export class SongCatalog {
  private readonly remembered = new Map<string, Song>();

  constructor(
    private readonly library: SongLibrary,
    private readonly table: Table,
  ) {}

  /** @returns the bundled starting library (unmodifiable) */
  starters(): readonly Song[] {
    return this.library.all();
  }

  /**
   * Satisfies: R-HOME-12 (a song's Audio Features always come with it).
   * Effects: none.
   * @returns the song with this ID from the starting library or the stored songs, or
   *          undefined if the app does not know it
   */
  async get(songId: string): Promise<Song | undefined> {
    const known = this.library.get(songId) ?? this.remembered.get(songId);
    if (known !== undefined) {
      return known;
    }
    const item = await this.table.get(songKey(songId));
    if (item === undefined) {
      return undefined;
    }
    const song = songOf(item);
    this.remembered.set(songId, song);
    return song;
  }

  /**
   * Satisfies: R-HOME-11 (a song is given its 7 Audio Features when added).
   * Requires: every song satisfies the Song rep invariant.
   * Effects: each song that is not yet known is stored; known songs are left as they are.
   */
  async add(songs: readonly Song[]): Promise<void> {
    const fresh = songs.filter((song) => this.library.get(song.id) === undefined && !this.remembered.has(song.id));
    await Promise.all(
      fresh.map(async (song) => {
        const { id, features, spotifyUri: _uri, ...rest } = makeSong(song);
        const item = { ...songKey(id), version: 1, ...rest, features: features.values() };
        const written = await this.table.write([{ op: 'put', item, expect: 'absent' }]);
        // If another request stored it first, keep that copy: it is the one everyone reads.
        this.remembered.set(id, written ? song : songOf((await this.table.get(songKey(id)))!));
      }),
    );
  }
}

function songOf(item: Item): Song {
  const id = item.pk.slice('SONG#'.length);
  return makeSong({
    id,
    title: item.title as string,
    artist: item.artist as string,
    durationSeconds: item.durationSeconds as number,
    albumCoverUrl: item.albumCoverUrl as string,
    spotifyUri: `spotify:track:${id}`,
    features: new AudioFeatures(item.features as number[]),
  });
}
