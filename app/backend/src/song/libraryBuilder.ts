import type { Song } from '../model/types';
import { COLUMNS, parseCsv, parseSongLibrary } from './SongLibrary';

/** What Spotify says about a track: its title and album cover. */
export interface TrackInfo {
  readonly title: string;
  readonly coverUrl: string;
}

/** Looks a track up on Spotify. Resolves to undefined if Spotify has no such track. */
export type TrackLookup = (trackId: string) => Promise<TrackInfo | undefined>;

/** The header of the library file this module writes (the first alias of each COLUMNS entry). */
export const LIBRARY_HEADER = [
  'Song',
  'Artist',
  'Time',
  'Dance',
  'Energy',
  'Acoustic',
  'Instrumental',
  'Happy',
  'Speech',
  'Live',
  'Spotify Track Id',
  'Spotify Track Img',
] as const;

/** Columns a track's Spotify ID can be read from: an ID column, or one holding a URI or link. */
const ID_COLUMNS = [...COLUMNS.id, 'spotify uri', 'uri', 'spotify url', 'track url', 'spotify link', 'link', 'url'];

export interface BuildResult {
  /** The library file's text: LIBRARY_HEADER and one row per kept song. */
  readonly csv: string;
  readonly kept: number;
  /** Rows left out, by their line number in the export (the header is line 1), with the reason. */
  readonly dropped: readonly { readonly line: number; readonly reason: string }[];
}

/**
 * @param text a Spotify track ID, a "spotify:track:<id>" URI, or an open.spotify.com track link
 * @returns the 22-character track ID in text, or undefined if there is none
 */
export function extractTrackId(text: string): string | undefined {
  const value = text.trim();
  return /^(?:spotify:track:|https?:\/\/open\.spotify\.com\/(?:[\w-]+\/)?track\/)?([0-9A-Za-z]{22})(?:[?#].*)?$/.exec(value)?.[1];
}

/**
 * Turns a Chosic "Spotify Playlist Analyzer" CSV export (OPEN-6) into the song library file
 * the backend loads (data/songs.csv), checking every song against Spotify on the way.
 * Satisfies: R-HOME-01, R-HOME-04, R-HOME-11 (build-time half: every library song exists on
 *            Spotify, has a cover and has its 7 Audio Features).
 *
 * Requires: exportCsv has a header row naming the columns in COLUMNS (the cover column is
 *           optional; the track ID may instead be in a URI or link column).
 * Effects: calls lookup once for each distinct track ID in the export; nothing else.
 * @param exportCsv the export's text
 * @param lookup    how to look a track up on Spotify (spotifyLookup in production)
 * @returns the library text and what was left out. A row is dropped, with a reason, if it has
 *          no track ID, repeats an earlier one, is not found on Spotify, or does not make a
 *          valid Song (see parseSongLibrary). A kept row keeps the export's values; its cover
 *          is the export's, or Spotify's if the export has none.
 * @throws RangeError naming the column if a required column is missing
 */
export async function buildLibrary(exportCsv: string, lookup: TrackLookup): Promise<BuildResult> {
  const [header, ...rows] = parseCsv(exportCsv);
  const names = (header ?? []).map((name) => name.trim().toLowerCase());
  const find = (aliases: readonly string[], required = true): number => {
    const index = names.findIndex((name) => aliases.includes(name));
    if (index < 0 && required) {
      throw new RangeError(`the export has no "${aliases[0]}" column (accepted names: ${aliases.join(', ')})`);
    }
    return index;
  };
  // In LIBRARY_HEADER order; features are listed there as dance, energy, acoustic,
  // instrumental, happy, speech, live, while COLUMNS.features is in Feature index order.
  const [happy, dance, energy, acoustic, instrumental, live, speech] = COLUMNS.features.map((aliases) => find(aliases));
  const at = [find(COLUMNS.title), find(COLUMNS.artist), find(COLUMNS.duration), dance!, energy!, acoustic!, instrumental!, happy!, speech!, live!];
  const idAt = find(ID_COLUMNS);
  const coverAt = find(COLUMNS.cover, false);

  const kept: string[][] = [];
  const dropped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const cell = (index: number) => (row[index] ?? '').trim();
    const id = extractTrackId(cell(idAt));
    if (id === undefined) {
      dropped.push({ line, reason: 'no Spotify track ID' });
      continue;
    }
    if (seen.has(id)) {
      dropped.push({ line, reason: `repeats track ${id}` });
      continue;
    }
    seen.add(id);
    const info = await lookup(id);
    if (info === undefined) {
      dropped.push({ line, reason: `track ${id} was not found on Spotify` });
      continue;
    }
    const cover = (coverAt < 0 ? '' : cell(coverAt)) || info.coverUrl;
    const out = [...at.map(cell), id, cover];
    try {
      parseSongLibrary(toCsv([[...LIBRARY_HEADER], out]));
      kept.push(out);
    } catch (error) {
      dropped.push({ line, reason: (error as Error).message.replace(/^song file row \d+: /, '') });
    }
  }
  return { csv: toCsv([[...LIBRARY_HEADER], ...kept]), kept: kept.length, dropped };
}

/**
 * @param rows rows of field values
 * @returns RFC 4180 CSV text for rows (fields with commas, quotes or line breaks are quoted),
 *          which parseCsv reads back to the same rows
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const field = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return rows.map((row) => `${row.map(field).join(',')}\n`).join('');
}

/**
 * A TrackLookup on Spotify's public oEmbed endpoint (no account or key needed):
 * https://open.spotify.com/oembed?url=spotify:track:<id>
 *
 * Requires: fetchFn behaves like the global fetch.
 * Effects: each lookup sends one GET request to open.spotify.com.
 * @returns a lookup that resolves to the track's title and cover image URL, to undefined if
 *          Spotify answers 404 (or 400) for the ID, and rejects for any other failure, so a
 *          network problem is never mistaken for a missing track
 */
export function spotifyLookup(fetchFn: typeof fetch = fetch): TrackLookup {
  return async (trackId) => {
    const response = await fetchFn(`https://open.spotify.com/oembed?url=spotify:track:${trackId}`);
    if (response.status === 404 || response.status === 400) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`Spotify answered ${response.status} for track ${trackId}`);
    }
    const body = (await response.json()) as { title?: unknown; thumbnail_url?: unknown };
    if (typeof body.title !== 'string' || typeof body.thumbnail_url !== 'string') {
      throw new Error(`Spotify sent no title or cover for track ${trackId}`);
    }
    return { title: body.title, coverUrl: body.thumbnail_url };
  };
}

/**
 * Picks songs that cover feature space evenly, for a starting library that gives new users
 * varied first songs (see SongSuggestionModel, cold start).
 *
 * Requires: count > 0.
 * Effects: none.
 * @returns min(count, songs.length) of the songs: the first one, then repeatedly the song
 *          farthest (in feature space) from every song picked so far
 */
export function spreadOut<T extends Pick<Song, 'features'>>(songs: readonly T[], count: number): T[] {
  const pool = [...songs];
  const picked = pool.splice(0, 1);
  const gap = pool.map((song) => picked[0]!.features.distanceTo(song.features));
  while (picked.length < count && pool.length > 0) {
    const index = gap.indexOf(Math.max(...gap));
    const [next] = pool.splice(index, 1);
    gap.splice(index, 1);
    picked.push(next!);
    pool.forEach((song, i) => {
      gap[i] = Math.min(gap[i]!, next!.features.distanceTo(song.features));
    });
  }
  return picked;
}

/**
 * @param songs songs to write
 * @returns library file text (LIBRARY_HEADER and one row per song) that parseSongLibrary
 *          reads back to the same songs, with durations rounded to whole seconds and
 *          features to 4 decimal places
 */
export function songsToCsv(songs: readonly Song[]): string {
  const time = (seconds: number) => {
    const whole = Math.max(1, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  };
  const score = (value: number) => String(Math.round(value * 1_000_000) / 10_000);
  const rows = songs.map((song) => {
    const [valence, dance, energy, acoustic, instrumental, live, speech] = song.features.values().map(score);
    return [song.title, song.artist, time(song.durationSeconds), dance!, energy!, acoustic!, instrumental!, valence!, speech!, live!, song.id, song.albumCoverUrl];
  });
  return toCsv([[...LIBRARY_HEADER], ...rows]);
}
