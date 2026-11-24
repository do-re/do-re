/**
 * ChatView: the /chats/:chatId page (architecture-stubs-v2.java ChatView; layout from the UI
 * sketch). Header: back, username, green online dot, report, left to right. The other user's
 * messages are on the left in grey and yours on the right in blue (OPEN-8), each sender's picture
 * shown once per group of messages sent within 60 s. A rounded text bar and send button sit at
 * the bottom. While open, the page polls history every 3 s; that call is also the heartbeat.
 *
 * Satisfies: R-CHAT-01, R-CHAT-03 to R-CHAT-15.
 * Communicates with: ChatController (via useApi()), ViewController (via the router).
 */
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { displayName } from '../api/profile';
import { MAX_MESSAGE_LENGTH, type ChatMessage, type UserProfile } from '../api/types';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './chat.css';
import {
  CHAT_POLL_MS,
  describeChatError,
  isChatGone,
  isSessionExpired,
  mergeMessages,
  nextSince,
  normalizeDraft,
  startsNewGroup,
} from './chatLogic';
import { usePolling, type PollResult } from './usePolling';

type ChatState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed' }
  | {
      kind: 'ready';
      self: UserProfile;
      other: UserProfile;
      online: boolean;
      messages: readonly ChatMessage[];
      connectionLost: boolean;
    };

/** Within this many pixels of the bottom, new messages keep the view scrolled down. */
const STICK_TO_BOTTOM_PX = 80;

/**
 * The /chats/:chatId page.
 * Requires: rendered inside ApiProvider, SessionProvider (with a logged-in user) and a router
 *           whose route has a :chatId parameter.
 * Effects: opens the chat from the ID in the URL alone, so a refresh works (notes-for-yara Y-6).
 */
export function ChatView() {
  const chatId = useParams<{ chatId: string }>().chatId!;
  // A new chat ID starts a fresh page, so one chat's messages never show under another's URL.
  return <ChatPage key={chatId} chatId={chatId} />;
}

function ChatPage({ chatId }: { chatId: string }) {
  const api = useApi();
  const session = useSession();
  const userId = session.userId!;
  const navigate = useNavigate();
  const inputId = useId();

  const [chat, setChat] = useState<ChatState>({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const sinceRef = useRef<string | undefined>(undefined);
  const selfRef = useRef<UserProfile | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);

  /** Effects: reacts to a failed poll; returns whether polling should go on. */
  function handlePollFailure(error: unknown): PollResult {
    if (isSessionExpired(error)) {
      session.logOut();
      return 'stop';
    }
    if (isChatGone(error)) {
      setChat({ kind: 'missing' });
      return 'stop';
    }
    setChat((prev) => (prev.kind === 'ready' ? { ...prev, connectionLost: true } : { kind: 'failed' }));
    return 'continue';
  }

  // Stub openChat, then the 3 s poll. Stops on unmount.
  usePolling(async (isActive) => {
    try {
      const [history, self] = await Promise.all([
        api.chats.getHistory(chatId, userId, sinceRef.current),
        selfRef.current ?? api.account.getProfile(userId),
      ]);
      if (!isActive()) return 'continue';
      selfRef.current = self;
      sinceRef.current = nextSince(history.serverTime);
      setChat((prev) => ({
        kind: 'ready',
        self,
        other: history.otherUser,
        online: history.otherUserOnline,
        messages: mergeMessages(prev.kind === 'ready' ? prev.messages : [], history.messages),
        connectionLost: false,
      }));
      return 'continue';
    } catch (error) {
      return isActive() ? handlePollFailure(error) : 'continue';
    }
  }, CHAT_POLL_MS);

  const messageCount = chat.kind === 'ready' ? chat.messages.length : 0;
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log !== null && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [messageCount]);

  function handleScroll() {
    const log = logRef.current!;
    stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_TO_BOTTOM_PX;
  }

  /**
   * Stub onSendPressed.
   * Satisfies: R-CHAT-12, R-CHAT-13.
   * Requires: a chat is open.
   * Effects: if the box has text, sends it, clears the box and shows the message; if sending
   *          fails, keeps the text and says what to do. Empty text does nothing.
   */
  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = normalizeDraft(draft);
    if (text === null || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await api.chats.sendMessage(chatId, userId, text);
      stickToBottom.current = true;
      setChat((prev) => (prev.kind === 'ready' ? { ...prev, messages: mergeMessages(prev.messages, [message]) } : prev));
      setDraft('');
    } catch (error) {
      if (isSessionExpired(error)) {
        session.logOut();
      } else if (isChatGone(error)) {
        setChat({ kind: 'missing' });
      } else {
        setSendError(describeChatError(error));
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function closeReport() {
    if (reporting) return;
    setReportOpen(false);
    setReportError(null);
  }

  /**
   * Stub onReportPressed.
   * Satisfies: R-CHAT-15, R-CHAT-16.
   * Requires: a chat is open and the report popup is showing.
   * Effects: reports the chat and returns to /chats, replacing this page in the history so Back
   *          can't reopen it. On failure, the popup stays open and says what to do.
   */
  async function confirmReport() {
    if (reporting) return;
    setReporting(true);
    setReportError(null);
    try {
      await api.chats.reportChat(userId, chatId);
      navigate(PATHS.chats, { replace: true });
    } catch (error) {
      if (isSessionExpired(error)) {
        session.logOut();
        return;
      }
      setReportError(describeChatError(error));
      setReporting(false);
    }
  }

  return (
    <main className="chat">
      <h1 className="visually-hidden">Chat</h1>

      {chat.kind === 'loading' && (
        <p className="chat__status" role="status">
          Loading your chat…
        </p>
      )}

      {chat.kind === 'missing' && (
        <div className="chat__status">
          <p>This chat doesn't exist or was removed.</p>
          <Link to={PATHS.chats}>Back to Messages</Link>
        </div>
      )}

      {chat.kind === 'failed' && (
        <div className="chat__status" role="alert">
          <p>Couldn't load this chat. Check your connection. We'll keep trying.</p>
          <Link to={PATHS.chats}>Back to Messages</Link>
        </div>
      )}

      {chat.kind === 'ready' && (
        <>
          <header className="chat__header">
            <Link className="chat__icon-button" to={PATHS.chats} aria-label="Back to Messages">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 5-7 7 7 7" />
              </svg>
            </Link>
            <div className="chat__who">
              <h2 className="chat__name">{displayName(chat.other)}</h2>
              {chat.online && <span className="chat__dot" role="img" aria-label="Online" />}
            </div>
            <button
              type="button"
              className="chat__icon-button chat__icon-button--danger"
              aria-label={`Report chat with ${displayName(chat.other)}`}
              onClick={() => setReportOpen(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 21V4m0 0c5-2.5 9 2.5 14 0v10c-5 2.5-9-2.5-14 0" />
              </svg>
            </button>
          </header>

          {chat.connectionLost && (
            <p className="chat-banner" role="status">
              Can't reach the server. Retrying…
            </p>
          )}

          <div
            ref={logRef}
            className="chat__log"
            role="log"
            aria-label={`Messages with ${displayName(chat.other)}`}
            tabIndex={0}
            onScroll={handleScroll}
          >
            {chat.messages.length === 0 ? (
              <p className="chat__empty">You matched! Say hi to {displayName(chat.other)}.</p>
            ) : (
              <ol className="chat__messages">
                {chat.messages.map((message, index) => (
                  <MessageRow
                    key={message.messageId}
                    message={message}
                    isOwn={message.senderId === userId}
                    showAvatar={startsNewGroup(chat.messages[index - 1] ?? null, message)}
                    self={chat.self}
                    other={chat.other}
                  />
                ))}
              </ol>
            )}
          </div>

          {sendError !== null && (
            <p className="chat-banner chat-banner--error" role="alert">
              {sendError}
            </p>
          )}

          <form className="chat__composer" onSubmit={(event) => void handleSend(event)}>
            <label className="visually-hidden" htmlFor={inputId}>
              Message {displayName(chat.other)}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              className="chat__input"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={sending}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Message…"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button
              type="submit"
              className="chat__send"
              aria-label="Send message"
              disabled={sending || normalizeDraft(draft) === null}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4 3.5 21 12 4 20.5l2.5-7L14 12l-7.5-1.5z" />
              </svg>
            </button>
          </form>
        </>
      )}

      {reportOpen && chat.kind === 'ready' && (
        <Modal title={`Report ${displayName(chat.other)}?`} onClose={closeReport}>
          <p>This chat will be flagged for review and removed from your Messages.</p>
          {reportError !== null && (
            <p className="chat-modal__error" role="alert">
              {reportError}
            </p>
          )}
          <div className="chat-modal__actions">
            <button type="button" className="chat-modal__button" onClick={closeReport} disabled={reporting}>
              Cancel
            </button>
            <button
              type="button"
              className="chat-modal__button chat-modal__button--danger"
              onClick={() => void confirmReport()}
              disabled={reporting}
            >
              Report
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

interface MessageRowProps {
  readonly message: ChatMessage;
  readonly isOwn: boolean;
  readonly showAvatar: boolean;
  readonly self: UserProfile;
  readonly other: UserProfile;
}

/**
 * Stub renderMessage.
 * Satisfies: R-CHAT-07, R-CHAT-08, R-CHAT-09, R-CHAT-10, R-CHAT-11.
 * Requires: message belongs to the open chat.
 * Effects: draws the message right-aligned in blue if isOwn, otherwise left-aligned in grey, with
 *          the sender's picture beside it iff showAvatar.
 */
function MessageRow({ message, isOwn, showAvatar, self, other }: MessageRowProps) {
  const sender = isOwn ? 'You' : displayName(other);
  const classes = ['chat__row', isOwn ? 'chat__row--own' : 'chat__row--other'];
  if (showAvatar) classes.push('chat__row--new-group');
  return (
    <li className={classes.join(' ')}>
      <div className="chat-avatar chat__avatar-slot">
        {showAvatar && <Avatar profile={isOwn ? self : other} label={sender} />}
      </div>
      <p className="chat__bubble">
        <span className="visually-hidden">{sender}: </span>
        {message.text}
      </p>
    </li>
  );
}
