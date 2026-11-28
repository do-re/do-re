/**
 * Sample users with different music tastes, for trying the matching mechanism by hand.
 * DEV ONLY: fixed, published passwords. Used by dev/server.ts; never run against production.
 *
 * Each sample user gets a verified account and then a listening history made through the
 * real MusicTasteModel: round after round they skip the library songs farthest from their
 * style and like the nearest. So their Taste Vectors are what real swiping would produce
 * with the loaded library, and they are in the leaderboards like any user who has swiped.
 */
import type { Clock } from '../src/deps';
import { MatchModel } from '../src/match/MatchModel';
import type { Song } from '../src/model/types';
import { TasteVector } from '../src/model/vectors';
import type { Services } from '../src/services';

export const SAMPLE_PASSWORD = 'demo-pass-1';

export interface SampleUser {
  readonly name: string;
  /** What they are meant to like, in plain words. */
  readonly style: string;
  /** The style as a point in feature space: valence, danceability, energy, acousticness, instrumentalness, liveness, speechiness. */
  readonly target: readonly number[];
  /** Hours since they last swiped. Over 72 means they can never be matched (R-HOME-19). */
  readonly inactiveHours?: number;
}

export const SAMPLE_USERS: readonly SampleUser[] = [
  { name: 'melody', style: 'acoustic folk: calm, acoustic', target: [0.4, 0.35, 0.25, 0.9, 0.2, 0.15, 0.04] },
  { name: 'harmony', style: 'pop: happy, danceable', target: [0.85, 0.8, 0.75, 0.15, 0.0, 0.12, 0.06] },
  { name: 'rhythm', style: 'hip-hop: danceable, wordy', target: [0.55, 0.85, 0.65, 0.15, 0.0, 0.15, 0.3] },
  { name: 'tempo', style: 'rock: loud, energetic, darker', target: [0.3, 0.4, 0.95, 0.03, 0.05, 0.3, 0.07] },
  { name: 'lyric', style: 'ambient: quiet, instrumental', target: [0.15, 0.25, 0.15, 0.85, 0.85, 0.1, 0.04] },
  { name: 'echo', style: 'pop, but last active 80 hours ago', target: [0.85, 0.8, 0.75, 0.15, 0.0, 0.12, 0.06], inactiveHours: 80 },
];

export interface SeededUser extends SampleUser {
  readonly email: string;
  readonly userId: string;
  readonly taste: TasteVector;
}

/** How many times each sample user goes through their liked and skipped songs. */
const ROUNDS = 12;

/**
 * Requires: services were built by buildServices; this is a development database.
 * Effects: for each SAMPLE_USERS entry whose email (<name>@do-re.test) has no account yet:
 *          creates a verified account with that username and SAMPLE_PASSWORD, records the
 *          listening history described above, and enters the user in the leaderboards as
 *          last active inactiveHours ago (default: now). Users that already exist are left
 *          untouched, so running this twice changes nothing.
 * @returns the users this call created, with their resulting Taste Vectors
 */
export async function seedSampleUsers(services: Services, clock: Clock): Promise<SeededUser[]> {
  const library = services.suggestionModel.getLibrary();
  const seeded: SeededUser[] = [];
  for (const sample of SAMPLE_USERS) {
    const email = `${sample.name}@do-re.test`;
    const userId = await services.accountModel.createAccount(email, SAMPLE_PASSWORD);
    if (userId === undefined) {
      continue;
    }
    await services.accountModel.activateAccount(userId);
    await services.accountModel.setUsername(userId, sample.name);

    const target = new TasteVector(sample.target);
    const ranked = [...library].sort((a, b) => target.distanceTo(a.features) - target.distanceTo(b.features));
    const share = Math.max(2, Math.ceil(library.length / 4));
    const liked: Song[] = ranked.slice(0, share);
    const skipped: Song[] = ranked.slice(-share);
    const lastActive = clock() - (sample.inactiveHours ?? 0) * 60 * 60 * 1000;
    // Each round: skip the far songs at once, then listen to the liked ones in full, ending
    // on the favourite. A skip pushes the taste away from a song and a like pulls it toward
    // one, so ending on likes leaves the taste among the liked songs.
    for (let round = 0; round < ROUNDS; round++) {
      for (const song of skipped) {
        await services.tasteModel.recordListen(userId, { song, feedback: 'SKIP', secondsListened: 0, time: lastActive });
      }
      for (const song of liked.toReversed()) {
        await services.tasteModel.recordListen(userId, { song, feedback: 'LIKE', secondsListened: song.durationSeconds, time: lastActive });
      }
    }
    const taste = await services.tasteModel.getTasteVector(userId);
    await services.matchModel.updateUser(userId, taste, lastActive);
    seeded.push({ ...sample, email, userId, taste });
  }
  return seeded;
}

/**
 * @param users seeded users
 * @returns a text table of each user's Taste Vector and the compatibility of every pair, as
 *          MatchModel computes it
 */
export function describeSampleUsers(users: readonly SeededUser[]): string {
  const pad = (text: string, width: number) => text.padEnd(width);
  const lines = ['Sample users (password ' + SAMPLE_PASSWORD + '). Taste = valence dance energy acoustic instrumental live speech'];
  for (const user of users) {
    const taste = user.taste.values().map((v) => v.toFixed(2)).join(' ');
    lines.push(`  ${pad(user.email, 22)} ${taste}   ${user.style}`);
  }
  lines.push('Compatibility between them (%):');
  lines.push(`  ${pad('', 9)}${users.map((u) => pad(u.name, 9)).join('')}`);
  for (const a of users) {
    const row = users.map((b) => pad(a === b ? '-' : MatchModel.compatibilityOf(a.taste, b.taste).toFixed(1), 9));
    lines.push(`  ${pad(a.name, 9)}${row.join('')}`);
  }
  return lines.join('\n');
}
