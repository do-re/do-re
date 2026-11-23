/**
 * Who is logged in, on the client. Kept in sessionStorage so a refresh keeps the user logged in
 * (CLAUDE.md: refresh must work).
 *
 * TEMPORARY: the real session (a token from Felix's auth, checked by the server) belongs to
 * ViewController (Yara) and the backend. Only the userId is stored here, never a password or
 * email. Replace or merge with Yara's version when ViewController lands.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'do-re.userId';

export interface Session {
  /** The logged-in user's ID, or null when logged out. */
  readonly userId: string | null;
  /** Effects: userId becomes the given ID and is remembered for this browser tab. */
  logIn(userId: string): void;
  /** Effects: userId becomes null and is forgotten. */
  logOut(): void;
}

const SessionContext = createContext<Session | null>(null);

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(userId: string | null): void {
  try {
    if (userId === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, userId);
  } catch {
    // Storage blocked (private mode etc.): the session still works until the tab reloads.
  }
}

/**
 * Requires: none.
 * Effects: provides a Session to children, starting from initialUserId if given, otherwise
 *          from sessionStorage.
 */
export function SessionProvider({ children, initialUserId }: { children: ReactNode; initialUserId?: string | null }) {
  const [userId, setUserId] = useState<string | null>(() =>
    initialUserId !== undefined ? initialUserId : readStored(),
  );
  const logIn = useCallback((id: string) => {
    writeStored(id);
    setUserId(id);
  }, []);
  const logOut = useCallback(() => {
    writeStored(null);
    setUserId(null);
  }, []);
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
