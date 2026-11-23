import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../api/mock';
import { SEED_SONGS } from '../api/mockSeed';
import type { SwipeResult } from '../api/types';
import { renderApp } from '../test/renderApp';

const [FIRST, SECOND] = SEED_SONGS;

/** Opens /home as the demo user and waits for the first song. */
async function openHome(mock = {}) {
  const rendered = renderApp({ path: '/home', userId: 'u-demo', mock });
  await screen.findByRole('heading', { name: FIRST.title });
  return rendered;
}

const skipButton = () => screen.getByRole('button', { name: 'Skip song' });
const likeNextButton = () => screen.getByRole('button', { name: 'Like and next song' });
const likeButton = () => screen.getByRole('button', { name: 'Like' });
const card = () => screen.getByTestId('song-card');

function swipe(dx: number) {
  fireEvent.pointerDown(card(), { clientX: 200, pointerId: 1 });
  fireEvent.pointerMove(card(), { clientX: 200 + dx / 2, pointerId: 1 });
  fireEvent.pointerUp(card(), { clientX: 200 + dx, pointerId: 1 });
}

describe('HomeView displaying a song', () => {
  it('R_HOME_03 R_HOME_04 shows the active song: title, artist and album cover', async () => {
    await openHome();
    expect(screen.getByText(FIRST.artist)).toBeInTheDocument();
    const cover = screen.getByRole('img', { name: `Album cover of ${FIRST.title} by ${FIRST.artist}` });
    expect(cover).toHaveAttribute('src', FIRST.albumCoverUrl);
  });

  it('R_HOME_13 starts playing the song through the player when shown', async () => {
    const { player } = await openHome();
    expect(player.loaded).toEqual([FIRST.spotifyUri]);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(player.container).toBeInTheDocument();
  });

  it('R_HOME_07 shows the play button when the browser blocks autoplay', async () => {
    const rendered = renderApp({ path: '/home', userId: 'u-demo' });
    rendered.player.autoplayBlocked = true;
    await screen.findByRole('heading', { name: FIRST.title });
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('R_HOME_09 colours the full-page background from the song', async () => {
    const { container } = await openHome();
    const background = container.querySelector<HTMLElement>('.home__background')!;
    expect(background.style.background).toMatch(/hsl|rgb/);
  });

  it('shows a loading message until the song arrives', async () => {
    renderApp({ path: '/home', userId: 'u-demo' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading your next song…');
    expect(skipButton()).toBeDisabled();
    await screen.findByRole('heading', { name: FIRST.title });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('if the song cannot be loaded, says so and offers to try again', async () => {
    // Spy on the class: the page asks for the song while it first renders.
    const get = vi.spyOn(MockBackend.prototype, 'getCurrentSong').mockRejectedValueOnce(new Error('offline'));
    try {
      renderApp({ path: '/home', userId: 'u-demo' });
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load a song");
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: FIRST.title })).toBeInTheDocument();
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      get.mockRestore();
    }
  });

  it('destroys the player when the user leaves the page', async () => {
    const { player } = await openHome();
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    expect(player.destroyed).toBe(true);
  });
});

describe('HomeView playtime and slider', () => {
  it('R_HOME_05 shows how long the song has been playing, and its length', async () => {
    const { player } = await openHome();
    act(() => player.playFor(12));
    expect(screen.getByText('0:12')).toBeInTheDocument();
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '0:12 of 0:30');
  });

  it('moving the slider seeks the player', async () => {
    const { player } = await openHome();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    expect(player.seeks).toEqual([20]);
    expect(screen.getByText('0:20')).toBeInTheDocument();
  });

  it('falls back to the song length until the player reports one', async () => {
    const { player } = await openHome();
    act(() => player.emit({ positionSeconds: 0, durationSeconds: 0, isPaused: false }));
    expect(screen.getByText(`0:${FIRST.durationSeconds}`)).toBeInTheDocument();
  });
});

describe('HomeView play and pause', () => {
  it('R_HOME_06 R_HOME_07 the pause button pauses and is replaced by a play button', async () => {
    const { player } = await openHome();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(player.toggles).toBe(1);
    expect(player.state.isPaused).toBe(true);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('R_HOME_08 play resumes from the paused timestamp without reloading or seeking', async () => {
    const { player } = await openHome();
    act(() => player.playFor(9));
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.state).toMatchObject({ positionSeconds: 9, isPaused: false });
    expect(player.loaded).toHaveLength(1);
    expect(player.seeks).toEqual([]);
    expect(screen.getByText('0:09')).toBeInTheDocument();
  });
});

describe('HomeView leaving a song', () => {
  it('R_HOME_14 R_HOME_15 the left arrow skips: sends SKIP with the time listened and plays a new song', async () => {
    const { api, player } = await openHome();
    act(() => player.playFor(7));
    await userEvent.click(skipButton());
    expect(await screen.findByRole('heading', { name: SECOND.title })).toBeInTheDocument();
    expect(api.backend.listens).toEqual([
      { userId: 'u-demo', songId: FIRST.id, feedback: 'SKIP', secondsListened: 7 },
    ]);
    expect(player.loaded).toEqual([FIRST.spotifyUri, SECOND.spotifyUri]);
    expect(screen.getByText('0:00')).toBeInTheDocument(); // slider reset
  });

  it('R_HOME_16 the right arrow likes the song and moves to a new one', async () => {
    const { api } = await openHome();
    await userEvent.click(likeNextButton());
    expect(await screen.findByRole('heading', { name: SECOND.title })).toBeInTheDocument();
    expect(api.backend.listens[0]).toMatchObject({ songId: FIRST.id, feedback: 'LIKE' });
  });

  it.each([
    ['R_HOME_14 R_HOME_24 swiping left skips', -120, 'SKIP'],
    ['R_HOME_16 R_HOME_24 swiping right likes', 120, 'LIKE'],
    ['a swipe exactly at the threshold counts', -60, 'SKIP'],
  ])('%s', async (_, dx, feedback) => {
    const { api } = await openHome();
    swipe(dx);
    expect(await screen.findByRole('heading', { name: SECOND.title })).toBeInTheDocument();
    expect(api.backend.listens[0].feedback).toBe(feedback);
  });

  it('a short drag (59 px) is not a swipe, and the card snaps back', async () => {
    const { api } = await openHome();
    fireEvent.pointerDown(card(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 259, pointerId: 1 });
    expect(card().style.transform).toContain('translateX(59px)');
    fireEvent.pointerUp(card(), { clientX: 259, pointerId: 1 });
    expect(card().style.transform).toBe('');
    expect(api.backend.listens).toEqual([]);
  });

  it('a cancelled drag does nothing; moves and releases without a press are ignored', async () => {
    const { api } = await openHome();
    fireEvent.pointerMove(card(), { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(card(), { clientX: 400, pointerId: 1 });
    fireEvent.pointerDown(card(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerCancel(card(), { pointerId: 1 });
    fireEvent.pointerUp(card(), { clientX: 400, pointerId: 1 });
    expect(card().style.transform).toBe('');
    expect(api.backend.listens).toEqual([]);
  });

  it('seeking does not count as time listened', async () => {
    const { api, player } = await openHome();
    act(() => player.playFor(3));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '25' } });
    act(() => player.playFor(2));
    await userEvent.click(skipButton());
    await screen.findByRole('heading', { name: SECOND.title });
    expect(api.backend.listens[0].secondsListened).toBe(5);
  });

  it('disables the arrows while waiting, so one press leaves the song once', async () => {
    const { api } = await openHome();
    let resolve!: (r: SwipeResult) => void;
    const submit = vi
      .spyOn(api.songs, 'submitFeedback')
      .mockReturnValue(new Promise<SwipeResult>((r) => (resolve = r)));
    await userEvent.click(skipButton());
    expect(skipButton()).toBeDisabled();
    expect(likeNextButton()).toBeDisabled();
    swipe(-120); // swipes are ignored too
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ nextSong: SECOND, offeredMatch: null }));
    expect(screen.getByRole('heading', { name: SECOND.title })).toBeInTheDocument();
    expect(skipButton()).toBeEnabled();
  });

  it('if the next song cannot be loaded, keeps the current one and says what to do', async () => {
    const { api } = await openHome();
    vi.spyOn(api.songs, 'submitFeedback').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(skipButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the next song");
    expect(screen.getByRole('heading', { name: FIRST.title })).toBeInTheDocument();
    await userEvent.click(skipButton()); // retry works and clears the message
    expect(await screen.findByRole('heading', { name: SECOND.title })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('HomeView like button', () => {
  it('R_HOME_10 R_HOME_25 likes the song without changing, pausing or restarting it', async () => {
    const { api, player } = await openHome();
    act(() => player.playFor(4));
    const markLiked = vi.spyOn(api.songs, 'markLiked');
    await userEvent.click(likeButton());
    expect(likeButton()).toHaveAttribute('aria-pressed', 'true');
    expect(markLiked).toHaveBeenCalledWith('u-demo', FIRST.id);
    expect(screen.getByRole('heading', { name: FIRST.title })).toBeInTheDocument();
    expect(player.loaded).toHaveLength(1);
    expect(player.toggles).toBe(0);
    expect(player.seeks).toEqual([]);
    expect(player.state).toMatchObject({ positionSeconds: 4, isPaused: false });
  });

  it('R_HOME_25 a song liked with the button counts as one like when skipped', async () => {
    const { api } = await openHome();
    await userEvent.click(likeButton());
    await userEvent.click(likeButton()); // second press does nothing
    await userEvent.click(skipButton());
    await screen.findByRole('heading', { name: SECOND.title });
    expect(api.backend.listens).toHaveLength(1);
    expect(api.backend.listens[0].feedback).toBe('LIKE');
    expect(likeButton()).toHaveAttribute('aria-pressed', 'false'); // new song starts unliked
  });

  it('R_HOME_25 skipping right after liking waits for the like to be saved first', async () => {
    const { api } = await openHome();
    let finishLike!: () => void;
    vi.spyOn(api.songs, 'markLiked').mockImplementationOnce(
      (userId, songId) =>
        new Promise<void>((resolve) => {
          finishLike = () => void api.backend.markLiked(userId, songId).then(resolve);
        }),
    );
    const submit = vi.spyOn(api.songs, 'submitFeedback');
    await userEvent.click(likeButton());
    await userEvent.click(skipButton());
    expect(submit).not.toHaveBeenCalled();
    await act(async () => finishLike());
    await screen.findByRole('heading', { name: SECOND.title });
    expect(api.backend.listens[0].feedback).toBe('LIKE');
  });

  it('if saving the like fails, un-likes the button and says to try again', async () => {
    const { api } = await openHome();
    vi.spyOn(api.songs, 'markLiked').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(likeButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your like");
    expect(likeButton()).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(skipButton()); // a failed like doesn't block moving on
    await screen.findByRole('heading', { name: SECOND.title });
    expect(api.backend.listens[0].feedback).toBe('SKIP');
  });
});

describe('HomeView matches', () => {
  it('R_HOME_20 opens a pending match when the page opens', async () => {
    renderApp({ path: '/home', userId: 'u-demo', mock: { withPendingMatch: true } });
    expect(await screen.findByRole('heading', { name: 'Match' })).toBeInTheDocument();
  });

  it('R_HOME_20 opens each pending match by itself only once per tab', async () => {
    renderApp({ path: '/home', userId: 'u-demo', mock: { withPendingMatch: true } });
    await screen.findByRole('heading', { name: 'Match' });
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByRole('heading', { name: FIRST.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('R_HOME_19 opens the match offered after a swipe', async () => {
    await openHome({ matchEvery: 1 });
    await userEvent.click(skipButton());
    expect(await screen.findByRole('heading', { name: 'Match' })).toBeInTheDocument();
  });

  it('still shows the song if pending matches cannot be loaded', async () => {
    const pending = vi
      .spyOn(MockBackend.prototype, 'getPendingMatches')
      .mockRejectedValueOnce(new Error('offline'));
    try {
      renderApp({ path: '/home', userId: 'u-demo', mock: { withPendingMatch: true } });
      expect(await screen.findByRole('heading', { name: FIRST.title })).toBeInTheDocument();
      expect(pending).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    } finally {
      pending.mockRestore();
    }
  });
});
