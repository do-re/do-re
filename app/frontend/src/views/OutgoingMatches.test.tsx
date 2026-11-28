/**
 * "Waiting for an answer" on the Messages page: matches the user said yes to, and taking a yes
 * back after confirming (an extra with no requirement ID; relates to R-HOME-21, R-HOME-22).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiErrors';
import { MockBackend } from '../api/mock';
import { renderChatApp, seededApi } from '../test/renderChat';

const DEMO = 'u-demo';

/** A demo backend where demo has said yes to melody (and, optionally, harmony) and waits. */
function waitingApi(alsoHarmony = false) {
  const api = seededApi();
  api.backend.matchModel.addMatch({ matchId: 'm-out-1', userA: 'u-melody', userB: DEMO, compatibilityPercent: 81.25 }, [DEMO]);
  if (alsoHarmony) {
    api.backend.matchModel.addMatch({ matchId: 'm-out-2', userA: DEMO, userB: 'u-rhythm', compatibilityPercent: 93 }, [DEMO]);
  }
  return api;
}
const section = () => screen.findByRole('region', { name: 'Waiting for an answer' });
const takeBack = (name: string) => screen.getByRole('button', { name: `Take back your yes to ${name}` });

describe('Waiting for an answer', () => {
  it('is not shown when the user is not waiting on anyone', async () => {
    renderChatApp(seededApi(), '/chats');
    await screen.findByRole('link', { name: /^Chat with tempo/ });
    expect(screen.queryByRole('region', { name: 'Waiting for an answer' })).not.toBeInTheDocument();
  });

  it('lists the matches the user said yes to, best match first, under the chats', async () => {
    renderChatApp(waitingApi(true), '/chats');
    const rows = within(await section()).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.chat-log__name')!.textContent)).toEqual(['rhythm', 'melody']);
    expect(rows[0]).toHaveTextContent('93.0% match · waiting');
    expect(rows[1]).toHaveTextContent('81.3% match · waiting');
    expect(screen.getByRole('link', { name: /^Chat with tempo/ })).toBeInTheDocument(); // the chats are still there
  });

  it('R_HOME_22_takesBackAYesOnlyAfterTheUserConfirms', async () => {
    const api = waitingApi();
    const retract = vi.spyOn(api.matches, 'retractMatch');
    renderChatApp(api, '/chats');
    await section();
    await userEvent.click(takeBack('melody'));
    const dialog = screen.getByRole('dialog', { name: 'Take back your yes to melody?' });
    expect(dialog).toHaveTextContent("you won't be matched with them again");
    expect(retract).not.toHaveBeenCalled(); // nothing happens until the user confirms

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(retract).not.toHaveBeenCalled();
    expect(takeBack('melody')).toBeInTheDocument();

    await userEvent.click(takeBack('melody'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Waiting for an answer' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Messages' })).toHaveFocus();
    expect(retract).toHaveBeenCalledOnce();
    // the other person no longer sees the match, and it is gone for good
    expect(await api.matches.getPendingMatches('u-melody')).toEqual([]);
    expect(await api.matches.getOutgoingMatches(DEMO)).toEqual([]);
  });

  it('closes on Escape without taking anything back', async () => {
    const api = waitingApi();
    renderChatApp(api, '/chats');
    await section();
    await userEvent.click(takeBack('melody'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await api.matches.getOutgoingMatches(DEMO)).toHaveLength(1);
  });

  it('says so when the other person answered first', async () => {
    const api = waitingApi();
    renderChatApp(api, '/chats');
    await section();
    await userEvent.click(takeBack('melody'));
    api.backend.matchModel.recordDecision('m-out-1', 'u-melody', true); // melody says yes meanwhile
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take back' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("melody has already answered, so this can't be taken back");
    expect(within(dialog).queryByRole('button', { name: 'Take back' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Waiting for an answer' })).not.toBeInTheDocument();
  });

  it('keeps the popup open and says what to do when the server cannot be reached', async () => {
    const api = waitingApi();
    vi.spyOn(api.matches, 'retractMatch').mockRejectedValueOnce(new ApiError('NETWORK_ERROR', "Can't reach the server. Check your connection and try again.", 0));
    renderChatApp(api, '/chats');
    await section();
    await userEvent.click(takeBack('melody'));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take back' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Can't reach the server");
    expect(within(dialog).getByRole('button', { name: 'Take back' })).toBeEnabled(); // can try again
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('still shows the chats if the waiting list cannot be read', async () => {
    const api = waitingApi();
    const list = vi.spyOn(api.matches, 'getOutgoingMatches').mockRejectedValueOnce(new Error('offline'));
    renderChatApp(api, '/chats');
    await screen.findByRole('link', { name: /^Chat with tempo/ });
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Waiting for an answer' })).not.toBeInTheDocument();
  });

  it('security_logsOutWhenTheSessionHasEnded', async () => {
    const api = waitingApi();
    vi.spyOn(api.matches, 'retractMatch').mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 'Log in again.', 401));
    renderChatApp(api, '/chats');
    await section();
    await userEvent.click(takeBack('melody'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take back' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('the demo backend follows the same rule', () => {
  it('only a yes that is still waiting can be taken back', async () => {
    const backend = new MockBackend();
    backend.matchModel.addMatch({ matchId: 'm1', userA: 'u-melody', userB: DEMO, compatibilityPercent: 80 }, []);
    const match = backend.matchModel.matchById('m1');
    await expect(backend.retractMatch(match, DEMO)).rejects.toMatchObject({ status: 409 }); // not confirmed yet
    await backend.confirmMatch(match, DEMO);
    expect(await backend.getOutgoingMatches(DEMO)).toMatchObject([{ match: { matchId: 'm1' }, otherUser: { userId: 'u-melody' } }]);
    expect(await backend.getOutgoingMatches('u-melody')).toEqual([]);
    await backend.retractMatch(match, DEMO);
    await expect(backend.retractMatch(match, DEMO)).rejects.toMatchObject({ status: 409 }); // already taken back
    expect(await backend.getPendingMatches('u-melody')).toEqual([]);
  });
});
