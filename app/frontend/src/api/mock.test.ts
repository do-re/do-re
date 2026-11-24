import { describe, expect, it, vi } from 'vitest';
import { createMockApi, MockBackend } from './mock';
import { SEED_PENDING_MATCH, SEED_SONGS } from './mockSeed';
import { sequence } from '../test/sequence';

const DEMO = { email: 'demo@do-re.test', password: 'demo-pass-1', userId: 'u-demo' };

describe('MockBackend construction', () => {
  it('rejects matchEvery < 1 and an empty song list', () => {
    expect(() => new MockBackend({ matchEvery: 0 })).toThrow();
    expect(() => new MockBackend({ songs: [] })).toThrow();
  });

  it('shares one backend across the three APIs', () => {
    const api = createMockApi();
    expect(api.account).toBe(api.backend);
    expect(api.songs).toBe(api.backend);
    expect(api.matches).toBe(api.backend);
  });

  it('waits latencyMs before answering', async () => {
    vi.useFakeTimers();
    try {
      const backend = new MockBackend({ latencyMs: 100 });
      let done = false;
      const pending = backend.login(DEMO.email, DEMO.password).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MockBackend accounts', () => {
  it('R_ACC_04 login partitions: success, wrong password, no account, not verified', async () => {
    const b = new MockBackend();
    expect(await b.login(DEMO.email, DEMO.password)).toEqual({ result: 'SUCCESS', userId: DEMO.userId });
    expect(await b.login(`  ${DEMO.email} `, DEMO.password)).toEqual({ result: 'SUCCESS', userId: DEMO.userId });
    expect(await b.login(DEMO.email, 'nope')).toEqual({ result: 'WRONG_PASSWORD' });
    expect(await b.login('ghost@do-re.test', 'x')).toEqual({ result: 'NO_ACCOUNT' });
    expect(await b.login('unverified@do-re.test', 'demo-pass-1')).toEqual({ result: 'NOT_VERIFIED' });
  });

  it('R_ACC_08 createAccount checks email, then passwords, then email in use', async () => {
    const b = new MockBackend();
    expect(await b.createAccount('bad', '', 'x')).toBe('INVALID_EMAIL');
    expect(await b.createAccount('new@do-re.test', '', '')).toBe('PASSWORDS_DO_NOT_MATCH');
    expect(await b.createAccount('new@do-re.test', 'a', 'b')).toBe('PASSWORDS_DO_NOT_MATCH');
    expect(await b.createAccount(DEMO.email, 'a', 'a')).toBe('EMAIL_IN_USE');
    expect(await b.createAccount('new@do-re.test', 'pw', 'pw')).toBe('PENDING_VERIFICATION');
  });

  it('R_ACC_09 R_SEC_02 R_SEC_03 a new account cannot log in until verified', async () => {
    const b = new MockBackend();
    await b.createAccount('new@do-re.test', 'pw', 'pw');
    expect(await b.isVerified('new@do-re.test')).toBe(false);
    expect((await b.login('new@do-re.test', 'pw')).result).toBe('NOT_VERIFIED');
    expect(b.verifyEmail('new@do-re.test')).toBe(true);
    expect(await b.isVerified('new@do-re.test')).toBe(true);
    const login = await b.login('new@do-re.test', 'pw');
    expect(login.result).toBe('SUCCESS');
    if (login.result === 'SUCCESS') {
      expect((await b.getProfile(login.userId)).username).toBe('new');
    }
  });

  it('verifyEmail and isVerified handle unknown emails', async () => {
    const b = new MockBackend();
    expect(b.verifyEmail('ghost@do-re.test')).toBe(false);
    await expect(b.isVerified('ghost@do-re.test')).rejects.toThrow();
  });

  it('getProfile and updateUsername', async () => {
    const b = new MockBackend();
    expect(await b.getProfile(DEMO.userId)).toEqual({ userId: DEMO.userId, username: 'demo', profilePictureUrl: null });
    await b.updateUsername(DEMO.userId, '  dj ');
    expect((await b.getProfile(DEMO.userId)).username).toBe('dj');
    await expect(b.updateUsername(DEMO.userId, '   ')).rejects.toThrow();
    await expect(b.getProfile('nobody')).rejects.toThrow();
  });

  it('updateProfilePicture stores an image and rejects empty or non-image files', async () => {
    const b = new MockBackend();
    await b.updateProfilePicture(DEMO.userId, new Blob(['png-bytes'], { type: 'image/png' }));
    expect((await b.getProfile(DEMO.userId)).profilePictureUrl).toMatch(/^data:image\/png;base64,/);
    await expect(b.updateProfilePicture(DEMO.userId, new Blob([], { type: 'image/png' }))).rejects.toThrow();
    await expect(b.updateProfilePicture(DEMO.userId, new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow();
  });
});

describe('MockBackend songs', () => {
  it('R_HOME_03 getCurrentSong returns the same active song until feedback', async () => {
    const b = new MockBackend();
    const first = await b.getCurrentSong(DEMO.userId);
    expect(first).toBe(SEED_SONGS[0]);
    expect(await b.getCurrentSong(DEMO.userId)).toBe(first);
    await expect(b.getCurrentSong('nobody')).rejects.toThrow();
  });

  it('R_HOME_15 submitFeedback advances and wraps around the library', async () => {
    const b = new MockBackend({ matchEvery: 100 });
    let song = await b.getCurrentSong(DEMO.userId);
    for (let i = 1; i <= SEED_SONGS.length; i++) {
      const { nextSong, offeredMatch } = await b.submitFeedback(DEMO.userId, song.id, 'SKIP', 0);
      expect(nextSong).toBe(SEED_SONGS[i % SEED_SONGS.length]);
      expect(offeredMatch).toBeNull();
      song = nextSong;
    }
  });

  it('R_HOME_25 a song liked with the button counts as one LIKE, even when skipped', async () => {
    const b = new MockBackend();
    const song = await b.getCurrentSong(DEMO.userId);
    await b.markLiked(DEMO.userId, song.id);
    await b.markLiked(DEMO.userId, song.id); // idempotent
    const { nextSong } = await b.submitFeedback(DEMO.userId, song.id, 'SKIP', 12);
    await b.submitFeedback(DEMO.userId, nextSong.id, 'SKIP', 3);
    expect(b.listens).toEqual([
      { userId: DEMO.userId, songId: song.id, feedback: 'LIKE', secondsListened: 12 },
      { userId: DEMO.userId, songId: nextSong.id, feedback: 'SKIP', secondsListened: 3 },
    ]);
  });

  it('R_HOME_16 swipe right records LIKE', async () => {
    const b = new MockBackend();
    const song = await b.getCurrentSong(DEMO.userId);
    await b.submitFeedback(DEMO.userId, song.id, 'LIKE', 30);
    expect(b.listens[0].feedback).toBe('LIKE');
  });

  it('rejects feedback for a song that is not active, or out-of-range listen time', async () => {
    const b = new MockBackend();
    await expect(b.markLiked(DEMO.userId, SEED_SONGS[0].id)).rejects.toThrow(); // no active song yet
    const song = await b.getCurrentSong(DEMO.userId);
    await expect(b.submitFeedback(DEMO.userId, 'other', 'SKIP', 0)).rejects.toThrow();
    await expect(b.submitFeedback(DEMO.userId, song.id, 'SKIP', -1)).rejects.toThrow();
    await expect(b.submitFeedback(DEMO.userId, song.id, 'SKIP', song.durationSeconds + 1)).rejects.toThrow();
    // boundary: exactly the full duration is allowed
    await expect(b.submitFeedback(DEMO.userId, song.id, 'SKIP', song.durationSeconds)).resolves.toBeDefined();
  });
});

describe('MockBackend matches', () => {
  async function swipe(b: MockBackend, times: number) {
    let result = null;
    for (let i = 0; i < times; i++) {
      const song = await b.getCurrentSong(DEMO.userId);
      result = await b.submitFeedback(DEMO.userId, song.id, 'SKIP', 0);
    }
    return result!;
  }

  // Verified candidates for demo, in seed order: melody, harmony, rhythm (unverified is skipped).
  it('R_HOME_19 offers a random verified other user, with a random percent, every matchEvery swipes', async () => {
    const b = new MockBackend({ matchEvery: 2, withPendingMatch: false, random: sequence(0.5, 0.25) });
    expect((await swipe(b, 1)).offeredMatch).toBeNull();
    const match = (await swipe(b, 1)).offeredMatch!;
    // index floor(0.5 * 3) = 1 → harmony; percent 50 + 0.25 * 50 = 62.5
    expect(match).toMatchObject({ userA: DEMO.userId, userB: 'u-harmony', compatibilityPercent: 62.5 });
  });

  it('never proposes self, unverified users or anyone with an open match; runs out, then a declined pair comes back', async () => {
    const b = new MockBackend({ matchEvery: 1, withPendingMatch: false, random: () => 0 });
    const offered = [];
    for (let i = 0; i < 3; i++) offered.push((await swipe(b, 1)).offeredMatch!.userB);
    expect(offered).toEqual(['u-melody', 'u-harmony', 'u-rhythm']);
    expect((await swipe(b, 1)).offeredMatch).toBeNull(); // all three still open

    const [melodyMatch] = await b.getPendingMatches('u-melody');
    await b.declineMatch(melodyMatch, DEMO.userId);
    expect((await swipe(b, 1)).offeredMatch!.userB).toBe('u-melody'); // placeholder: declines can repeat
  });

  it('never proposes someone the user already has a chat with', async () => {
    const b = new MockBackend({ matchEvery: 1, random: () => 0 }); // seeded harmony match
    await b.confirmMatch(SEED_PENDING_MATCH.match, DEMO.userId); // chat with harmony
    const offered = [(await swipe(b, 1)).offeredMatch!.userB, (await swipe(b, 1)).offeredMatch!.userB];
    expect(offered).toEqual(['u-melody', 'u-rhythm']);
    expect((await swipe(b, 1)).offeredMatch).toBeNull();
  });

  it('keeps the percent in [50, 99.9] and the pick in range at the top of [0, 1)', async () => {
    const low = new MockBackend({ matchEvery: 1, withPendingMatch: false, random: () => 0 });
    expect((await swipe(low, 1)).offeredMatch!.compatibilityPercent).toBe(50);
    const high = new MockBackend({ matchEvery: 1, withPendingMatch: false, random: () => 0.99999 });
    const match = (await swipe(high, 1)).offeredMatch!;
    expect(match.compatibilityPercent).toBe(99.9);
    expect(match.userB).toBe('u-rhythm');
  });

  it('R_HOME_20 getPendingMatches lists unanswered matches for each user', async () => {
    const b = new MockBackend();
    expect(await b.getPendingMatches(DEMO.userId)).toEqual([SEED_PENDING_MATCH.match]);
    expect(await b.getPendingMatches('u-harmony')).toEqual([]); // already confirmed
    expect(await b.getPendingMatches('u-melody')).toEqual([]);
  });

  it('getMatch returns the match only to its users', async () => {
    const b = new MockBackend();
    expect(await b.getMatch('m-seed', DEMO.userId)).toEqual(SEED_PENDING_MATCH.match);
    expect(await b.getMatch('m-seed', 'u-melody')).toBeNull();
    expect(await b.getMatch('missing', DEMO.userId)).toBeNull();
  });

  it('getOtherProfile returns the other user from either side', async () => {
    const b = new MockBackend();
    const m = SEED_PENDING_MATCH.match;
    expect((await b.getOtherProfile(m, DEMO.userId)).username).toBe('harmony');
    expect((await b.getOtherProfile(m, 'u-harmony')).username).toBe('demo');
    await expect(b.getOtherProfile(m, 'u-melody')).rejects.toThrow();
  });

  it('R_HOME_23 confirm opens a chat only when both confirmed, and only one chat', async () => {
    const b = new MockBackend({ matchEvery: 1 });
    // other user already confirmed: chat right away
    const chatId = await b.confirmMatch(SEED_PENDING_MATCH.match, DEMO.userId);
    expect(chatId).not.toBeNull();
    expect(await b.confirmMatch(SEED_PENDING_MATCH.match, DEMO.userId)).toBe(chatId);
    // fresh match: first confirm waits (OPEN-4), second creates the chat
    const fresh = (await swipe(b, 1)).offeredMatch!;
    expect(await b.confirmMatch(fresh, DEMO.userId)).toBeNull();
    expect(await b.confirmMatch(fresh, fresh.userB)).not.toBeNull();
  });

  it('declining after confirming moves the user to declined, and outsiders are rejected', async () => {
    const b = new MockBackend({ matchEvery: 1 });
    const fresh = (await swipe(b, 1)).offeredMatch!;
    await b.confirmMatch(fresh, DEMO.userId);
    await b.declineMatch(fresh, DEMO.userId);
    expect(await b.getPendingMatches(DEMO.userId)).not.toContainEqual(fresh);
    await expect(b.confirmMatch(fresh, 'u-harmony')).rejects.toThrow();
    await expect(b.declineMatch({ ...fresh, matchId: 'missing' }, DEMO.userId)).rejects.toThrow();
  });
});
