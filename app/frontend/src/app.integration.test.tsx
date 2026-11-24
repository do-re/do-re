/**
 * The whole app on the demo backend, with a controllable clock: the journeys the team will walk
 * through at the manual review.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createMockApi } from './api/mock';
import { BOT_DECISION_MS, BOT_GREETING_MS, BOT_REPLY_MS } from './api/mockBots';
import { songsInGenre, type Genre } from './api/mockSeed';
import { selectBackend } from './backend';
import { ErrorBoundary } from './components/ErrorBoundary';
import { createSpotifyPlayer } from './player/spotifyPlayer';
import { createSimulatedPlayer, DEMO_TICK_MS, DEMO_TRACK_SECONDS } from './player/simulatedPlayer';
import type { PlaybackState } from './player/types';
import { readSessionToken, readStoredUserId, clearStoredSession, notifySessionExpired, storeSession } from './session/sessionStore';
import { SessionProvider, useSession } from './session/SessionContext';
import { FakePlayer } from './test/fakePlayer';
import { renderApp } from './test/renderApp';
import { displayName, BLANK_USERNAME_LABEL } from './api/profile';
import { readNotice } from './views/homeLogic';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearStoredSession();
});

function renderDemo(path: string, options: Parameters<typeof createMockApi>[0] = {}, userId: string | null = 'u-demo') {
  const api = createMockApi({ random: () => 0, ...options });
  const player = new FakePlayer();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} initialUserId={userId} createPlayer={player.factory} />
    </MemoryRouter>,
  );
  return { api, player };
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Swipes on Home like someone who loves one style, until the match page opens. */
async function swipeToMatch(genre: Genre) {
  const loved = new Set(songsInGenre(genre).map((s) => s.title));
  for (let i = 0; i < 40; i++) {
    await tick();
    if (screen.queryByRole('heading', { name: /^You matched with / })) return;
    const title = document.querySelector('.home__title')?.textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: loved.has(title) ? 'Like and next song' : 'Skip song' }));
    await tick();
  }
  throw new Error('no match offered');
}

describe('the full journey', () => {
  it('R_HOME_19 R_HOME_23 logging in shows songs, liking them finds a bot, and you can chat', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-23T12:00:00.000Z') });
    renderDemo('/home', { matchEvery: 10 });
    await tick();
    // No match at login.
    expect(screen.queryByRole('heading', { name: /^You matched with / })).not.toBeInTheDocument();
    expect(document.querySelector('.home__title')).not.toBeNull();

    await swipeToMatch('pop');
    expect(screen.getByRole('heading', { name: 'You matched with harmony!' })).toBeInTheDocument();
    expect(screen.getByText(/% match!$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /play$/i }));
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('You said yes to harmony!');

    // The bot says yes a moment later, and the chat appears in Messages.
    fireEvent.click(screen.getByRole('link', { name: 'Messages' }));
    await tick();
    expect(screen.getByText('No chats yet. Keep swiping to find a match.')).toBeInTheDocument();
    await tick(BOT_DECISION_MS.min + 5000);
    const row = screen.getByRole('link', { name: /^Chat with harmony/ });

    fireEvent.click(row);
    await tick();
    await tick(BOT_GREETING_MS.min + 3000);
    expect(screen.getByRole('heading', { name: 'harmony' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
    expect(screen.getByText(/Hey! We both liked/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message harmony' }), { target: { value: 'hi!' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Message harmony' }).closest('form')!);
    await tick();
    expect(screen.getByText('hi!')).toBeInTheDocument();
    await tick(BOT_REPLY_MS.min + 3000);
    expect(screen.getByText('This is my favourite kind of playlist!')).toBeInTheDocument();
  });

  it('R_SEC_01 R_SEC_02 R_ACC_01 sign up, open the demo link, then log in with a new blank account', async () => {
    renderDemo('/signup', {}, null);
    await userEvent.type(screen.getByLabelText('Email'), 'new@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'new-pass-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'new-pass-1{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Check your email' });
    await userEvent.click(within(dialog).getByRole('link', { name: 'Open your verification link' }));
    expect(await screen.findByText('Your email is verified. Log in to start swiping.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Go to login' }));
    await userEvent.type(screen.getByLabelText('Email'), 'new@do-re.test');
    await userEvent.type(screen.getByLabelText('Password'), 'new-pass-1{Enter}');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(readSessionToken()).toMatch(/^mock-session-/);

    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    expect(await screen.findByText(BLANK_USERNAME_LABEL, { selector: '.profile__name' })).toBeInTheDocument();
    expect(screen.getByText('Choose a username so your matches know what to call you.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByRole('img', { name: /Do~Re logo/ })).toBeInTheDocument();
    expect(screen.getByText(/BEARicons/)).toBeInTheDocument();
  });
});

describe('VerifyEmailView', () => {
  async function signedUp() {
    const api = createMockApi();
    await api.account.createAccount('new@do-re.test', 'pw', 'pw');
    return { api, link: api.demo!.verificationLinkFor('new@do-re.test')! };
  }

  function open(api: ReturnType<typeof createMockApi>, path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App api={api} initialUserId={null} createPlayer={new FakePlayer().factory} />
      </MemoryRouter>,
    );
  }

  it('R_SEC_02 a valid link verifies the account, with no bottom bar', async () => {
    const { api, link } = await signedUp();
    open(api, link);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your link');
    expect(await screen.findByText(/your email is verified/i)).toBeInTheDocument();
    expect(await api.account.isVerified('new@do-re.test')).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('sends the single-use token only once, even under StrictMode', async () => {
    const { api, link } = await signedUp();
    const confirm = vi.spyOn(api.account, 'confirmEmail');
    const { StrictMode } = await import('react');
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[link]}>
          <App api={api} initialUserId={null} createPlayer={new FakePlayer().factory} />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(await screen.findByText(/your email is verified/i)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it.each(['/verify', '/verify?userId=u-1', '/verify?token=abc'])('%s is an invalid link', async (path) => {
    const api = createMockApi();
    const confirm = vi.spyOn(api.account, 'confirmEmail');
    open(api, path);
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has already been used/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a wrong or used token says so and links to login', async () => {
    const { api } = await signedUp();
    open(api, '/verify?userId=u-1&token=wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has already been used/);
    await userEvent.click(screen.getByRole('link', { name: 'Go to login' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('a network failure offers to try again', async () => {
    const { api, link } = await signedUp();
    vi.spyOn(api.account, 'confirmEmail').mockRejectedValueOnce(new Error('offline'));
    open(api, link);
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't verify");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/your email is verified/i)).toBeInTheDocument();
  });

  it('ignores a reply that arrives after leaving the page', async () => {
    const { api, link } = await signedUp();
    let finish: (ok: boolean) => void = () => {};
    let fail: (e: Error) => void = () => {};
    const confirm = vi.spyOn(api.account, 'confirmEmail');
    confirm.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const first = render(
      <MemoryRouter initialEntries={[link]}>
        <App api={api} initialUserId={null} createPlayer={new FakePlayer().factory} />
      </MemoryRouter>,
    );
    first.unmount();
    finish(true);
    confirm.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const second = render(
      <MemoryRouter initialEntries={[link]}>
        <App api={api} initialUserId={null} createPlayer={new FakePlayer().factory} />
      </MemoryRouter>,
    );
    second.unmount();
    fail(new Error('offline'));
    await act(async () => {});
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

describe('HomeView notices', () => {
  it('a notice lasts until the next song, and is cleared from history', async () => {
    const { api } = renderApp({ path: '/match/m-seed', userId: 'u-demo', mock: { withBots: false, matchEvery: 99 } });
    expect(api).toBeDefined();
    await screen.findByText("This match isn't available any more.");
  });

  it('readNotice reads only a string notice', () => {
    expect(readNotice({ notice: 'hi' })).toBe('hi');
    expect(readNotice({ notice: 3 })).toBeNull();
    expect(readNotice({})).toBeNull();
    expect(readNotice(null)).toBeNull();
    expect(readNotice('text')).toBeNull();
  });

  it('the notice disappears after the next swipe', async () => {
    renderApp({ path: '/home', userId: 'u-demo', mock: { matchEvery: 1 } });
    await userEvent.click(await screen.findByRole('button', { name: 'Skip song' }));
    await screen.findByRole('heading', { name: /^You matched with / });
    await userEvent.click(screen.getByRole('button', { name: /play$/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('You said yes');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip song' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Skip song' }));
    await waitFor(() => expect(screen.queryByText(/You said yes/)).not.toBeInTheDocument());
  });
});

describe('displayName', () => {
  it.each([
    ['sam', 'sam'],
    ['  sam ', 'sam'],
    ['', BLANK_USERNAME_LABEL],
    ['   ', BLANK_USERNAME_LABEL],
  ])('%j -> %s', (username, expected) => {
    expect(displayName({ username })).toBe(expected);
  });
});

describe('sessionStore', () => {
  it('stores and clears the user and token', () => {
    storeSession('u1', 'tok');
    expect(readStoredUserId()).toBe('u1');
    expect(readSessionToken()).toBe('tok');
    clearStoredSession();
    expect(readStoredUserId()).toBeNull();
    expect(readSessionToken()).toBeNull();
  });

  it('keeps the token in memory when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    storeSession('u1', 'tok');
    expect(readSessionToken()).toBe('tok');
    expect(readStoredUserId()).toBeNull();
    clearStoredSession();
    expect(remove).toHaveBeenCalled();
    expect(readSessionToken()).toBeNull();
  });

  it('a rejected session logs the user out', async () => {
    function Probe() {
      return <p>user: {useSession().userId ?? 'none'}</p>;
    }
    const view = render(
      <SessionProvider initialUserId="u1">
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByText('user: u1')).toBeInTheDocument();
    act(() => notifySessionExpired());
    expect(screen.getByText('user: none')).toBeInTheDocument();
    view.unmount();
    expect(() => notifySessionExpired()).not.toThrow();
  });
});

describe('createSimulatedPlayer', () => {
  function setup() {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const player = createSimulatedPlayer(container);
    const states: PlaybackState[] = [];
    player.subscribe((s) => states.push(s));
    return { container, player, states, last: () => states.at(-1)! };
  }

  it('says there is no sound, and removes itself when destroyed', () => {
    const { container, player } = setup();
    expect(container).toHaveTextContent('no sound');
    player.destroy();
    expect(container).toBeEmptyDOMElement();
    container.remove();
  });

  it('R_HOME_05 R_HOME_13 plays from 0 on load, in steps a listener counts as listening', () => {
    const { player, last, states } = setup();
    player.load('spotify:track:x');
    expect(last()).toEqual({ positionSeconds: 0, durationSeconds: DEMO_TRACK_SECONDS, isPaused: false });
    vi.advanceTimersByTime(DEMO_TICK_MS * 4);
    expect(last().positionSeconds).toBe(2);
    expect(states).toHaveLength(5);
    expect(DEMO_TICK_MS / 1000).toBeLessThanOrEqual(1.5);
    player.destroy();
  });

  it('R_HOME_06 R_HOME_08 pauses and resumes from the same position', () => {
    const { player, last } = setup();
    player.load('spotify:track:x');
    vi.advanceTimersByTime(2000);
    player.togglePlay();
    expect(last()).toMatchObject({ positionSeconds: 2, isPaused: true });
    vi.advanceTimersByTime(5000);
    expect(last().positionSeconds).toBe(2);
    player.togglePlay();
    vi.advanceTimersByTime(1000);
    expect(last()).toMatchObject({ positionSeconds: 3, isPaused: false });
    player.destroy();
  });

  it('seek stays within the track', () => {
    const { player, last } = setup();
    player.load('spotify:track:x');
    player.seek(10);
    expect(last().positionSeconds).toBe(10);
    player.seek(-5);
    expect(last().positionSeconds).toBe(0);
    player.seek(999);
    expect(last().positionSeconds).toBe(DEMO_TRACK_SECONDS);
    player.destroy();
  });

  it('stops at the end, and play starts it over', () => {
    const { player, last } = setup();
    player.load('spotify:track:x');
    vi.advanceTimersByTime(DEMO_TRACK_SECONDS * 1000 + 5000);
    expect(last()).toMatchObject({ positionSeconds: DEMO_TRACK_SECONDS, isPaused: true });
    player.togglePlay();
    expect(last()).toMatchObject({ positionSeconds: 0, isPaused: false });
    player.destroy();
  });

  it('unsubscribed listeners get no more updates', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const player = createSimulatedPlayer(container);
    const listener = vi.fn();
    const unsubscribe = player.subscribe(listener);
    unsubscribe();
    player.load('spotify:track:x');
    expect(listener).not.toHaveBeenCalled();
    player.destroy();
  });
});

describe('selectBackend', () => {
  it.each([undefined, '', '   '])('with VITE_API_BASE_URL %j, runs the demo', async (url) => {
    const { api, createPlayer } = await selectBackend(url);
    expect(api.demo).toBeDefined();
    expect(createPlayer).toBe(createSimulatedPlayer);
  });

  it('with a URL, uses the real server, the session token and Spotify', async () => {
    storeSession('u1', 'real-token');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"chats":[]}', { status: 200 }));
    const { api, createPlayer } = await selectBackend(' https://api.test/ ');
    expect(api.demo).toBeUndefined();
    expect(createPlayer).toBe(createSpotifyPlayer);
    await api.chats.getChatLog('u1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.test/chats');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer real-token');
  });

  it('a rejected token on the real server ends the session', async () => {
    const expired = vi.fn();
    window.addEventListener('do-re:session-expired', expired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    storeSession('u1', 'old');
    const { api } = await selectBackend('https://api.test');
    await expect(api.chats.getChatLog('u1')).rejects.toBeDefined();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener('do-re:session-expired', expired);
  });
});

describe('ErrorBoundary', () => {
  function Bomb(): never {
    throw new Error('private detail');
  }

  it('shows a way out instead of a blank page, without logging the error text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    render(
      <ErrorBoundary onReload={reload}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Do~Re page crashed:', 'Error');
  });

  it('renders children normally', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('defaults to reloading the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
