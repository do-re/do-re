import { describe, expect, it } from 'vitest';
import { describeSampleUsers, SAMPLE_PASSWORD, SAMPLE_USERS, seedSampleUsers } from '../dev/sampleUsers';
import { MatchModel } from '../src/match/MatchModel';
import { parseSongLibrary, SongLibrary } from '../src/song/SongLibrary';
import { TasteVector } from '../src/model/vectors';
import { buildServices } from '../src/services';
import { MemoryTable } from '../src/store/MemoryTable';
import { FakeClock, FakeRandom, MemoryPictures, RecordingEmail, song } from './helpers';
import { readFileSync } from 'node:fs';

/** A backend whose library has five songs in each sample style, plus the neutral centre. */
function world(library?: SongLibrary) {
  const styled = SAMPLE_USERS.slice(0, 5).flatMap((user, s) =>
    Array.from({ length: 5 }, (_, i) => song(`style${s}-${i}`, user.target.map((v) => Math.min(1, Math.max(0, v + (i - 2) * 0.02))))),
  );
  const clock = new FakeClock();
  const services = buildServices({
    table: new MemoryTable(),
    email: new RecordingEmail(),
    pictures: new MemoryPictures(),
    library: library ?? new SongLibrary([...styled, song('centre', 0.5)]),
    clock: clock.read,
    random: new FakeRandom(),
    appBaseUrl: 'https://app.example',
    passwordCost: 16,
  });
  return { services, clock };
}

describe('sample users for trying matching (dev only)', () => {
  it('creates verified accounts with different tastes, once', async () => {
    const { services, clock } = world();
    const users = await seedSampleUsers(services, clock.read);
    expect(users.map((u) => u.name)).toEqual(SAMPLE_USERS.map((u) => u.name));
    for (const user of users) {
      expect(await services.accounts.login(user.email, SAMPLE_PASSWORD)).toBe('SUCCESS');
      expect((await services.accounts.getProfile(user.userId)).username).toBe(user.name);
      expect(user.taste.equals(TasteVector.neutral())).toBe(false);
      // listening moved each user most of the way from the centre to their own style
      const target = new TasteVector(user.target);
      expect(user.taste.distanceTo(target)).toBeLessThan(TasteVector.neutral().distanceTo(target) / 2);
    }
    // the five styles are well apart; the two pop users are alike
    const byName = Object.fromEntries(users.map((u) => [u.name, u.taste]));
    expect(MatchModel.compatibilityOf(byName.harmony!, byName.echo!)).toBeGreaterThan(99);
    expect(MatchModel.compatibilityOf(byName.melody!, byName.tempo!)).toBeLessThan(70);
    expect(await seedSampleUsers(services, clock.read)).toEqual([]); // already there: nothing to do
    expect(describeSampleUsers(users)).toContain('harmony@do-re.test');
  });

  it('R_HOME_19_aNewUserIsMatchedWithTheSampleUserOfTheirStyleAndNeverTheInactiveOne', async () => {
    const { services, clock } = world();
    const users = await seedSampleUsers(services, clock.read);
    const idOf = (name: string) => users.find((u) => u.name === name)!.userId;
    for (const [liker, expected] of [['pop-fan', 'harmony'], ['folk-fan', 'melody'], ['rock-fan', 'tempo']] as const) {
      const style = new TasteVector(SAMPLE_USERS.find((u) => u.name === expected)!.target);
      const nearStyle = services.suggestionModel.findNearest(style, 3, new Set());
      for (let i = 0; i < 6; i++) {
        const liked = nearStyle[i % 3]!;
        await services.tasteModel.recordListen(liker, { song: liked, feedback: 'LIKE', secondsListened: liked.durationSeconds, time: clock.now });
      }
      await services.matchModel.updateUser(liker, await services.tasteModel.getTasteVector(liker), clock.now);
      const match = (await services.matchModel.findMatch(liker, clock.now))!;
      expect([match.userA, match.userB]).toContain(idOf(expected));
    }
    // echo has the same taste as harmony but was last active 80 hours ago
    const seen = new Set<string>();
    for (let match = await services.matchModel.findMatch('pop-fan', clock.now); match; match = await services.matchModel.findMatch('pop-fan', clock.now)) {
      seen.add(match.userA === 'pop-fan' ? match.userB : match.userA);
    }
    expect(seen.has(idOf('echo'))).toBe(false);
    expect(seen.has(idOf('lyric'))).toBe(true);
  });

  it('also works with the six placeholder songs', async () => {
    const sample = new SongLibrary(parseSongLibrary(readFileSync('data/songs.sample.csv', 'utf8')));
    const { services, clock } = world(sample);
    const users = await seedSampleUsers(services, clock.read);
    expect(users).toHaveLength(SAMPLE_USERS.length);
    expect(new Set(users.map((u) => u.taste.values().join())).size).toBeGreaterThanOrEqual(4);
  });
});
