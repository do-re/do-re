// spec: SongApi.undoLastSwipe, canUndo and getTasteVector (client.ts). No numbered requirement.
import { describe, expect, it } from 'vitest';
import { MockBackend } from './mock';
import { SEED_SONGS } from './mockSeed';
import { CACHE_SIZE, MockSuggestionModel } from './mockSuggestions';
import { HISTORY_SIZE, MockTasteModel, NEUTRAL_VALUE, UNDO_LIMIT } from './mockTaste';
import { FEATURE_COUNT, type Feedback } from './types';

const DEMO = 'u-demo';

async function swipe(b: MockBackend, feedback: Feedback = 'SKIP', seconds = 10) {
  const song = await b.getCurrentSong(DEMO);
  const result = await b.submitFeedback(DEMO, song.id, feedback, seconds);
  return { song, ...result };
}

describe('undoLastSwipe', () => {
  it('has nothing to undo before the first swipe', async () => {
    const b = new MockBackend();
    await b.getCurrentSong(DEMO);
    expect(await b.canUndo(DEMO)).toBe(false);
    expect(await b.undoLastSwipe(DEMO)).toBeNull();
  });

  it('brings back the previous song and erases the listen', async () => {
    const b = new MockBackend();
    const before = await b.getTasteVector(DEMO);
    const { song, nextSong } = await swipe(b, 'LIKE');
    expect(await b.canUndo(DEMO)).toBe(true);
    expect(await b.getTasteVector(DEMO)).not.toEqual(before);

    expect(await b.undoLastSwipe(DEMO)).toEqual({ song, liked: false, canUndo: false });
    expect(await b.getCurrentSong(DEMO)).toBe(song);
    expect(await b.getTasteVector(DEMO)).toEqual(before);
    expect(b.taste.getRecentSongs(DEMO)).toEqual([]);
    expect(b.listens).toEqual([]);
    expect(await b.canUndo(DEMO)).toBe(false);

    // The song it left comes up next again.
    expect((await swipe(b)).nextSong).toBe(nextSong);
  });

  it('a song swiped again after undo counts once', async () => {
    const b = new MockBackend();
    const { song } = await swipe(b, 'LIKE');
    await b.undoLastSwipe(DEMO);
    await swipe(b, 'LIKE');
    expect(b.listens.filter((l) => l.songId === song.id)).toHaveLength(1);
    expect(b.taste.getLikedSongs(DEMO)).toEqual([song]);
  });

  it('R_HOME_25 keeps the like button on if it was pressed before leaving', async () => {
    const b = new MockBackend();
    const song = await b.getCurrentSong(DEMO);
    await b.markLiked(DEMO, song.id);
    await b.submitFeedback(DEMO, song.id, 'SKIP', 5);
    expect((await b.undoLastSwipe(DEMO))!.liked).toBe(true);
    await b.submitFeedback(DEMO, song.id, 'SKIP', 5);
    expect(b.listens.at(-1)!.feedback).toBe('LIKE');
  });

  it('a swipe right that is undone does not stay liked', async () => {
    const b = new MockBackend();
    const { song } = await swipe(b, 'LIKE');
    expect((await b.undoLastSwipe(DEMO))!.liked).toBe(false);
    await b.submitFeedback(DEMO, song.id, 'SKIP', 5);
    expect(b.listens.at(-1)!.feedback).toBe('SKIP');
  });

  it('clears a like pressed on the song being left', async () => {
    const b = new MockBackend();
    const { nextSong } = await swipe(b);
    await b.markLiked(DEMO, nextSong.id);
    await b.undoLastSwipe(DEMO);
    const { song } = await swipe(b);
    expect(b.listens.at(-1)).toMatchObject({ songId: song.id, feedback: 'SKIP' });
  });

  it('goes back through several songs in order', async () => {
    const b = new MockBackend();
    const first = (await swipe(b)).song;
    const second = (await swipe(b)).song;
    const third = (await swipe(b)).song;
    expect((await b.undoLastSwipe(DEMO))!).toEqual({ song: third, liked: false, canUndo: true });
    expect((await b.undoLastSwipe(DEMO))!.song).toBe(second);
    expect((await b.undoLastSwipe(DEMO))!).toEqual({ song: first, liked: false, canUndo: false });
  });

  it(`can go back at most ${UNDO_LIMIT} swipes`, async () => {
    const b = new MockBackend({ matchEvery: 1000 });
    for (let i = 0; i < UNDO_LIMIT + 2; i++) await swipe(b);
    for (let i = 0; i < UNDO_LIMIT; i++) expect(await b.undoLastSwipe(DEMO)).not.toBeNull();
    expect(await b.undoLastSwipe(DEMO)).toBeNull();
  });

  it('only affects the caller', async () => {
    const b = new MockBackend();
    await swipe(b);
    const other = await b.getCurrentSong('u-melody');
    await b.submitFeedback('u-melody', other.id, 'SKIP', 1);
    await b.undoLastSwipe(DEMO);
    expect(b.listens.map((l) => l.userId)).toEqual(['u-melody']);
    expect(await b.canUndo('u-melody')).toBe(true);
  });

  it('R_HOME_19 undo can\'t be used to reach the match count sooner', async () => {
    const b = new MockBackend({ matchEvery: 3 });
    await swipe(b);
    await swipe(b);
    await b.undoLastSwipe(DEMO);
    expect((await swipe(b)).offeredMatch).toBeNull(); // back to two swipes
    expect((await swipe(b)).offeredMatch).not.toBeNull();
  });

  it('a match already offered stays, and is not offered twice', async () => {
    const b = new MockBackend({ matchEvery: 2 });
    await swipe(b);
    const { offeredMatch } = await swipe(b);
    await b.undoLastSwipe(DEMO);
    expect(await b.getPendingMatches(DEMO)).toEqual([offeredMatch]);
    expect((await swipe(b)).offeredMatch).toBeNull();
  });

  it('works in library order, playing the same songs again', async () => {
    const b = new MockBackend({ songOrder: 'library' });
    const { song, nextSong } = await swipe(b);
    expect(song).toBe(SEED_SONGS[0]);
    await b.undoLastSwipe(DEMO);
    expect((await swipe(b)).nextSong).toBe(nextSong);
  });
});

describe('getTasteVector', () => {
  it('is 0.5 everywhere for a new user', async () => {
    const b = new MockBackend();
    expect(await b.getTasteVector(DEMO)).toEqual(Array(FEATURE_COUNT).fill(NEUTRAL_VALUE));
  });

  it('rejects an unknown user', async () => {
    await expect(new MockBackend().getTasteVector('nobody')).rejects.toThrow();
  });
});

describe('MockTasteModel.undoLastListen', () => {
  it('returns false when there is nothing to undo', () => {
    const model = new MockTasteModel();
    expect(model.undoLastListen('u')).toBe(false);
    model.recordListen('u', SEED_SONGS[0], 'LIKE', 30);
    expect(model.undoLastListen('u')).toBe(true);
    expect(model.undoLastListen('u')).toBe(false);
  });

  it('restores the oldest song if the listen pushed it out of the 100-song history', () => {
    const model = new MockTasteModel();
    model.recordListen('u', SEED_SONGS[1], 'SKIP', 0);
    for (let i = 1; i < HISTORY_SIZE; i++) model.recordListen('u', SEED_SONGS[0], 'SKIP', 0);
    model.recordListen('u', SEED_SONGS[2], 'SKIP', 0);
    expect(model.getRecentSongs('u')).not.toContain(SEED_SONGS[1]);
    model.undoLastListen('u');
    const recent = model.getRecentSongs('u');
    expect(recent).toHaveLength(HISTORY_SIZE);
    expect(recent.at(-1)).toBe(SEED_SONGS[1]);
    expect(recent[0]).toBe(SEED_SONGS[0]);
  });
});

describe('MockSuggestionModel.returnSuggestion', () => {
  const neutral = Array(FEATURE_COUNT).fill(NEUTRAL_VALUE);

  it('puts the song back at the front, keeping the cache at its size', () => {
    const model = new MockSuggestionModel(SEED_SONGS);
    model.nextSuggestion('u', neutral);
    const second = model.nextSuggestion('u', neutral);
    model.returnSuggestion('u', second);
    expect(model.nextSuggestion('u', neutral)).toBe(second);
  });

  it('never leaves the restored song in the cache, even with the smallest library', () => {
    const tiny = SEED_SONGS.slice(0, CACHE_SIZE + 1);
    const model = new MockSuggestionModel(tiny);
    const first = model.nextSuggestion('u', neutral);
    const second = model.nextSuggestion('u', neutral);
    model.returnSuggestion('u', second);
    const next = model.nextSuggestion('u', neutral);
    expect(next).not.toBe(first);
    expect(() => model.checkRep()).not.toThrow();
  });
});
