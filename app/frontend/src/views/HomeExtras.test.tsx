// spec: the smooth progress bar, undo button, swipe and like effects, and developer mode.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createMockApi } from '../api/mock';
import { SEED_SONGS } from '../api/mockSeed';
import { FEATURE_NAMES, type SwipeResult, type UndoResult } from '../api/types';
import { readDevMode, writeDevMode } from '../settings/devMode';
import { FakePlayer } from '../test/fakePlayer';
import { renderApp } from '../test/renderApp';
import {
  MAX_BACKWARD_DRIFT_S,
  nextAnchorPosition,
  projectPosition,
  stampOpacity,
  SWIPE_THRESHOLD_PX,
} from './homeLogic';
import { SongProgress, type SongProgressProps } from './SongProgress';

const [FIRST, SECOND, THIRD] = SEED_SONGS;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openHome(mock = {}) {
  const rendered = renderApp({ path: '/home', userId: 'u-demo', mock });
  await screen.findByRole('heading', { name: FIRST.title });
  await waitFor(() => expect(rendered.api.backend).toBeDefined());
  return rendered;
}

const undoButton = () => screen.getByRole('button', { name: 'Go back to previous song' });
const skipButton = () => screen.getByRole('button', { name: 'Skip song' });
const likeNextButton = () => screen.getByRole('button', { name: 'Like and next song' });
const likeButton = () => screen.getByRole('button', { name: 'Like' });
const card = () => screen.getByTestId('song-card');

/** jsdom has no CSS animations, and React listens for the prefixed event name there. */
function endAnimation(element: Element) {
  fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }));
}

async function skipTo(title: string) {
  await userEvent.click(skipButton());
  await screen.findByRole('heading', { name: title });
}

describe('homeLogic helpers', () => {
  it.each([
    [0, 'right', 0],
    [SWIPE_THRESHOLD_PX / 2, 'right', 0.5],
    [SWIPE_THRESHOLD_PX, 'right', 1],
    [SWIPE_THRESHOLD_PX * 3, 'right', 1],
    [-40, 'right', 0],
    [-SWIPE_THRESHOLD_PX / 2, 'left', 0.5],
    [-SWIPE_THRESHOLD_PX, 'left', 1],
    [40, 'left', 0],
  ] as const)('stampOpacity(%d, %s) is %d', (dx, side, expected) => {
    expect(stampOpacity(dx, side)).toBe(expected);
  });

  it('projectPosition moves only while playing, and stops at the end', () => {
    const anchor = { positionSeconds: 10, at: 1000, isMoving: true };
    expect(projectPosition(anchor, 1000, 30)).toBe(10);
    expect(projectPosition(anchor, 1500, 30)).toBe(10.5);
    expect(projectPosition(anchor, 100_000, 30)).toBe(30);
    expect(projectPosition({ ...anchor, isMoving: false }, 5000, 30)).toBe(10);
  });

  it.each([
    ['a report ahead is taken', 5, 5.3, false, 5.3],
    ['a slightly late report does not pull the bar back', 5.3, 5, false, 5.3],
    ['exactly the allowed drift is ignored', 5 + MAX_BACKWARD_DRIFT_S, 5, false, 5 + MAX_BACKWARD_DRIFT_S],
    ['a real jump back is taken', 10, 2, false, 2],
    ['when paused the report always wins', 5.3, 5, true, 5],
    ['an equal report is taken', 5, 5, false, 5],
  ])('nextAnchorPosition: %s', (_, shown, reported, isPaused, expected) => {
    expect(nextAnchorPosition(shown, reported, isPaused)).toBe(expected);
  });
});

describe('SongProgress', () => {
  const props: SongProgressProps = {
    positionSeconds: 10,
    durationSeconds: 30,
    isPaused: false,
    disabled: false,
    onSeek: () => {},
  };
  const slider = () => screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('R_HOME_05 moves smoothly between player reports', () => {
    vi.useFakeTimers();
    render(<SongProgress {...props} />);
    expect(Number(slider().value)).toBe(10);
    advance(100);
    const early = Number(slider().value);
    advance(150);
    const later = Number(slider().value);
    expect(early).toBeGreaterThan(10);
    expect(early).toBeLessThan(10.2);
    expect(later).toBeGreaterThan(early);
    expect(later).toBeCloseTo(10.25, 1);
    expect(slider().step).toBe('any');
  });

  it('the time text changes only when the player reports', () => {
    vi.useFakeTimers();
    const view = render(<SongProgress {...props} />);
    advance(1500);
    expect(screen.getByText('0:10')).toBeInTheDocument();
    view.rerender(<SongProgress {...props} positionSeconds={12} />);
    expect(screen.getByText('0:12')).toBeInTheDocument();
    expect(slider()).toHaveAttribute('aria-valuetext', '0:12 of 0:30');
  });

  it('stops at the end of the song', () => {
    vi.useFakeTimers();
    render(<SongProgress {...props} positionSeconds={29.9} />);
    advance(2000);
    expect(Number(slider().value)).toBe(30);
  });

  it.each([
    ['paused', { isPaused: true }],
    ['disabled', { disabled: true }],
  ])('does not move while %s', (_, change) => {
    vi.useFakeTimers();
    render(<SongProgress {...props} {...change} />);
    advance(1000);
    expect(Number(slider().value)).toBe(10);
  });

  it('a slightly late report does not make it twitch backwards', () => {
    vi.useFakeTimers();
    const view = render(<SongProgress {...props} />);
    advance(400);
    const shown = Number(slider().value);
    view.rerender(<SongProgress {...props} positionSeconds={10.1} />);
    expect(Number(slider().value)).toBeGreaterThanOrEqual(shown);
  });

  it('a real jump in the reported position moves it at once', () => {
    vi.useFakeTimers();
    const view = render(<SongProgress {...props} />);
    view.rerender(<SongProgress {...props} positionSeconds={25} />);
    expect(Number(slider().value)).toBe(25);
    view.rerender(<SongProgress {...props} positionSeconds={3} />);
    expect(Number(slider().value)).toBe(3);
  });

  it('dragging follows the pointer and seeks once, on release', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn();
    const view = render(<SongProgress {...props} onSeek={onSeek} />);
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    fireEvent.change(slider(), { target: { value: '20' } });
    fireEvent.change(slider(), { target: { value: '22' } });
    expect(screen.getByText('0:22')).toBeInTheDocument();
    expect(onSeek).not.toHaveBeenCalled();

    // Neither time passing nor a player report moves it while held.
    advance(500);
    view.rerender(<SongProgress {...props} onSeek={onSeek} positionSeconds={11} />);
    expect(Number(slider().value)).toBe(22);

    fireEvent.pointerUp(slider(), { pointerId: 1 });
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(22);
    advance(100);
    expect(Number(slider().value)).toBeGreaterThan(22);
  });

  it('a cancelled drag still ends cleanly', () => {
    const onSeek = vi.fn();
    render(<SongProgress {...props} onSeek={onSeek} />);
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    fireEvent.change(slider(), { target: { value: '15' } });
    fireEvent.pointerCancel(slider(), { pointerId: 1 });
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(15);
  });

  it('a release without a press does nothing', () => {
    const onSeek = vi.fn();
    render(<SongProgress {...props} onSeek={onSeek} />);
    fireEvent.pointerUp(slider(), { pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('a keyboard change seeks at once, whether playing or paused', () => {
    const onSeek = vi.fn();
    const view = render(<SongProgress {...props} onSeek={onSeek} />);
    fireEvent.change(slider(), { target: { value: '14' } });
    expect(onSeek).toHaveBeenLastCalledWith(14);
    view.rerender(<SongProgress {...props} onSeek={onSeek} isPaused />);
    fireEvent.change(slider(), { target: { value: '16' } });
    expect(onSeek).toHaveBeenLastCalledWith(16);
  });

  it('stops animating when removed', () => {
    vi.useFakeTimers();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const view = render(<SongProgress {...props} />);
    view.unmount();
    expect(cancel).toHaveBeenCalled();
  });
});

describe('Undo button', () => {
  it('sits to the left of the like and play buttons', async () => {
    await openHome();
    const buttons = within(undoButton().parentElement!).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Go back to previous song', 'Like', 'Pause']);
  });

  it('is off until there is a song to go back to', async () => {
    await openHome();
    expect(undoButton()).toBeDisabled();
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
  });

  it('takes you back to the previous song and plays it from the start', async () => {
    const { api, player } = await openHome();
    act(() => player.playFor(5));
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    await userEvent.click(undoButton());
    expect(await screen.findByRole('heading', { name: FIRST.title })).toBeInTheDocument();
    expect(player.loaded).toEqual([FIRST.spotifyUri, SECOND.spotifyUri, FIRST.spotifyUri]);
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(api.backend.listens).toEqual([]);
    await waitFor(() => expect(undoButton()).toBeDisabled());
  });

  it('goes back more than one song', async () => {
    await openHome();
    await skipTo(SECOND.title);
    await skipTo(THIRD.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    await userEvent.click(undoButton());
    await screen.findByRole('heading', { name: SECOND.title });
    await waitFor(() => expect(undoButton()).toBeEnabled());
    await userEvent.click(undoButton());
    expect(await screen.findByRole('heading', { name: FIRST.title })).toBeInTheDocument();
  });

  it('shows the heart again if you had pressed it', async () => {
    await openHome();
    await userEvent.click(likeButton());
    await skipTo(SECOND.title);
    expect(likeButton()).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(undoButton()).toBeEnabled());
    await userEvent.click(undoButton());
    await screen.findByRole('heading', { name: FIRST.title });
    expect(likeButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('waits for a like still being saved before going back', async () => {
    const { api } = await openHome();
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    let finishLike!: () => void;
    vi.spyOn(api.songs, 'markLiked').mockImplementationOnce(
      (userId, songId) =>
        new Promise<void>((resolve) => {
          finishLike = () => void api.backend.markLiked(userId, songId).then(resolve);
        }),
    );
    const undo = vi.spyOn(api.songs, 'undoLastSwipe');
    await userEvent.click(likeButton());
    await userEvent.click(undoButton());
    expect(undo).not.toHaveBeenCalled();
    await act(async () => finishLike());
    await screen.findByRole('heading', { name: FIRST.title });
    expect(undo).toHaveBeenCalledOnce();
  });

  it('is still available after leaving Home and coming back', async () => {
    await openHome();
    await skipTo(SECOND.title);
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    await screen.findByRole('heading', { name: SECOND.title });
    await waitFor(() => expect(undoButton()).toBeEnabled());
  });

  it('if going back fails, stays on the song and says what to do', async () => {
    const { api } = await openHome();
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    vi.spyOn(api.songs, 'undoLastSwipe').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(undoButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't go back to the previous song");
    expect(screen.getByRole('heading', { name: SECOND.title })).toBeInTheDocument();
    expect(undoButton()).toBeEnabled();
  });

  it('turns off if the server has nothing to undo', async () => {
    const { api } = await openHome();
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    vi.spyOn(api.songs, 'undoLastSwipe').mockResolvedValueOnce(null);
    await userEvent.click(undoButton());
    await waitFor(() => expect(undoButton()).toBeDisabled());
    expect(screen.getByRole('heading', { name: SECOND.title })).toBeInTheDocument();
  });

  it('is disabled while waiting, so one press goes back once', async () => {
    const { api } = await openHome();
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    let finish!: (r: UndoResult) => void;
    const undo = vi.spyOn(api.songs, 'undoLastSwipe').mockReturnValue(new Promise((r) => (finish = r)));
    await userEvent.click(undoButton());
    expect(undoButton()).toBeDisabled();
    fireEvent.click(undoButton());
    expect(undo).toHaveBeenCalledOnce();
    await act(async () => finish({ song: FIRST, liked: false, canUndo: false }));
    expect(screen.getByRole('heading', { name: FIRST.title })).toBeInTheDocument();
  });

  it('stays off if the server cannot say whether undo is possible', async () => {
    const check = vi.spyOn(createMockApi().backend.constructor.prototype, 'canUndo').mockRejectedValue(new Error('offline'));
    await openHome();
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(undoButton()).toBeDisabled();
  });
});

describe('Swipe and like effects', () => {
  const flying = () => document.querySelector<HTMLElement>('.home__flying-card');
  const bursts = () => document.querySelectorAll('.like-burst');

  it.each([
    ['the skip arrow', skipButton, 'left'],
    ['the like arrow', likeNextButton, 'right'],
  ] as const)('%s flies the old card off that way, hidden from screen readers', async (_, button, direction) => {
    await openHome();
    await userEvent.click(button());
    await screen.findByRole('heading', { name: SECOND.title });
    const card = flying()!;
    expect(card).toHaveClass(`home__flying-card--${direction}`);
    expect(card).toHaveAttribute('src', FIRST.albumCoverUrl);
    expect(card).toHaveAttribute('aria-hidden', 'true');
    endAnimation(card);
    expect(flying()).toBeNull();
  });

  it('a swipe continues from where the card was dragged', async () => {
    await openHome();
    fireEvent.pointerDown(card(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 75, pointerId: 1 });
    fireEvent.pointerUp(card(), { clientX: 75, pointerId: 1 });
    await screen.findByRole('heading', { name: SECOND.title });
    expect(flying()!.style.getPropertyValue('--fly-from-x')).toBe('-125px');
    expect(flying()!.style.getPropertyValue('--fly-from-turn')).toBe('-5deg');
  });

  it('hides the card while the next song loads, then brings the new one in', async () => {
    const { api } = await openHome();
    let finish!: (r: SwipeResult) => void;
    vi.spyOn(api.songs, 'submitFeedback').mockReturnValue(new Promise((r) => (finish = r)));
    await userEvent.click(skipButton());
    expect(document.querySelector('.home__cover-frame')).toHaveClass('home__cover-frame--leaving');
    await act(async () => finish({ nextSong: SECOND, offeredMatch: null }));
    const frame = document.querySelector('.home__cover-frame');
    expect(frame).not.toHaveClass('home__cover-frame--leaving');
    expect(frame).toHaveClass('home__cover-frame--next');
  });

  it('if the swipe fails, the card comes back', async () => {
    const { api } = await openHome();
    vi.spyOn(api.songs, 'submitFeedback').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(skipButton());
    await screen.findByRole('alert');
    expect(flying()).toBeNull();
    expect(document.querySelector('.home__cover-frame')).not.toHaveClass('home__cover-frame--leaving');
  });

  it('undo brings the old card back with its own animation', async () => {
    await openHome();
    await skipTo(SECOND.title);
    await waitFor(() => expect(undoButton()).toBeEnabled());
    await userEvent.click(undoButton());
    await screen.findByRole('heading', { name: FIRST.title });
    expect(document.querySelector('.home__cover-frame')).toHaveClass('home__cover-frame--back');
    expect(flying()).toBeNull();
  });

  it('a like or skip badge fades in with the drag and disappears after', async () => {
    await openHome();
    const like = document.querySelector<HTMLElement>('.home__stamp--like')!;
    const skip = document.querySelector<HTMLElement>('.home__stamp--skip')!;
    expect(like.style.opacity).toBe('0');
    fireEvent.pointerDown(card(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 230, pointerId: 1 });
    expect(like.style.opacity).toBe('0.5');
    expect(skip.style.opacity).toBe('0');
    expect(card()).toHaveClass('home__card--dragging');
    fireEvent.pointerMove(card(), { clientX: 140, pointerId: 1 });
    expect(like.style.opacity).toBe('0');
    expect(skip.style.opacity).toBe('1');
    fireEvent.pointerCancel(card(), { pointerId: 1 });
    expect(skip.style.opacity).toBe('0');
    expect(card()).not.toHaveClass('home__card--dragging');
  });

  it('the like button sets off a burst that cleans itself up', async () => {
    await openHome();
    expect(bursts()).toHaveLength(0);
    await userEvent.click(likeButton());
    expect(bursts()).toHaveLength(1);
    expect(bursts()[0]).toHaveAttribute('aria-hidden', 'true');
    endAnimation(document.querySelector('.like-burst__heart')!);
    expect(bursts()).toHaveLength(0);
  });

  it('pressing the heart again adds no second burst', async () => {
    await openHome();
    await userEvent.click(likeButton());
    await userEvent.click(likeButton());
    expect(bursts()).toHaveLength(1);
  });

  it('swiping right sets off a burst, and swiping left does not', async () => {
    await openHome();
    await userEvent.click(skipButton());
    await screen.findByRole('heading', { name: SECOND.title });
    expect(bursts()).toHaveLength(0);
    await userEvent.click(likeNextButton());
    await screen.findByRole('heading', { name: THIRD.title });
    expect(bursts()).toHaveLength(1);
  });

  it('keeps at most three bursts at once', async () => {
    await openHome();
    for (let i = 1; i <= 4; i++) {
      await userEvent.click(likeNextButton());
      await screen.findByRole('heading', { name: SEED_SONGS[i].title });
    }
    expect(bursts().length).toBeLessThanOrEqual(3);
  });
});

describe('Developer mode', () => {
  const devSwitch = () => screen.getByRole('switch', { name: 'Developer mode' });

  async function openProfile(mock = {}) {
    const rendered = renderApp({ path: '/profile', userId: 'u-demo', mock });
    await screen.findByText('demo', { selector: '.profile__name' });
    return rendered;
  }

  it('is off by default, with no stats on either page', async () => {
    await openProfile();
    expect(devSwitch()).not.toBeChecked();
    expect(devSwitch()).toHaveAccessibleDescription(/song's stats/);
    expect(screen.queryByRole('region', { name: 'Your taste vector' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    await screen.findByRole('heading', { name: FIRST.title });
    expect(screen.queryByRole('region', { name: 'Song stats' })).not.toBeInTheDocument();
  });

  it('turning it on shows your taste vector, labelled as demo data', async () => {
    await openProfile();
    await userEvent.click(devSwitch());
    const panel = await screen.findByRole('region', { name: 'Your taste vector' });
    await within(panel).findByRole('meter', { name: 'Energy' });
    expect(within(panel).getAllByRole('meter')).toHaveLength(FEATURE_NAMES.length);
    for (const name of FEATURE_NAMES) {
      expect(within(panel).getByRole('meter', { name })).toHaveAttribute('aria-valuetext', '0.50');
    }
    expect(panel).toHaveTextContent('Demo data');
    expect(panel).toHaveTextContent('Swipe on some songs');
  });

  it('turning it off hides it again and is remembered', async () => {
    await openProfile();
    await userEvent.click(devSwitch());
    expect(readDevMode()).toBe(true);
    await userEvent.click(devSwitch());
    expect(readDevMode()).toBe(false);
    expect(screen.queryByRole('region', { name: 'Your taste vector' })).not.toBeInTheDocument();
  });

  it("shows each song's stats on Home, and updates with the next song", async () => {
    writeDevMode(true);
    await openHome();
    const panel = screen.getByRole('region', { name: 'Song stats' });
    FEATURE_NAMES.forEach((name, i) => {
      expect(within(panel).getByRole('meter', { name })).toHaveAttribute('aria-valuetext', FIRST.features[i].toFixed(2));
    });
    expect(panel).toHaveTextContent(FIRST.id);
    expect(panel).toHaveTextContent(FIRST.spotifyUri);
    expect(panel).toHaveTextContent('Demo data');
    await skipTo(SECOND.title);
    expect(screen.getByRole('region', { name: 'Song stats' })).toHaveTextContent(SECOND.spotifyUri);
  });

  it('your taste vector reflects your swipes', async () => {
    writeDevMode(true);
    await openHome();
    await userEvent.click(likeNextButton());
    await screen.findByRole('heading', { name: SECOND.title });
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    const panel = await screen.findByRole('region', { name: 'Your taste vector' });
    const meter = await within(panel).findByRole('meter', { name: 'Acousticness' });
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(0.5);
    expect(panel).toHaveTextContent('Likes pull');
  });

  it('if the taste vector cannot load, says so and offers to try again', async () => {
    writeDevMode(true);
    const { api } = renderApp({ path: '/login', userId: null });
    vi.spyOn(api.songs, 'getTasteVector').mockRejectedValueOnce(new Error('offline'));
    await userEvent.type(screen.getByLabelText('Email'), 'demo@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-pass-1{Enter}');
    await screen.findByRole('heading', { name: 'Home' });
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    const panel = await screen.findByRole('region', { name: 'Your taste vector' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent("Couldn't load your taste vector");
    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByRole('meter', { name: 'Energy' })).toBeInTheDocument();
  });

  it('ignores a reply that arrives after leaving the page', async () => {
    writeDevMode(true);
    const { api } = renderApp({ path: '/login', userId: null });
    let finish!: (taste: number[]) => void;
    let fail!: (e: Error) => void;
    const get = vi.spyOn(api.songs, 'getTasteVector');
    get.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.type(screen.getByLabelText('Email'), 'demo@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-pass-1{Enter}');
    await screen.findByRole('heading', { name: 'Home' });
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await screen.findByRole('region', { name: 'Your taste vector' });
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    await act(async () => finish([0, 0, 0, 0, 0, 0, 0]));
    get.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await screen.findByRole('region', { name: 'Your taste vector' });
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    await act(async () => fail(new Error('offline')));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('with real data, there is no demo label', async () => {
    writeDevMode(true);
    const api = { ...createMockApi({ songOrder: 'library' }), demo: undefined };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App api={api} initialUserId="u-demo" createPlayer={new FakePlayer().factory} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: FIRST.title });
    expect(screen.getByRole('region', { name: 'Song stats' })).not.toHaveTextContent('Demo data');
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    const panel = await screen.findByRole('region', { name: 'Your taste vector' });
    await within(panel).findByRole('meter', { name: 'Energy' });
    expect(panel).not.toHaveTextContent('Demo data');
  });

  it('still works when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    expect(readDevMode()).toBe(false);
    expect(() => writeDevMode(true)).not.toThrow();
  });
});
