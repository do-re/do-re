import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../api/mock';
import { SEED_SONGS } from '../api/mockSeed';
import { renderApp } from '../test/renderApp';
import { sequence } from '../test/sequence';
import { formatPercent } from './matchLogic';

/** Opens the seeded match (demo ↔ harmony, 87.4%, harmony already said yes). */
async function openSeededMatch() {
  const rendered = renderApp({ path: '/match/m-seed', userId: 'u-demo', mock: { withPendingMatch: true } });
  await screen.findByRole('heading', { name: 'You matched with harmony!' });
  return rendered;
}

/** Opens Home with a match on every swipe (first melody, then rhythm), skips once, waits for it. */
async function openFreshMatch() {
  const rendered = renderApp({ path: '/home', userId: 'u-demo', mock: { matchEvery: 1, random: sequence(0, 0, 0.9, 0) } });
  await screen.findByRole('heading', { name: SEED_SONGS[0].title });
  await userEvent.click(screen.getByRole('button', { name: 'Skip song' }));
  await screen.findByRole('heading', { name: 'You matched with melody!' });
  return rendered;
}

const skipMatch = () => screen.getByRole('button', { name: /skip$/i });
const playMatch = () => screen.getByRole('button', { name: /play$/i });

describe('MatchView display', () => {
  it('R_HOME_20 R_HOME_21 shows who matched, both pictures, the percentage and both choices', async () => {
    await openSeededMatch();
    expect(screen.getByText('87.4% match!')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'No profile picture for You' })).toHaveTextContent('D');
    expect(screen.getByRole('img', { name: 'No profile picture for harmony' })).toHaveTextContent('H');
    const choices = screen.getByRole('group', { name: 'Skip or play this match?' });
    expect(within(choices).getAllByRole('button')).toHaveLength(2);
    expect(skipMatch()).toBeEnabled();
    expect(playMatch()).toBeEnabled();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('shows profile pictures when users have them', async () => {
    const other = vi.spyOn(MockBackend.prototype, 'getOtherProfile').mockResolvedValueOnce({
      userId: 'u-harmony',
      username: 'harmony',
      profilePictureUrl: 'data:image/png;base64,AAAA',
    });
    try {
      await openSeededMatch();
      expect(screen.getByRole('img', { name: 'Profile picture of harmony' })).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA',
      );
    } finally {
      other.mockRestore();
    }
  });

  it('shows a loading message first', () => {
    renderApp({ path: '/match/m-seed', userId: 'u-demo', mock: { withPendingMatch: true } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading your match…');
  });

  it.each([
    ['an unknown match', '/match/nope', 'u-demo', false],
    ["someone else's match", '/match/m-seed', 'u-melody', true],
  ])('%s says it is not available and links back to songs', async (_, path, userId, withPendingMatch) => {
    renderApp({ path, userId, mock: { withPendingMatch } });
    expect(await screen.findByText("This match isn't available any more.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to songs' }));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('if loading fails, says so and offers to try again', async () => {
    const get = vi.spyOn(MockBackend.prototype, 'getMatch').mockRejectedValueOnce(new Error('offline'));
    try {
      renderApp({ path: '/match/m-seed', userId: 'u-demo', mock: { withPendingMatch: true } });
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this match");
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: 'You matched with harmony!' })).toBeInTheDocument();
    } finally {
      get.mockRestore();
    }
  });
});

describe('MatchView answers', () => {
  it('R_HOME_23 confirming when the other user already confirmed opens the chat', async () => {
    const { api } = await openSeededMatch();
    const confirm = vi.spyOn(api.matches, 'confirmMatch');
    await userEvent.click(playMatch());
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const chatId = await confirm.mock.results[0].value;
    expect(chatId).not.toBeNull();
    expect(screen.getByText(`Chat ${chatId} will open here.`)).toBeInTheDocument();
  });

  it('R_HOME_23 confirming first goes home and says the chat will appear once they say yes (OPEN-4)', async () => {
    const { api } = await openFreshMatch();
    await userEvent.click(playMatch());
    expect(await screen.findByRole('heading', { name: SEED_SONGS[1].title })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'You said yes to melody! Your chat will appear in Messages once they say yes too.',
    );
    expect(await api.matches.getPendingMatches('u-demo')).toEqual([]);
    expect(await api.matches.getPendingMatches('u-melody')).toHaveLength(1);
  });

  it('R_HOME_21 R_HOME_22 declining goes home, and swiping goes on to offer new matches', async () => {
    const { api } = await openFreshMatch();
    await userEvent.click(skipMatch());
    expect(await screen.findByRole('heading', { name: SEED_SONGS[1].title })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(await api.matches.getPendingMatches('u-melody')).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Skip song' }));
    expect(await screen.findByRole('heading', { name: 'You matched with rhythm!' })).toBeInTheDocument();
  });

  it('disables both buttons while the answer is being saved, so it is sent once', async () => {
    const { api } = await openSeededMatch();
    let finish!: () => void;
    const decline = vi
      .spyOn(api.matches, 'declineMatch')
      .mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await userEvent.click(skipMatch());
    expect(skipMatch()).toBeDisabled();
    expect(playMatch()).toBeDisabled();
    await userEvent.click(playMatch());
    expect(decline).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it.each([
    ['confirming', 'confirmMatch', playMatch],
    ['declining', 'declineMatch', skipMatch],
  ] as const)('if %s fails, stays on the match and says to try again', async (_, method, button) => {
    const { api } = await openSeededMatch();
    vi.spyOn(api.matches, method).mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your answer");
    expect(button()).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'You matched with harmony!' })).toBeInTheDocument();
  });
});

describe('formatPercent', () => {
  it.each([
    [87.4, '87.4%'],
    [33.333, '33.3%'],
    [0, '0.0%'],
    [100, '100.0%'],
    [-5, '0.0%'],
    [150, '100.0%'],
    [Number.NaN, '0.0%'],
  ])('R_HOME_18 %s -> %s', (percent, text) => {
    expect(formatPercent(percent)).toBe(text);
  });
});
