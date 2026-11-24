import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiErrors';
import type { ChatHistory, ChatMessage } from '../api/types';
import { advance, renderChatApp, seededApi, type MockApi } from '../test/renderChat';
import { CHAT_POLL_MS, POLL_OVERLAP_MS } from './chatLogic';

const TEMPO = '/chats/c-seed-tempo';
const SERVER_ERROR = new ApiError('INTERNAL', 'Something went wrong. Try again.', 500);
const AUTH_ERROR = new ApiError('UNAUTHENTICATED', 'Log in again.', 401);
const GONE_ERROR = new ApiError('CHAT_NOT_FOUND', "This chat doesn't exist or was removed.", 404);

async function openChat(api: MockApi = seededApi(), path = TEMPO) {
  renderChatApp(api, path);
  await screen.findByRole('log');
  return api;
}

const textBox = () => screen.getByRole('textbox', { name: /^Message / }) as HTMLInputElement;
const sendButton = () => screen.getByRole('button', { name: 'Send message' });
const reportButton = () => screen.getByRole('button', { name: /^Report chat with/ });
const bubbles = () => [...document.querySelectorAll('.chat__bubble')].map((b) => b.textContent);
const rowOf = (text: string) => screen.getByText(text).closest('li')!;

function expectInOrder(...elements: Element[]) {
  for (let i = 1; i < elements.length; i++) {
    expect(elements[i - 1].compareDocumentPosition(elements[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ChatView opening', () => {
  it('R_CHAT_01 fetches this chat from the ID in the URL, so a refresh works', async () => {
    const api = seededApi();
    const history = vi.spyOn(api.chats, 'getHistory');
    await openChat(api);
    expect(history).toHaveBeenCalledWith('c-seed-tempo', 'u-demo', undefined);
    expect(bubbles()).toHaveLength(6);
    expect(screen.getByText('Any concerts coming up?')).toBeInTheDocument();
  });

  it('shows loading first', async () => {
    renderChatApp(seededApi(), TEMPO);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your chat');
    await screen.findByRole('log');
  });

  it('a chat with no messages invites a first message', async () => {
    const api = seededApi();
    api.backend.chatBackend.openChat('c-new', 'u-melody', 'u-demo');
    await openChat(api, '/chats/c-new');
    expect(screen.getByText('You matched! Say hi to melody.')).toBeInTheDocument();
  });

  it('an unknown chat says so and links back', async () => {
    renderChatApp(seededApi(), '/chats/nope');
    expect(await screen.findByText("This chat doesn't exist or was removed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });

  it("someone else's chat is treated as unavailable", async () => {
    const api = seededApi();
    api.backend.chatBackend.openChat('c-other', 'u-melody', 'u-rhythm');
    renderChatApp(api, '/chats/c-other');
    expect(await screen.findByText("This chat doesn't exist or was removed.")).toBeInTheDocument();
  });

  it('moving between chats shows only the new chat', async () => {
    await openChat();
    await userEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    await userEvent.click(await screen.findByRole('link', { name: /^Chat with lyric/ }));
    expect(await screen.findByRole('heading', { name: 'lyric' })).toBeInTheDocument();
    expect(bubbles()).toHaveLength(2);
  });
});

describe('ChatView header', () => {
  it('R_CHAT_03 R_CHAT_04 R_CHAT_06 R_CHAT_14 back, username, dot, report, left to right', async () => {
    await openChat();
    expectInOrder(
      screen.getByRole('link', { name: 'Back to Messages' }),
      screen.getByRole('heading', { name: 'tempo' }),
      screen.getByRole('img', { name: 'Online' }),
      reportButton(),
    );
  });

  it('R_CHAT_05 back goes to the chat list', async () => {
    await openChat();
    await userEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });

  it('R_CHAT_06 no dot when the other user is offline', async () => {
    await openChat(seededApi(), '/chats/c-seed-lyric');
    expect(screen.queryByRole('img', { name: 'Online' })).not.toBeInTheDocument();
  });

  it('R_CHAT_06 the dot follows presence while the chat is open', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, '/chats/c-seed-lyric');
    await advance();
    expect(screen.queryByRole('img', { name: 'Online' })).not.toBeInTheDocument();
    await api.chats.recordHeartbeat('u-lyric');
    await advance(CHAT_POLL_MS);
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
    await advance(30_000);
    expect(screen.queryByRole('img', { name: 'Online' })).not.toBeInTheDocument();
  });
});

describe('ChatView messages', () => {
  it('R_CHAT_07 R_CHAT_08 the other user\'s messages use the left, grey style', async () => {
    await openChat();
    expect(rowOf('Same, plus a lot of jazz')).toHaveClass('chat__row--other');
    expect(rowOf('Same, plus a lot of jazz')).not.toHaveClass('chat__row--own');
  });

  it('R_CHAT_10 R_CHAT_11 your messages use the right, blue style', async () => {
    await openChat();
    expect(rowOf('You?')).toHaveClass('chat__row--own');
    expect(rowOf('You?')).not.toHaveClass('chat__row--other');
  });

  it('R_CHAT_09 shows each sender\'s picture once per 60-second group', async () => {
    await openChat();
    // tempo: a 30 s pair, then two messages more than 60 s apart; you: one 20 s pair.
    expect(screen.getAllByRole('img', { name: 'No profile picture for tempo' })).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'No profile picture for You' })).toHaveLength(1);
    expect(within(rowOf('What have you been listening to lately?')).queryByRole('img')).toBeNull();
    expect(within(rowOf('Any concerts coming up?')).getByRole('img')).toBeInTheDocument();
  });

  it('labels each message with its sender for screen readers', async () => {
    await openChat();
    expect(rowOf('You?')).toHaveTextContent('You: You?');
    expect(rowOf('Same, plus a lot of jazz')).toHaveTextContent('tempo: Same, plus a lot of jazz');
  });
});

describe('ChatView composer', () => {
  it('R_CHAT_12 R_CHAT_13 the send button is to the right of the text bar', async () => {
    await openChat();
    expectInOrder(textBox(), sendButton());
  });

  it('R_CHAT_13 Enter sends, clears the box and shows the message', async () => {
    const api = await openChat();
    const send = vi.spyOn(api.chats, 'sendMessage');
    await userEvent.type(textBox(), 'see you there{Enter}');
    expect(send).toHaveBeenCalledWith('c-seed-tempo', 'u-demo', 'see you there');
    expect(await screen.findByText('see you there')).toBeInTheDocument();
    expect(textBox().value).toBe('');
    expect(rowOf('see you there')).toHaveClass('chat__row--own');
    expect(textBox()).toHaveFocus();
  });

  it('R_CHAT_13 the send button sends the trimmed text', async () => {
    const api = await openChat();
    const send = vi.spyOn(api.chats, 'sendMessage');
    await userEvent.type(textBox(), '  hello  ');
    await userEvent.click(sendButton());
    expect(send).toHaveBeenCalledWith('c-seed-tempo', 'u-demo', 'hello');
  });

  it.each(['', '   '])('R_CHAT_13 %j does nothing', async (text) => {
    const api = await openChat();
    const send = vi.spyOn(api.chats, 'sendMessage');
    if (text !== '') await userEvent.type(textBox(), text);
    expect(sendButton()).toBeDisabled();
    fireEvent.submit(textBox().closest('form')!);
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks input past the 2000-character limit', async () => {
    await openChat();
    expect(textBox().maxLength).toBe(2000);
  });

  it('while sending, the button is disabled, the text is locked and a second submit is ignored', async () => {
    const api = await openChat();
    let finish: (m: ChatMessage) => void = () => {};
    const send = vi
      .spyOn(api.chats, 'sendMessage')
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.type(textBox(), 'slow{Enter}');
    expect(sendButton()).toBeDisabled();
    expect(textBox().readOnly).toBe(true);
    fireEvent.submit(textBox().closest('form')!);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ messageId: 'x', senderId: 'u-demo', text: 'slow', timestamp: new Date().toISOString() });
    expect(await screen.findByText('slow')).toBeInTheDocument();
    expect(textBox().readOnly).toBe(false);
  });

  it('a failed send keeps the text and says what to do, and the next try clears the error', async () => {
    const api = await openChat();
    vi.spyOn(api.chats, 'sendMessage').mockRejectedValueOnce(SERVER_ERROR);
    await userEvent.type(textBox(), 'important{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(textBox().value).toBe('important');
    await userEvent.click(sendButton());
    expect(await screen.findByText('important')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('an expired session while sending goes to login', async () => {
    const api = await openChat();
    vi.spyOn(api.chats, 'sendMessage').mockRejectedValueOnce(AUTH_ERROR);
    await userEvent.type(textBox(), 'hi{Enter}');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('a chat removed elsewhere shows as unavailable when sending', async () => {
    const api = await openChat();
    vi.spyOn(api.chats, 'sendMessage').mockRejectedValueOnce(GONE_ERROR);
    await userEvent.type(textBox(), 'hi{Enter}');
    expect(await screen.findByText("This chat doesn't exist or was removed.")).toBeInTheDocument();
  });

  it('a reply arriving after leaving the chat does nothing', async () => {
    const api = await openChat();
    let finish: (m: ChatMessage) => void = () => {};
    vi.spyOn(api.chats, 'sendMessage').mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.type(textBox(), 'bye{Enter}');
    await userEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    finish({ messageId: 'x', senderId: 'u-demo', text: 'bye', timestamp: new Date().toISOString() });
    expect(await screen.findByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });
});

describe('ChatView report', () => {
  async function openReport(api?: MockApi) {
    const opened = await openChat(api);
    await userEvent.click(reportButton());
    return { api: opened, dialog: within(screen.getByRole('dialog', { name: 'Report tempo?' })) };
  }

  it('R_CHAT_15 R_CHAT_16 reporting flags the chat and returns to a list without it', async () => {
    const { api, dialog } = await openReport();
    await userEvent.click(dialog.getByRole('button', { name: 'Report' }));
    expect(await screen.findByRole('heading', { name: 'Messages' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^Chat with lyric/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Chat with tempo/ })).not.toBeInTheDocument();
    expect(api.backend.chatBackend.isFlagged('c-seed-tempo')).toBe(true);
  });

  it('Cancel does not report, and focus returns to the report button', async () => {
    const { api, dialog } = await openReport();
    const report = vi.spyOn(api.chats, 'reportChat');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(report).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reportButton()).toHaveFocus();
  });

  it('Escape closes the popup', async () => {
    await openReport();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a failure stays on the chat and says what to do; closing clears it', async () => {
    const api = seededApi();
    vi.spyOn(api.chats, 'reportChat').mockRejectedValueOnce(SERVER_ERROR);
    const { dialog } = await openReport(api);
    await userEvent.click(dialog.getByRole('button', { name: 'Report' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(reportButton());
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
    expect(api.backend.chatBackend.isFlagged('c-seed-tempo')).toBe(false);
  });

  it('while reporting, buttons are disabled and Escape is ignored', async () => {
    const api = seededApi();
    let finish: () => void = () => {};
    const report = vi
      .spyOn(api.chats, 'reportChat')
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const { dialog } = await openReport(api);
    const confirm = dialog.getByRole('button', { name: 'Report' });
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(report).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });

  it('an expired session while reporting goes to login', async () => {
    const api = seededApi();
    vi.spyOn(api.chats, 'reportChat').mockRejectedValueOnce(AUTH_ERROR);
    const { dialog } = await openReport(api);
    await userEvent.click(dialog.getByRole('button', { name: 'Report' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('ChatView polling', () => {
  it('fetches every 3 s and shows new messages from the other user', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    api.backend.chatBackend.deliver('c-seed-tempo', 'u-tempo', 'are you there?');
    await advance(CHAT_POLL_MS - 1);
    expect(screen.queryByText('are you there?')).not.toBeInTheDocument();
    await advance(1);
    expect(screen.getByText('are you there?')).toBeInTheDocument();
  });

  it('asks for recent history with an overlap and never shows a message twice', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-23T12:00:00.000Z') });
    const api = seededApi();
    const history = vi.spyOn(api.chats, 'getHistory');
    renderChatApp(api, TEMPO);
    await advance();
    api.backend.chatBackend.deliver('c-seed-tempo', 'u-tempo', 'just once');
    await advance(CHAT_POLL_MS);
    await advance(CHAT_POLL_MS);
    expect(history.mock.calls[1][2]).toBe(new Date(Date.parse('2026-11-23T12:00:00.000Z') - POLL_OVERLAP_MS).toISOString());
    expect(screen.getAllByText('just once')).toHaveLength(1);
  });

  it('does not lose a message saved just after the previous poll read', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-23T12:00:00.000Z') });
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    // Stamped before that poll's serverTime, but only visible to the next poll.
    api.backend.chatBackend.deliver('c-seed-tempo', 'u-tempo', 'late write', Date.now() - 1000);
    await advance(CHAT_POLL_MS);
    expect(screen.getByText('late write')).toBeInTheDocument();
  });

  it('stops polling when leaving the chat', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    const history = vi.spyOn(api.chats, 'getHistory');
    renderChatApp(api, TEMPO);
    await advance();
    fireEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    await advance();
    const calls = history.mock.calls.length;
    await advance(CHAT_POLL_MS * 5);
    expect(history.mock.calls.length).toBe(calls);
  });

  it('ignores a reply or failure that arrives after leaving', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    let finish: (h: ChatHistory) => void = () => {};
    let fail: (e: Error) => void = () => {};
    vi.spyOn(api.chats, 'getHistory').mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    await advance(CHAT_POLL_MS);
    fireEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    await advance();
    fail(AUTH_ERROR);
    finish({ chatId: 'x', otherUser: { userId: 'u', username: 'u', profilePictureUrl: null }, otherUserOnline: false, messages: [], serverTime: new Date().toISOString() });
    await advance();
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });

  it('ignores a successful reply that arrives after leaving', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    let finish: (h: ChatHistory) => void = () => {};
    vi.spyOn(api.chats, 'getHistory').mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await advance(CHAT_POLL_MS);
    fireEvent.click(screen.getByRole('link', { name: 'Back to Messages' }));
    await advance();
    finish({ chatId: 'x', otherUser: { userId: 'u', username: 'u', profilePictureUrl: null }, otherUserOnline: false, messages: [], serverTime: new Date().toISOString() });
    await advance();
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });

  it('a failed poll keeps the messages, says so, and recovers', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    vi.spyOn(api.chats, 'getHistory').mockRejectedValueOnce(SERVER_ERROR);
    await advance(CHAT_POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach the server");
    expect(bubbles()).toHaveLength(6);
    await advance(CHAT_POLL_MS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a failed first load says so and keeps trying', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    vi.spyOn(api.chats, 'getHistory').mockRejectedValueOnce(SERVER_ERROR);
    renderChatApp(api, TEMPO);
    await advance();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this chat");
    await advance(CHAT_POLL_MS);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('loads your profile only once', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    const profile = vi.spyOn(api.account, 'getProfile');
    renderChatApp(api, TEMPO);
    await advance();
    await advance(CHAT_POLL_MS);
    await advance(CHAT_POLL_MS);
    expect(profile.mock.calls.filter(([id]) => id === 'u-demo')).toHaveLength(1);
  });

  it('a chat that disappears mid-poll shows as unavailable and polling stops', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    const history = vi.spyOn(api.chats, 'getHistory').mockRejectedValue(GONE_ERROR);
    await advance(CHAT_POLL_MS);
    expect(screen.getByText("This chat doesn't exist or was removed.")).toBeInTheDocument();
    await advance(CHAT_POLL_MS * 3);
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('an expired session mid-poll goes to login and polling stops', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    const history = vi.spyOn(api.chats, 'getHistory').mockRejectedValue(AUTH_ERROR);
    await advance(CHAT_POLL_MS);
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    await advance(CHAT_POLL_MS * 3);
    expect(history).toHaveBeenCalledTimes(1);
  });
});

describe('ChatView scrolling', () => {
  function fakeScroll(log: HTMLElement, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: clientHeight });
  }

  it('follows new messages when at the bottom', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    const log = screen.getByRole('log');
    fakeScroll(log, 1000, 400);
    log.scrollTop = 600;
    fireEvent.scroll(log);
    fakeScroll(log, 1100, 400);
    api.backend.chatBackend.deliver('c-seed-tempo', 'u-tempo', 'new');
    await advance(CHAT_POLL_MS);
    expect(log.scrollTop).toBe(1100);
  });

  it('stays put when the user scrolled up to read, until they send', async () => {
    vi.useFakeTimers();
    const api = seededApi();
    renderChatApp(api, TEMPO);
    await advance();
    const log = screen.getByRole('log');
    fakeScroll(log, 1000, 400);
    log.scrollTop = 100;
    fireEvent.scroll(log);
    fakeScroll(log, 1100, 400);
    api.backend.chatBackend.deliver('c-seed-tempo', 'u-tempo', 'new');
    await advance(CHAT_POLL_MS);
    expect(log.scrollTop).toBe(100);

    fireEvent.change(textBox(), { target: { value: 'mine' } });
    fireEvent.submit(textBox().closest('form')!);
    await advance();
    expect(log.scrollTop).toBe(1100);
  });
});
