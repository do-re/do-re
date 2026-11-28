import { describe, expect, it, vi } from 'vitest';
import { createMockApi, MockBackend } from './mock';
import { BOT_DECISION_MS, BOT_GREETING_MS, BOT_REPLY_MS } from './mockBots';
import { SEED_BOTS, SEED_PENDING_MATCH, SEED_SONGS, songsInGenre, type Genre } from './mockSeed';
import type { Match } from './types';

const DEMO = { email: 'demo@do-re.test', password: 'demo-pass-1', userId: 'u-demo' };

describe('MockBackend construction', () => {
  it('rejects matchEvery < 1 and a library that is too small', () => {
    expect(() => new MockBackend({ matchEvery: 0 })).toThrow();
    expect(() => new MockBackend({ songs: [] })).toThrow();
    expect(() => new MockBackend({ songs: SEED_SONGS.slice(0, 5) })).toThrow();
  });

  it('shares one backend across the APIs', () => {
    const api = createMockApi();
    expect(api.account).toBe(api.backend);
    expect(api.songs).toBe(api.backend);
    expect(api.matches).toBe(api.backend);
    expect(api.chats).toBe(api.backend.chatBackend);
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

  it('nobody has a match or a chat when the app starts', async () => {
    const api = createMockApi();
    expect(await api.matches.getPendingMatches(DEMO.userId)).toEqual([]);
    expect(await api.chats.getChatLog(DEMO.userId)).toEqual([]);
  });
});

describe('MockBackend accounts', () => {
  it('R_ACC_04 login partitions: success, wrong password, no account, not verified', async () => {
    const b = new MockBackend();
    // demo is the demo backend's root admin (OPEN-18), so its login says so
    const success = { result: 'SUCCESS', userId: DEMO.userId, token: 'mock-session-u-demo', isAdmin: true };
    expect(await b.login(DEMO.email, DEMO.password)).toEqual(success);
    expect(await b.login(`  ${DEMO.email} `, DEMO.password)).toEqual(success);
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

  it('R_ACC_09 R_SEC_02 R_SEC_03 a new blank account cannot log in until verified', async () => {
    const b = new MockBackend();
    await b.createAccount('new@do-re.test', 'pw', 'pw');
    expect(await b.isVerified('new@do-re.test')).toBe(false);
    expect((await b.login('new@do-re.test', 'pw')).result).toBe('NOT_VERIFIED');
    expect(b.verifyEmail('new@do-re.test')).toBe(true);
    expect(await b.isVerified('new@do-re.test')).toBe(true);
    const login = await b.login('new@do-re.test', 'pw');
    expect(login.result).toBe('SUCCESS');
    if (login.result === 'SUCCESS') {
      expect(await b.getProfile(login.userId)).toEqual({ userId: login.userId, username: '', profilePictureUrl: null });
    }
  });

  it('R_SEC_02 confirmEmail activates with the right token, once', async () => {
    const b = new MockBackend();
    await b.createAccount('new@do-re.test', 'pw', 'pw');
    const link = new URLSearchParams(b.verificationLinkFor('new@do-re.test')!.split('?')[1]);
    const userId = link.get('userId')!;
    const token = link.get('token')!;
    expect(await b.confirmEmail(userId, 'wrong-token')).toBe(false);
    expect(await b.confirmEmail('nobody', token)).toBe(false);
    expect(await b.isVerified('new@do-re.test')).toBe(false);
    expect(await b.confirmEmail(userId, token)).toBe(true);
    expect(await b.isVerified('new@do-re.test')).toBe(true);
    expect(await b.confirmEmail(userId, token)).toBe(false); // single use
    expect(b.verificationLinkFor('new@do-re.test')).toBeNull();
  });

  it('verificationLinkFor is null for accounts without a pending link', () => {
    const b = new MockBackend();
    expect(b.verificationLinkFor('ghost@do-re.test')).toBeNull();
    expect(b.verificationLinkFor(DEMO.email)).toBeNull();
    expect(createMockApi().demo!.verificationLinkFor(DEMO.email)).toBeNull();
  });

  it('verifyEmail and isVerified handle unknown emails', async () => {
    const b = new MockBackend();
    expect(b.verifyEmail('ghost@do-re.test')).toBe(false);
    await expect(b.isVerified('ghost@do-re.test')).rejects.toThrow();
  });

  it('getProfile and updateUsername', async () => {
    const b = new MockBackend();
    // demo is the demo backend's root admin (OPEN-18), so its profile says so
    expect(await b.getProfile(DEMO.userId)).toEqual({ userId: DEMO.userId, username: 'demo', profilePictureUrl: null, isAdmin: true });
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
    const b = new MockBackend({ songOrder: 'library' });
    const first = await b.getCurrentSong(DEMO.userId);
    expect(first).toBe(SEED_SONGS[0]);
    expect(await b.getCurrentSong(DEMO.userId)).toBe(first);
    await expect(b.getCurrentSong('nobody')).rejects.toThrow();
  });

  it('R_HOME_15 in library order, submitFeedback advances and wraps around', async () => {
    const b = new MockBackend({ matchEvery: 100, songOrder: 'library' });
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
    expect(b.taste.getLikedSongs(DEMO.userId)).toEqual([song]);
  });

  it('R_HOME_16 R_HOME_17 swipe right records LIKE and moves the Taste Vector toward the song', async () => {
    const b = new MockBackend();
    const song = await b.getCurrentSong(DEMO.userId);
    const before = b.taste.getTasteVector(DEMO.userId);
    await b.submitFeedback(DEMO.userId, song.id, 'LIKE', 30);
    expect(b.listens[0].feedback).toBe('LIKE');
    const after = b.taste.getTasteVector(DEMO.userId);
    after.forEach((value, i) => {
      expect(Math.abs(song.features[i] - value)).toBeLessThanOrEqual(Math.abs(song.features[i] - before[i]));
    });
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

/** Swipes like someone who loves one style, until a match is offered. */
async function swipeLoving(b: MockBackend, genre: Genre): Promise<Match> {
  const loved = new Set(songsInGenre(genre).map((s) => s.id));
  for (let i = 0; i < 60; i++) {
    const song = await b.getCurrentSong(DEMO.userId);
    const { offeredMatch } = await b.submitFeedback(DEMO.userId, song.id, loved.has(song.id) ? 'LIKE' : 'SKIP', 15);
    if (offeredMatch !== null) return offeredMatch;
  }
  throw new Error('no match offered');
}

async function skip(b: MockBackend, times = 1) {
  let result = null;
  for (let i = 0; i < times; i++) {
    const song = await b.getCurrentSong(DEMO.userId);
    result = await b.submitFeedback(DEMO.userId, song.id, 'SKIP', 0);
  }
  return result!;
}

describe('MockBackend matching by taste', () => {
  it.each<[Genre, string]>([
    ['folk', 'u-melody'],
    ['pop', 'u-harmony'],
    ['hiphop', 'u-rhythm'],
    ['rock', 'u-tempo'],
    ['ambient', 'u-lyric'],
  ])('R_HOME_17 R_HOME_19 liking %s songs matches you with %s', async (genre, bot) => {
    const b = new MockBackend({ matchEvery: 12 });
    const match = await swipeLoving(b, genre);
    expect(match.userA).toBe(DEMO.userId);
    expect(match.userB).toBe(bot);
    expect(match.compatibilityPercent).toBe(b.matchModel.compatibility(DEMO.userId, bot));
  });

  it.each<[Genre, string]>([
    ['folk', 'u-melody'],
    ['pop', 'u-harmony'],
    ['hiphop', 'u-rhythm'],
    ['rock', 'u-tempo'],
    ['ambient', 'u-lyric'],
  ])('R_HOME_19 someone who listens to and likes %s is matched with %s whenever the offer comes', async (genre, bot) => {
    for (let matchEvery = 5; matchEvery <= 12; matchEvery++) {
      const b = new MockBackend({ matchEvery });
      expect((await swipeLoving(b, genre)).userB).toBe(bot);
    }
  });

  it('with the default settings, a match arrives after 5 to 9 swipes', async () => {
    for (const r of [0, 0.5, 0.999]) {
      const b = new MockBackend({ random: () => r });
      let swipes = 0;
      let match = null;
      while (match === null) {
        swipes++;
        match = (await skip(b)).offeredMatch;
      }
      expect(swipes).toBeGreaterThanOrEqual(5);
      expect(swipes).toBeLessThanOrEqual(9);
    }
  });

  it('R_HOME_19 R_HOME_22 offers each active user at most once, best first, then nobody', async () => {
    const b = new MockBackend({ matchEvery: 1 });
    const offered: Match[] = [];
    for (let i = 0; i < 6; i++) {
      const { offeredMatch } = await skip(b);
      if (offeredMatch !== null) {
        offered.push(offeredMatch);
        await b.declineMatch(offeredMatch, DEMO.userId);
      }
    }
    const activeBots = SEED_BOTS.filter((bot) => bot.hoursSinceActive <= 72).map((bot) => bot.userId);
    expect(offered.map((m) => m.userB).sort()).toEqual([...activeBots].sort());
    expect((await skip(b)).offeredMatch).toBeNull();
  });

  it('R_HOME_19 never offers a user inactive for over 72 hours', async () => {
    const b = new MockBackend({ matchEvery: 1 });
    for (let i = 0; i < 8; i++) {
      const { offeredMatch } = await skip(b);
      expect(offeredMatch?.userB).not.toBe('u-echo');
    }
  });

  it('never offers someone demo already has a chat with', async () => {
    const b = new MockBackend({ matchEvery: 1, withSeedChats: true });
    for (let i = 0; i < 6; i++) {
      const { offeredMatch } = await skip(b);
      expect(['u-tempo', 'u-lyric']).not.toContain(offeredMatch?.userB);
    }
  });

  it('R_HOME_20 getPendingMatches lists unanswered matches for each user', async () => {
    const b = new MockBackend({ withPendingMatch: true });
    expect(await b.getPendingMatches(DEMO.userId)).toEqual([SEED_PENDING_MATCH.match]);
    expect(await b.getPendingMatches('u-harmony')).toEqual([]); // already confirmed
    expect(await b.getPendingMatches('u-melody')).toEqual([]);
  });

  it('getMatch returns the match only to its users, while it awaits their answer', async () => {
    const b = new MockBackend({ withPendingMatch: true, withBots: false });
    expect(await b.getMatch('m-seed', DEMO.userId)).toEqual(SEED_PENDING_MATCH.match);
    expect(await b.getMatch('m-seed', 'u-melody')).toBeNull();
    expect(await b.getMatch('missing', DEMO.userId)).toBeNull();
    expect(await b.getMatch('m-seed', 'u-harmony')).toBeNull(); // already answered
    await b.declineMatch(SEED_PENDING_MATCH.match, DEMO.userId);
    expect(await b.getMatch('m-seed', DEMO.userId)).toBeNull();
  });

  it('getOtherProfile returns the other user from either side', async () => {
    const b = new MockBackend({ withPendingMatch: true });
    const m = SEED_PENDING_MATCH.match;
    expect((await b.getOtherProfile(m, DEMO.userId)).username).toBe('harmony');
    expect((await b.getOtherProfile(m, 'u-harmony')).username).toBe('demo');
    await expect(b.getOtherProfile(m, 'u-melody')).rejects.toThrow();
  });

  it('R_HOME_23 confirm opens a chat only when both confirmed, and only one chat', async () => {
    const b = new MockBackend({ matchEvery: 1, withPendingMatch: true });
    // other user already confirmed: chat right away
    const chatId = await b.confirmMatch(SEED_PENDING_MATCH.match, DEMO.userId);
    expect(chatId).not.toBeNull();
    expect(await b.confirmMatch(SEED_PENDING_MATCH.match, DEMO.userId)).toBe(chatId);
    // fresh match: first confirm waits (OPEN-4), second creates the chat
    const fresh = (await skip(b)).offeredMatch!;
    expect(await b.confirmMatch(fresh, DEMO.userId)).toBeNull();
    expect(await b.confirmMatch(fresh, fresh.userB)).not.toBeNull();
    expect(await b.chatBackend.getChatLog(DEMO.userId)).toHaveLength(2);
  });

  it('R_HOME_22 a decline is final: confirming afterwards never opens a chat', async () => {
    const b = new MockBackend({ matchEvery: 1 });
    const fresh = (await skip(b)).offeredMatch!;
    await b.confirmMatch(fresh, DEMO.userId);
    await b.declineMatch(fresh, DEMO.userId);
    expect(await b.getPendingMatches(DEMO.userId)).not.toContainEqual(fresh);
    expect(await b.confirmMatch(fresh, fresh.userB)).toBeNull();
    expect(await b.confirmMatch(fresh, DEMO.userId)).toBeNull();
  });

  it('rejects decisions from outsiders and on unknown matches', async () => {
    const b = new MockBackend({ matchEvery: 1 });
    const fresh = (await skip(b)).offeredMatch!;
    await expect(b.confirmMatch(fresh, 'u-unverified')).rejects.toThrow();
    await expect(b.declineMatch({ ...fresh, matchId: 'missing' }, DEMO.userId)).rejects.toThrow();
  });
});

describe('MockBackend bots', () => {
  function clocked(options = {}) {
    let time = Date.parse('2026-11-23T12:00:00.000Z');
    const b = new MockBackend({ matchEvery: 12, random: () => 0, now: () => time, ...options });
    return { b, advance: (ms: number) => (time += ms) };
  }

  it('R_HOME_23 a compatible bot says yes a moment later, and the chat appears', async () => {
    const { b, advance } = clocked();
    const match = await swipeLoving(b, 'pop');
    expect(await b.confirmMatch(match, DEMO.userId)).toBeNull();
    advance(BOT_DECISION_MS.min - 1);
    expect(await b.chatBackend.getChatLog(DEMO.userId)).toEqual([]);
    advance(1);
    const [chat] = await b.chatBackend.getChatLog(DEMO.userId);
    expect(chat.otherUser.username).toBe('harmony');
  });

  it('an online bot greets you by naming a song you both liked', async () => {
    const { b, advance } = clocked();
    const match = await swipeLoving(b, 'pop');
    await b.confirmMatch(match, DEMO.userId);
    advance(BOT_DECISION_MS.min);
    const [chat] = await b.chatBackend.getChatLog(DEMO.userId);
    advance(BOT_GREETING_MS.min);
    const { messages } = await b.chatBackend.getHistory(chat.chatId, DEMO.userId);
    const liked = b.taste.getLikedSongs(DEMO.userId)[0];
    expect(messages.map((m) => m.text)).toEqual([`Hey! We both liked "${liked.title}".`]);
    expect(messages[0].senderId).toBe('u-harmony');
  });

  it('a greeting works even with no song in common', async () => {
    const { b, advance } = clocked({ withBots: true });
    b.matchModel.addMatch({ matchId: 'm-x', userA: DEMO.userId, userB: 'u-melody', compatibilityPercent: 90 }, []);
    await b.confirmMatch(b.matchModel.matchById('m-x'), DEMO.userId);
    advance(BOT_DECISION_MS.min);
    const [chat] = await b.chatBackend.getChatLog(DEMO.userId);
    advance(BOT_GREETING_MS.min);
    const { messages } = await b.chatBackend.getHistory(chat.chatId, DEMO.userId);
    expect(messages[0].text).toBe('Hey! Looks like we have similar taste.');
  });

  it('a bot says no to a match below its threshold, so no chat appears', async () => {
    const { b, advance } = clocked();
    const low: Match = { matchId: 'm-low', userA: DEMO.userId, userB: 'u-lyric', compatibilityPercent: 10 };
    b.matchModel.addMatch(low, []);
    expect(await b.confirmMatch(low, DEMO.userId)).toBeNull();
    advance(BOT_DECISION_MS.max);
    expect(await b.chatBackend.getChatLog(DEMO.userId)).toEqual([]);
    expect(await b.confirmMatch(low, DEMO.userId)).toBeNull();
  });

  it('a bot answers a repeated confirm only once', async () => {
    const { b, advance } = clocked();
    const match = await swipeLoving(b, 'rock');
    await b.confirmMatch(match, DEMO.userId);
    await b.confirmMatch(match, DEMO.userId);
    advance(BOT_DECISION_MS.max);
    expect(await b.chatBackend.getChatLog(DEMO.userId)).toHaveLength(1);
  });

  it('an online bot replies to a message, once per burst, and works through its lines', async () => {
    const { b, advance } = clocked();
    const match = await swipeLoving(b, 'folk');
    await b.confirmMatch(match, DEMO.userId);
    advance(BOT_DECISION_MS.min + BOT_GREETING_MS.min);
    const [{ chatId }] = await b.chatBackend.getChatLog(DEMO.userId);
    await b.chatBackend.getHistory(chatId, DEMO.userId);

    await b.chatBackend.sendMessage(chatId, DEMO.userId, 'hi');
    await b.chatBackend.sendMessage(chatId, DEMO.userId, 'anyone there?');
    advance(BOT_REPLY_MS.min);
    let { messages } = await b.chatBackend.getHistory(chatId, DEMO.userId);
    const lines = SEED_BOTS.find((bot) => bot.userId === 'u-melody')!.replies;
    expect(messages.filter((m) => m.senderId === 'u-melody').map((m) => m.text).slice(1)).toEqual([lines[0]]);

    await b.chatBackend.sendMessage(chatId, DEMO.userId, 'yes');
    advance(BOT_REPLY_MS.min);
    ({ messages } = await b.chatBackend.getHistory(chatId, DEMO.userId));
    expect(messages.at(-1)!.text).toBe(lines[1]);
  });

  it('an offline bot accepts but stays quiet', async () => {
    const { b, advance } = clocked();
    const match: Match = { matchId: 'm-off', userA: DEMO.userId, userB: 'u-lyric', compatibilityPercent: 90 };
    b.matchModel.addMatch(match, []);
    await b.confirmMatch(match, DEMO.userId);
    advance(BOT_DECISION_MS.max);
    const [{ chatId }] = await b.chatBackend.getChatLog(DEMO.userId);
    await b.chatBackend.sendMessage(chatId, DEMO.userId, 'hello?');
    advance(BOT_GREETING_MS.max + BOT_REPLY_MS.max);
    const { messages, otherUserOnline } = await b.chatBackend.getHistory(chatId, DEMO.userId);
    expect(messages.map((m) => m.senderId)).toEqual([DEMO.userId]);
    expect(otherUserOnline).toBe(false);
  });

  it('a bot that confirmed first greets when the person completes the match', async () => {
    const { b, advance } = clocked({ withPendingMatch: true });
    const chatId = await b.confirmMatch(SEED_PENDING_MATCH.match, DEMO.userId);
    advance(BOT_GREETING_MS.min);
    const { messages } = await b.chatBackend.getHistory(chatId!, DEMO.userId);
    expect(messages).toHaveLength(1);
    expect(messages[0].senderId).toBe('u-harmony');
  });

  it('a person chatting with another person gets no bot reply', async () => {
    const { b, advance } = clocked({ withBots: false, withPendingMatch: false });
    b.chatBackend.openChat('c-people', DEMO.userId, 'u-melody');
    await b.chatBackend.sendMessage('c-people', DEMO.userId, 'hi');
    advance(BOT_REPLY_MS.max);
    expect((await b.chatBackend.getHistory('c-people', DEMO.userId)).messages).toHaveLength(1);
  });

  it('when a match completes with a bot as the first user, it still greets', async () => {
    const { b, advance } = clocked();
    const match: Match = { matchId: 'm-rev', userA: 'u-rhythm', userB: DEMO.userId, compatibilityPercent: 90 };
    b.matchModel.addMatch(match, [DEMO.userId]);
    const chatId = await b.confirmMatch(match, 'u-rhythm');
    advance(BOT_GREETING_MS.max);
    expect((await b.chatBackend.getHistory(chatId!, DEMO.userId)).messages).toHaveLength(1);
  });
});
