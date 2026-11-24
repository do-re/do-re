import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiErrors';
import type { ChatSummary } from '../api/types';
import { advance, renderChatApp, seededApi } from '../test/renderChat';
import { LOG_POLL_MS } from './chatLogic';

const SERVER_ERROR = new ApiError('INTERNAL', 'Something went wrong. Try again.', 500);
const AUTH_ERROR = new ApiError('UNAUTHENTICATED', 'Log in again.', 401);

async function openLog(api = seededApi()) {
  renderChatApp(api, '/chats');
  await screen.findByRole('link', { name: /^Chat with tempo/ });
  return api;
}

function rowNames() {
  return screen.queryAllByRole('link', { name: /^Chat with / }).map((l) => l.querySelector('.chat-log__name')!.textContent);
}

async function openRemoval(name = 'tempo') {
  await userEvent.click(screen.getByRole('button', { name: `Remove chat with ${name}` }));
  return within(screen.getByRole('dialog', { name: `Remove chat with ${name}?` }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MessageLogView', () => {
  it('R_CHAT_02 lists chats with the most recent activity first', async () => {
    await openLog();
    expect(rowNames()).toEqual(['tempo', 'lyric']);
  });

  it('shows a picture placeholder, the username and a preview on each row', async () => {
    await openLog();
    const row = screen.getByRole('link', { name: /^Chat with lyric/ });
    expect(within(row).getByRole('img', { name: 'No profile picture for lyric' })).toBeInTheDocument();
    expect(row).toHaveTextContent('You: Thanks, you too');
  });

  it('shows the picture when the user has one', async () => {
    const api = seededApi();
    const real = api.chats.getChatLog.bind(api.chats);
    vi.spyOn(api.chats, 'getChatLog').mockImplementation(async (id) =>
      (await real(id)).map((c) => ({
        ...c,
        otherUser: { ...c.otherUser, profilePictureUrl: 'data:image/png;base64,AA==' },
      })),
    );
    await openLog(api);
    expect(screen.getByRole('img', { name: 'Profile picture of tempo' })).toBeInTheDocument();
  });

  it('R_CHAT_01 pressing a row opens that chat', async () => {
    await openLog();
    await userEvent.click(screen.getByRole('link', { name: /^Chat with tempo/ }));
    expect(await screen.findByRole('heading', { name: 'tempo' })).toBeInTheDocument();
    expect(screen.getByText('Any concerts coming up?')).toBeInTheDocument();
  });

  it('shows an empty state with a way back to songs', async () => {
    const api = seededApi({ withSeedChats: false });
    renderChatApp(api, '/chats');
    expect(await screen.findByText('No chats yet. Keep swiping to find a match.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to songs' }));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('shows loading first', async () => {
    renderChatApp(seededApi(), '/chats');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your chats');
    await screen.findByRole('link', { name: /^Chat with tempo/ });
  });
});

describe('MessageLogView remove', () => {
  it('removes the row after confirming, and moves focus to the heading', async () => {
    const api = await openLog();
    const dialog = await openRemoval();
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    expect(rowNames()).toEqual(['lyric']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Messages' })).toHaveFocus();
    expect((await api.chats.getChatLog('u-demo')).map((c) => c.otherUser.username)).toEqual(['lyric']);
    expect((await api.chats.getChatLog('u-tempo')).length).toBe(1);
  });

  it('Cancel keeps the chat and returns focus to its button', async () => {
    const api = await openLog();
    const remove = vi.spyOn(api.chats, 'removeChatFromLog');
    const dialog = await openRemoval();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove chat with tempo' })).toHaveFocus();
  });

  it('Escape closes the popup', async () => {
    await openLog();
    await openRemoval();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['tempo', 'lyric']);
  });

  it('a failure keeps the row and popup and says what to do; closing clears it', async () => {
    const api = await openLog();
    vi.spyOn(api.chats, 'removeChatFromLog').mockRejectedValueOnce(SERVER_ERROR);
    let dialog = await openRemoval();
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(rowNames()).toEqual(['tempo', 'lyric']);
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    dialog = await openRemoval();
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the buttons and ignores Escape while removing', async () => {
    const api = await openLog();
    let finish: () => void = () => {};
    const remove = vi
      .spyOn(api.chats, 'removeChatFromLog')
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const dialog = await openRemoval();
    const confirm = dialog.getByRole('button', { name: 'Remove' });
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(remove).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('an expired session during remove goes to login', async () => {
    const api = await openLog();
    vi.spyOn(api.chats, 'removeChatFromLog').mockRejectedValueOnce(AUTH_ERROR);
    const dialog = await openRemoval();
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('a refresh that started before the removal cannot bring the row back', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    const stale = await api.chats.getChatLog('u-demo');
    renderChatApp(api, '/chats');
    await advance();

    let finishRefresh: (chats: ChatSummary[]) => void = () => {};
    const log = vi
      .spyOn(api.chats, 'getChatLog')
      .mockImplementationOnce(() => new Promise((resolve) => (finishRefresh = resolve)));
    await advance(LOG_POLL_MS);
    expect(log).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove chat with tempo' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await advance();
    expect(rowNames()).toEqual(['lyric']);

    finishRefresh(stale);
    await advance();
    expect(rowNames()).toEqual(['lyric']);
  });
});

describe('MessageLogView refresh', () => {
  it('Y-6 a chat that appears later shows up without reloading', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, '/chats');
    await advance();
    expect(rowNames()).toEqual(['tempo', 'lyric']);
    api.backend.chatBackend.openChat('c-new', 'u-melody', 'u-demo');
    await advance(LOG_POLL_MS);
    expect(rowNames()).toEqual(['melody', 'tempo', 'lyric']);
  });

  it('R_CHAT_02 a new message moves its chat to the top', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, '/chats');
    await advance();
    api.backend.chatBackend.deliver('c-seed-lyric', 'u-lyric', 'back again');
    await advance(LOG_POLL_MS);
    expect(rowNames()).toEqual(['lyric', 'tempo']);
  });

  it('a failed refresh keeps the list, says so, and recovers', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, '/chats');
    await advance();
    vi.spyOn(api.chats, 'getChatLog').mockRejectedValueOnce(SERVER_ERROR);
    await advance(LOG_POLL_MS);
    expect(rowNames()).toEqual(['tempo', 'lyric']);
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach the server");
    await advance(LOG_POLL_MS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a failed first load says so and keeps trying', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    vi.spyOn(api.chats, 'getChatLog').mockRejectedValueOnce(SERVER_ERROR);
    renderChatApp(api, '/chats');
    await advance();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your chats");
    await advance(LOG_POLL_MS);
    expect(rowNames()).toEqual(['tempo', 'lyric']);
  });

  it('an expired session during refresh goes to login and stops polling', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    const log = vi.spyOn(api.chats, 'getChatLog').mockRejectedValue(AUTH_ERROR);
    renderChatApp(api, '/chats');
    await advance();
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    const calls = log.mock.calls.length;
    await advance(LOG_POLL_MS * 3);
    expect(log.mock.calls.length).toBe(calls);
  });

  it('stops refreshing after leaving the page, and ignores a late failure', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, '/chats');
    await advance();
    let failRefresh: (e: Error) => void = () => {};
    const log = vi
      .spyOn(api.chats, 'getChatLog')
      .mockImplementationOnce(() => new Promise((_, reject) => (failRefresh = reject)));
    await advance(LOG_POLL_MS);
    fireEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await advance();
    failRefresh(AUTH_ERROR);
    await advance(LOG_POLL_MS * 3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });
});
