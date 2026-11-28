/**
 * A user who is matched by someone else must see it (R-HOME-20): a badge on the Home tab on every
 * page, and a banner on Home, kept up to date while the app is open.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Match } from '../api/types';
import { installBrowser, uninstallBrowser } from '../test/fakePush';
import { renderApp } from '../test/renderApp';
import { PENDING_POLL_MS } from './pendingMatchesContext';

afterEach(() => {
  vi.useRealTimers();
  uninstallBrowser();
});

const DEMO = 'u-demo';
const homeTab = () => within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' });
const banner = () => screen.queryByRole('complementary', { name: 'New match' });
/** Another user's swipe matches them with demo: what the server does, without demo doing anything. */
const matchFromSomeoneElse = (api: ReturnType<typeof renderApp>['api'], other = 'u-melody', matchId = 'm-new'): Match => {
  const match = { matchId, userA: other, userB: DEMO, compatibilityPercent: 91.2 };
  api.backend.matchModel.addMatch(match, []);
  return match;
};

describe('pending matches are shown wherever the user is', () => {
  it('R_HOME_20_showsNoBadgeOrBannerWithoutAMatch', async () => {
    renderApp({ path: '/profile', userId: DEMO });
    await screen.findByRole('heading', { name: 'Profile' });
    expect(homeTab()).not.toHaveAttribute('data-badge');
    expect(homeTab()).not.toHaveAccessibleDescription();
    expect(banner()).not.toBeInTheDocument();
  });

  it('R_HOME_20_aMatchWaitingAtLoginShowsABadgeOnEveryPage', async () => {
    renderApp({ path: '/profile', userId: DEMO, mock: { withPendingMatch: true } });
    await waitFor(() => expect(homeTab()).toHaveAttribute('data-badge', '1'));
    expect(homeTab()).toHaveAccessibleDescription('1 new match');
    expect(homeTab()).toHaveTextContent(/^Home$/); // the badge is drawn by CSS, the name stays "Home"
    await userEvent.click(screen.getByRole('link', { name: 'Messages' }));
    await screen.findByRole('heading', { name: 'Messages' });
    expect(homeTab()).toHaveAttribute('data-badge', '1');
  });

  it('R_HOME_20_aMatchMadeBySomeoneElseAppearsWhileTheUserIsOnHome', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = renderApp({ path: '/home', userId: DEMO });
    await screen.findByRole('heading', { name: 'Home' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip song' })).toBeInTheDocument());
    expect(banner()).not.toBeInTheDocument();

    const match = matchFromSomeoneElse(api);
    await act(() => vi.advanceTimersByTimeAsync(PENDING_POLL_MS));
    await waitFor(() => expect(banner()).toBeInTheDocument());
    expect(banner()).toHaveTextContent('You have a new match!');
    expect(homeTab()).toHaveAttribute('data-badge', '1');
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument(); // the song is not interrupted

    vi.useRealTimers();
    await userEvent.click(within(banner()!).getByRole('link', { name: 'See match' }));
    expect(await screen.findByRole('heading', { name: /You matched with melody/ })).toBeInTheDocument();
    expect(match.matchId).toBe('m-new');
  });

  it('R_HOME_21_theBadgeAndBannerGoAwayOnceTheMatchIsAnswered', async () => {
    renderApp({ path: '/profile', userId: DEMO, mock: { withPendingMatch: true } });
    await waitFor(() => expect(homeTab()).toHaveAttribute('data-badge', '1'));
    await userEvent.click(homeTab());
    // Home opens the match by itself the first time
    expect(await screen.findByRole('heading', { name: /You matched with/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Skip/ }));
    await screen.findByRole('heading', { name: 'Home' });
    await waitFor(() => expect(homeTab()).not.toHaveAttribute('data-badge'));
    expect(banner()).not.toBeInTheDocument();
  });

  it('R_HOME_20_aMatchLeftUnansweredStaysVisibleAsABannerAndCountsSeveral', async () => {
    const { api } = renderApp({ path: '/home', userId: DEMO, mock: { withPendingMatch: true } });
    expect(await screen.findByRole('heading', { name: /You matched with/ })).toBeInTheDocument();
    matchFromSomeoneElse(api);
    await userEvent.click(homeTab()); // leave without answering
    // the second match has not been shown yet, so Home opens it once
    expect(await screen.findByRole('heading', { name: /You matched with melody/ })).toBeInTheDocument();
    await userEvent.click(homeTab()); // leave that one unanswered too
    await screen.findByRole('heading', { name: 'Home' });
    await waitFor(() => expect(banner()).toHaveTextContent('You have 2 new matches!'));
    expect(homeTab()).toHaveAttribute('data-badge', '2');
    expect(homeTab()).toHaveAccessibleDescription('2 new matches');
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument(); // not opened by itself again
  });

  it('refreshes at once when a push notification arrives', async () => {
    const browser = installBrowser({ permission: 'granted' });
    const { api } = renderApp({ path: '/profile', userId: DEMO });
    await screen.findByRole('heading', { name: 'Profile' });
    matchFromSomeoneElse(api);
    browser.post({ type: 'something-else' });
    expect(homeTab()).not.toHaveAttribute('data-badge');
    browser.post({ type: 'do-re:push' });
    await waitFor(() => expect(homeTab()).toHaveAttribute('data-badge', '1'));
  });

  it('keeps the last list when a refresh fails, and shows nothing when logged out', async () => {
    const { api } = renderApp({ path: '/profile', userId: DEMO, mock: { withPendingMatch: true } });
    await waitFor(() => expect(homeTab()).toHaveAttribute('data-badge', '1'));
    vi.spyOn(api.matches, 'getPendingMatches').mockRejectedValue(new Error('offline'));
    await userEvent.click(screen.getByRole('link', { name: 'Messages' }));
    await screen.findByRole('heading', { name: 'Messages' });
    expect(homeTab()).toHaveAttribute('data-badge', '1');
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
