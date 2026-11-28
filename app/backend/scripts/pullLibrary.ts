/**
 * Builds data/songs.csv, the starting song library, by pulling real tracks from the music
 * platforms (no account or key needed):
 *
 *   npm run library:pull                 about 150 songs, starting from a few well-known tracks
 *   npm run library:pull -- 300          another size
 *   npm run library:pull -- 150 ids.txt  start from your own tracks: one Spotify track ID, URI
 *                                        or link per line (for example copied from a playlist)
 *
 * It starts from the seed tracks, asks ReccoBeats for recommendations, and keeps exploring
 * from the songs least like the ones it already has, so the library covers many styles.
 * Every track has its 7 audio features from ReccoBeats and a cover from Spotify, which also
 * confirms it exists there. If Spotify answers 429 (too many requests), wait a few minutes
 * and run it again. See src/song/MusicSource.ts and src/song/libraryBuilder.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Song } from '../src/model/types';
import type { TrackCandidate } from '../src/song/MusicSource';
import { extractTrackId, songsToCsv, spreadOut } from '../src/song/libraryBuilder';
import { MAX_SEEDS, ReccoBeatsSource } from '../src/song/MusicSource';
import { parseSongLibrary } from '../src/song/SongLibrary';

/** Blinding Lights, Shape of You, Mr. Brightside, Despacito, Billie Jean. */
const DEFAULT_SEEDS = ['0VjIjW4GlUZAMYd2vXMi3b', '7qiZfU4dY1lWllzX7mPBI3', '3n3Ppam7vgaVa1iaRUc9Lp', '6habFhsOp2NvshLv26DqMb', '5ChkMS8OtdzJeqyybCc9R5'];
const ROUNDS = 8;

const size = Number(process.argv[2] ?? 150);
const seedFile = process.argv[3];
if (!Number.isInteger(size) || size < 6) {
  console.error('Usage: npm run library:pull -- [number of songs, at least 6] [file of Spotify track IDs or links]');
  process.exit(2);
}
const given = seedFile === undefined ? [] : readFileSync(seedFile, 'utf8').split(/\r?\n/).map((line) => extractTrackId(line)).filter((id) => id !== undefined);
const source = new ReccoBeatsSource(fetch, 15_000);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const found = new Map<string, TrackCandidate>();
const keep = (tracks: readonly TrackCandidate[]) => tracks.forEach((track) => found.set(track.id, track));
const seedIds = given.length > 0 ? given : DEFAULT_SEEDS;
keep(await source.tracks(seedIds));
console.log(`Seed tracks known to the platform: ${found.size} of ${seedIds.length}`);
if (found.size === 0) {
  console.error('None of the seed tracks is known to ReccoBeats. Try other tracks.');
  process.exit(1);
}
const usedAsSeed = new Set<string>();
for (let round = 1; round <= ROUNDS && found.size < size * 2; round++) {
  // Explore from the songs least like the rest, that have not been seeds yet.
  const fresh = [...found.values()].filter((song) => !usedAsSeed.has(song.id));
  const seeds = spreadOut(fresh.reverse(), MAX_SEEDS);
  if (seeds.length === 0) {
    break;
  }
  seeds.forEach((song) => usedAsSeed.add(song.id));
  keep(await source.recommend(seeds.map((song) => song.id), 100));
  console.log(`Round ${round}: ${found.size} songs`);
  await pause(500);
}
// Covers come from Spotify, which limits how fast it may be asked: a few at a time, with a
// pause, and only for the songs chosen (plus spares, since a track may have no cover).
const chosen = spreadOut([...found.values()], Math.ceil(size * 1.1));
const library: Song[] = [];
for (let i = 0; i < chosen.length && library.length < size; i += 10) {
  library.push(...(await source.complete(chosen.slice(i, i + 10))));
  process.stdout.write(`\rCovers from Spotify: ${library.length}`);
  await pause(1500);
}
process.stdout.write('\n');
library.length = Math.min(library.length, size);
const csv = songsToCsv(library);
parseSongLibrary(csv); // fails loudly if anything written is not a valid song
const target = join(process.cwd(), 'data', 'songs.csv');
writeFileSync(target, csv);
console.log(`Wrote ${library.length} songs to ${target}.`);
