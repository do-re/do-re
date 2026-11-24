/**
 * MessageLogView: the /chats page (architecture-stubs-v2.java MessageLogView). One row per chat
 * with the other user's picture and username, most recent activity first, a button that opens the
 * chat and a button that removes it from this user's log. The list refreshes while open, so a
 * chat appears when the other user confirms a match (OPEN-4, notes-for-yara Y-6).
 *
 * Satisfies: R-CHAT-01, R-CHAT-02.
 * Communicates with: ChatController (via useApi()), ViewController (via the router).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { displayName } from '../api/profile';
import type { ChatSummary } from '../api/types';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './chat.css';
import { describeChatError, isSessionExpired, LOG_POLL_MS, previewOf } from './chatLogic';
import { usePolling } from './usePolling';

type LogState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; chats: readonly ChatSummary[]; connectionLost: boolean };

/**
 * The /chats page.
 * Requires: rendered inside ApiProvider, SessionProvider (with a logged-in user) and a router.
 * Effects: loads and keeps refreshing the user's chats, in the order the server gives them.
 */
export function MessageLogView() {
  const api = useApi();
  const session = useSession();
  const userId = session.userId!;

  const [log, setLog] = useState<LogState>({ kind: 'loading' });
  const [removal, setRemoval] = useState<ChatSummary | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removedCount, setRemovedCount] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Bumped by each removal, so a refresh that started before it can't bring the row back.
  const generation = useRef(0);

  usePolling(async (isActive) => {
    const startedIn = generation.current;
    try {
      const chats = await api.chats.getChatLog(userId);
      if (isActive() && startedIn === generation.current) {
        setLog({ kind: 'ready', chats, connectionLost: false });
      }
      return 'continue';
    } catch (error) {
      if (!isActive()) return 'continue';
      if (isSessionExpired(error)) {
        session.logOut();
        return 'stop';
      }
      setLog((prev) => (prev.kind === 'ready' ? { ...prev, connectionLost: true } : { kind: 'failed' }));
      return 'continue';
    }
  }, LOG_POLL_MS);

  // The removed row's button is gone, so focus moves to the page heading.
  useEffect(() => {
    if (removedCount > 0) headingRef.current?.focus();
  }, [removedCount]);

  function closeRemoval() {
    if (removing) return;
    setRemoval(null);
    setRemoveError(null);
  }

  /**
   * Stub onRemoveChatPressed.
   * Requires: a chat is awaiting confirmation in the popup.
   * Effects: asks ChatController to remove it and removes its row; on failure, the popup stays
   *          open and says what to do.
   */
  async function confirmRemoval() {
    if (removal === null || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.chats.removeChatFromLog(userId, removal.chatId);
      generation.current += 1;
      setLog((prev) =>
        prev.kind === 'ready' ? { ...prev, chats: prev.chats.filter((c) => c.chatId !== removal.chatId) } : prev,
      );
      setRemoval(null);
      setRemovedCount((n) => n + 1);
    } catch (error) {
      if (isSessionExpired(error)) {
        session.logOut();
        return;
      }
      setRemoveError(describeChatError(error));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <main className="page chat-log">
      <h1 ref={headingRef} className="chat-log__title" tabIndex={-1}>
        Messages
      </h1>

      {log.kind === 'loading' && <p role="status">Loading your chats…</p>}

      {log.kind === 'failed' && (
        <p role="alert">Couldn't load your chats. Check your connection. We'll keep trying.</p>
      )}

      {log.kind === 'ready' && log.connectionLost && (
        <p className="chat-banner" role="status">
          Can't reach the server, so this list may be out of date. Retrying…
        </p>
      )}

      {log.kind === 'ready' && log.chats.length === 0 && (
        <div className="chat-log__empty">
          <p>No chats yet. Keep swiping to find a match.</p>
          <Link to={PATHS.home}>Back to songs</Link>
        </div>
      )}

      {log.kind === 'ready' && log.chats.length > 0 && (
        <ul className="chat-log__list">
          {log.chats.map((chat) => {
            const name = displayName(chat.otherUser);
            const preview = previewOf(chat, userId);
            return (
              <li key={chat.chatId} className="chat-log__row">
                <Link className="chat-log__open" to={PATHS.chat(chat.chatId)} aria-label={`Chat with ${name}: ${preview}`}>
                  <div className="chat-avatar">
                    <Avatar profile={chat.otherUser} label={name} />
                  </div>
                  <div className="chat-log__text">
                    <div className="chat-log__name">{name}</div>
                    <div className="chat-log__preview">{preview}</div>
                  </div>
                </Link>
                <button
                  type="button"
                  className="chat-log__remove"
                  aria-label={`Remove chat with ${name}`}
                  onClick={() => setRemoval(chat)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {removal !== null && (
        <Modal title={`Remove chat with ${displayName(removal.otherUser)}?`} onClose={closeRemoval}>
          <p>It will disappear from your Messages. {displayName(removal.otherUser)} will still have it.</p>
          {removeError !== null && (
            <p className="chat-modal__error" role="alert">
              {removeError}
            </p>
          )}
          <div className="chat-modal__actions">
            <button type="button" className="chat-modal__button" onClick={closeRemoval} disabled={removing}>
              Cancel
            </button>
            <button
              type="button"
              className="chat-modal__button chat-modal__button--danger"
              onClick={() => void confirmRemoval()}
              disabled={removing}
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
