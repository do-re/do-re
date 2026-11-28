/**
 * MessageLogView: the /chats page (architecture-stubs-v2.java MessageLogView). One row per chat
 * with the other user's picture and username, most recent activity first, a button that opens the
 * chat and a button that removes it from this user's log. The list refreshes while open, so a
 * chat appears when the other user confirms a match (OPEN-4, notes-for-yara Y-6).
 *
 * WEB: below the chats, "Waiting for an answer" lists the matches the user said yes to that the
 * other person has not answered, each with a button to take the yes back after a confirmation.
 *
 * Satisfies: R-CHAT-01, R-CHAT-02.
 * Communicates with: ChatController (via useApi()), ViewController (via the router).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { displayName } from '../api/profile';
import { ApiError } from '../api/apiErrors';
import type { ChatSummary, OutgoingMatch } from '../api/types';
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

  // Matches the user said yes to that are still waiting for the other person.
  const [outgoing, setOutgoing] = useState<readonly OutgoingMatch[]>([]);
  const [retraction, setRetraction] = useState<OutgoingMatch | null>(null);
  const [retracting, setRetracting] = useState(false);
  const [retractError, setRetractError] = useState<string | null>(null);
  const outgoingGeneration = useRef(0);

  usePolling(async (isActive) => {
    const startedIn = generation.current;
    try {
      const chats = await api.chats.getChatLog(userId);
      if (isActive() && startedIn === generation.current) {
        setLog({ kind: 'ready', chats, connectionLost: false });
      }
      // The waiting list is secondary: if it can't be read, the chats still show and the last
      // list stays.
      const startedOutgoingIn = outgoingGeneration.current;
      const waiting = await api.matches.getOutgoingMatches(userId).catch(() => null);
      if (waiting !== null && isActive() && startedOutgoingIn === outgoingGeneration.current) setOutgoing(waiting);
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

  function closeRetraction() {
    if (retracting) return;
    setRetraction(null);
    setRetractError(null);
  }

  /**
   * WEB: the confirmation popup's "Take back" button.
   * Requires: an outgoing match is awaiting confirmation in the popup.
   * Effects: asks MatchController to take back the user's yes and removes the row. If the other
   *          person answered in the meantime, removes the row and says so. On any other failure
   *          the popup stays open and says what to do.
   */
  async function confirmRetraction() {
    if (retraction === null || retracting) return;
    const target = retraction;
    const drop = () => {
      outgoingGeneration.current += 1;
      setOutgoing((previous) => previous.filter((entry) => entry.match.matchId !== target.match.matchId));
    };
    setRetracting(true);
    setRetractError(null);
    try {
      await api.matches.retractMatch(target.match, userId);
      drop();
      setRetraction(null);
      setRemovedCount((n) => n + 1);
    } catch (error) {
      if (isSessionExpired(error)) {
        session.logOut();
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        drop();
        setRetractError(`${displayName(target.otherUser)} has already answered, so this can't be taken back. Check your chats.`);
      } else {
        setRetractError(describeChatError(error));
      }
    } finally {
      setRetracting(false);
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

      {outgoing.length > 0 && (
        <section className="chat-log__waiting" aria-labelledby="waiting-title">
          <h2 id="waiting-title" className="chat-log__subtitle">
            Waiting for an answer
          </h2>
          <p className="chat-log__hint">You said yes to these matches. A chat opens when they say yes too.</p>
          <ul className="chat-log__list">
            {outgoing.map((entry) => {
              const name = displayName(entry.otherUser);
              return (
                <li key={entry.match.matchId} className="chat-log__row">
                  <div className="chat-log__open">
                    <div className="chat-avatar">
                      <Avatar profile={entry.otherUser} label={name} />
                    </div>
                    <div className="chat-log__text">
                      <div className="chat-log__name">{name}</div>
                      <div className="chat-log__preview">{entry.match.compatibilityPercent.toFixed(1)}% match · waiting</div>
                    </div>
                  </div>
                  <button type="button" className="chat-log__retract" onClick={() => setRetraction(entry)}>
                    Take back <span className="visually-hidden">your yes to {name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {retraction !== null && (
        <Modal title={`Take back your yes to ${displayName(retraction.otherUser)}?`} onClose={closeRetraction}>
          <p>
            {displayName(retraction.otherUser)} will no longer see this match, and you won't be matched with them
            again. This can't be undone.
          </p>
          {retractError !== null && (
            <p className="chat-modal__error" role="alert">
              {retractError}
            </p>
          )}
          <div className="chat-modal__actions">
            <button type="button" className="chat-modal__button" onClick={closeRetraction} disabled={retracting}>
              {retractError !== null && !outgoing.includes(retraction) ? 'Close' : 'Cancel'}
            </button>
            {outgoing.includes(retraction) && (
              <button
                type="button"
                className="chat-modal__button chat-modal__button--danger"
                onClick={() => void confirmRetraction()}
                disabled={retracting}
              >
                Take back
              </button>
            )}
          </div>
        </Modal>
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
