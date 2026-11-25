import { makeSong, type Song } from '../model/types';
import { AudioFeatures } from '../model/vectors';

/**
 * The song library: every song the app can suggest, loaded once when a Lambda instance
 * starts and never changed afterwards (so sharing it within an instance is safe).
 *
 * Abstraction function: AF(songs, byId) = the set of songs in `songs`.
 * Rep invariant: song IDs are unique; byId maps each song's ID to that song and has no
 *   other entries; every song satisfies the Song rep invariant (so each has its 7 Audio
 *   Features, R-HOME-11).
 * Satisfies: R-HOME-01, R-HOME-11.
 */
export class SongLibrary {
  private readonly songs: readonly Song[];
  private readonly byId: ReadonlyMap<string, Song>;

  /**
   * Requires: every song satisfies the Song rep invariant; song IDs are unique.
   * Effects: stores an unmodifiable copy of songs.
   * @throws RangeError if a song breaks its rep invariant or an ID repeats
   */
  constructor(songs: readonly Song[]) {
    this.songs = Object.freeze(songs.map(makeSong));
    this.byId = new Map(this.songs.map((song) => [song.id, song]));
    this.checkRep();
  }

  /** @returns every song in the library (unmodifiable) */
  all(): readonly Song[] {
    return this.songs;
  }

  /** @returns the song with this ID, or undefined if the library has none */
  get(id: string): Song | undefined {
    return this.byId.get(id);
  }

  /** @throws RangeError if the rep invariant does not hold */
  checkRep(): void {
    if (this.byId.size !== this.songs.length) {
      throw new RangeError('song IDs must be unique');
    }
  }
}

/** Accepted header names (lower-cased) for each column of the Chosic CSV export. */
const COLUMNS = {
  id: ['spotify track id', 'track id', 'spotify id', 'id'],
  title: ['song', 'title', 'track', 'track name', 'name'],
  artist: ['artist', 'artists', 'artist name(s)'],
  duration: ['time', 'duration', 'length'],
  cover: ['spotify track img', 'album image', 'album cover', 'album cover url', 'image', 'cover'],
  // In Feature index order.
  features: [
    ['happy', 'happiness', 'valence'],
    ['dance', 'danceability'],
    ['energy'],
    ['acoustic', 'acousticness'],
    ['instrumental', 'instrumentalness'],
    ['live', 'liveness'],
    ['speech', 'speechiness'],
  ],
} as const;

/**
 * Parses the song data file (course C-TECH-2): a CSV export of Chosic's Spotify Playlist
 * Analyzer (OPEN-6), with a header row. Columns are found by name, in any order; extra
 * columns are ignored. Each of the 7 features is a score from 0 to 100 and is stored as
 * score / 100. Durations are "m:ss", "h:mm:ss" or a number of seconds.
 * Satisfies: R-HOME-01, R-HOME-11.
 *
 * Requires: csv has the columns named in COLUMNS and valid values in every row.
 * Effects: none.
 * @param csv the file's text
 * @returns one Song per data row, in file order
 * @throws RangeError naming the missing column, or the row and problem, if the file is not valid
 */
export function parseSongLibrary(csv: string): Song[] {
  const [header, ...rows] = parseCsv(csv);
  const names = (header ?? []).map((name) => name.trim().toLowerCase());
  const find = (aliases: readonly string[]): number => {
    const index = names.findIndex((name) => aliases.includes(name));
    if (index < 0) {
      throw new RangeError(`song file has no "${aliases[0]}" column (accepted names: ${aliases.join(', ')})`);
    }
    return index;
  };
  const at = {
    id: find(COLUMNS.id),
    title: find(COLUMNS.title),
    artist: find(COLUMNS.artist),
    duration: find(COLUMNS.duration),
    cover: find(COLUMNS.cover),
    features: COLUMNS.features.map(find),
  };
  return rows.map((row, i) => {
    const cell = (index: number) => (row[index] ?? '').trim();
    try {
      const id = cell(at.id);
      return makeSong({
        id,
        title: cell(at.title),
        artist: cell(at.artist),
        durationSeconds: parseDuration(cell(at.duration)),
        albumCoverUrl: cell(at.cover),
        spotifyUri: `spotify:track:${id}`,
        features: new AudioFeatures(at.features.map((index) => (cell(index) === '' ? NaN : Number(cell(index)) / 100))),
      });
    } catch (error) {
      throw new RangeError(`song file row ${i + 2}: ${(error as Error).message}`);
    }
  });
}

/** @returns seconds for "m:ss", "h:mm:ss" or a plain number; NaN if text is none of these */
function parseDuration(text: string): number {
  if (!/^\d+(:\d{1,2}){0,2}$|^\d+\.\d+$/.test(text)) {
    return NaN;
  }
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * Minimal RFC 4180 CSV reader: commas, double-quoted fields (with "" for a quote, and commas
 * or line breaks inside quotes), LF or CRLF line ends, optional byte-order mark. Blank lines
 * are skipped.
 *
 * @param text CSV text
 * @returns the rows, each a list of field values
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((value) => value !== '')) {
      rows.push(row);
    }
    row = [];
  };
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      endRow();
    } else if (c !== '\r') {
      field += c;
    }
  }
  endRow();
  return rows;
}
