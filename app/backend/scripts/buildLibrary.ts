/**
 * Builds data/songs.csv, the song library the backend loads, from a Chosic "Spotify Playlist
 * Analyzer" CSV export (OPEN-6):
 *
 *   npm run library -- path/to/chosic-export.csv
 *
 * Every track is checked against Spotify (public oEmbed endpoint, no key), which also
 * supplies the album cover when the export has none. Rows that cannot be used are listed
 * with the reason and left out. See src/song/libraryBuilder.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLibrary, spotifyLookup } from '../src/song/libraryBuilder';
import { SongSuggestionModel } from '../src/song/SongSuggestionModel';

const source = process.argv[2];
if (source === undefined) {
  console.error('Usage: npm run library -- <chosic-export.csv>');
  process.exit(2);
}
const lookup = spotifyLookup();
let checked = 0;
const result = await buildLibrary(readFileSync(source, 'utf8'), async (trackId) => {
  // One request at a time with a short pause, to stay well within Spotify's limits.
  await new Promise((resolve) => setTimeout(resolve, 120));
  process.stdout.write(`\rChecking tracks on Spotify: ${++checked}`);
  return lookup(trackId);
});
process.stdout.write('\n');
for (const { line, reason } of result.dropped) {
  console.log(`  left out line ${line}: ${reason}`);
}
if (result.kept <= SongSuggestionModel.CACHE_SIZE) {
  console.error(`Only ${result.kept} usable songs; the library needs more than ${SongSuggestionModel.CACHE_SIZE}. Nothing was written.`);
  process.exit(1);
}
const target = join(process.cwd(), 'data', 'songs.csv');
writeFileSync(target, result.csv);
console.log(`Wrote ${result.kept} songs to ${target} (${result.dropped.length} left out).`);
