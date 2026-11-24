/**
 * Who is logged in, on the client (part of ViewController, notes-for-yara Y-3). The session is
 * kept in sessionStorage so a refresh keeps the user logged in (CLAUDE.md: refresh must work),
 * and ends when the user logs out or the server rejects its token.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearStoredSession, readStoredUserId, SESSION_EXPIRED_EVENT, storeSession } from './sessionStore';

export interface Session {
  /** The logged-in user's ID, or null when logged out. */
  readonly userId: string | null;
  /**
   * Effects: userId becomes the given ID and is remembered for this browser tab, with the session
   *          token if one is given.
   */
  logIn(userId: string, token?: string): void;
  /** Effects: userId becomes null, and the ID and token are forgotten. */
  logOut(): void;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Requires: none.
 * Effects: provides a Session to children, starting from initialUserId if given, otherwise from
 *          sessionStorage; logs out when the server reports the session has expired.
 */
export function SessionProvider({ children, initialUserId }: { children: ReactNode; initialUserId?: string | null }) {
  const [userId, setUserId] = useState<string | null>(() =>
    initialUserId !== undefined ? initialUserId : readStoredUserId(),
  );
  const logIn = useCallback((id: string, token?: string) => {
    storeSession(id, token);
    setUserId(id);
  }, []);
  const logOut = useCallback(() => {
    clearStoredSession();
    setUserId(null);
  }, []);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, logOut);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logOut);
  }, [logOut]);

  const session = useMemo(() => ({ userId, logIn, logOut }), [userId, logIn, logOut]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/**
 * Requires: called inside a SessionProvider.
 * Effects: none.
 * @returns the current Session
 */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession must be used inside a SessionProvider');
  return session;
}
