/**
 * Where the login session lives in the browser: the user ID and session token, in sessionStorage
 * so a refresh keeps the user logged in. Never a password or email. If storage is blocked, the
 * token is held in memory until the tab reloads. Kept outside React so the HTTP client can read it.
 */
const USER_KEY = 'do-re.userId';
const TOKEN_KEY = 'do-re.token';
/** Present ("yes") iff the logged-in user may see the Admin tab (OPEN-18). Only a display hint. */
const ADMIN_KEY = 'do-re.admin';

/** Fired on window when the server rejects the session. */
export const SESSION_EXPIRED_EVENT = 'do-re:session-expired';

let tokenInMemory: string | null = null;

/**
 * Requires: none.
 * Effects: none.
 * @returns the stored user ID, or null
 */
export function readStoredUserId(): string | null {
  try {
    return sessionStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

/**
 * Requires: none.
 * Effects: none.
 * @returns the current session token, or null
 */
export function readSessionToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? tokenInMemory;
  } catch {
    return tokenInMemory;
  }
}

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff the stored session belongs to an admin
 */
export function readStoredAdmin(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_KEY) === 'yes';
  } catch {
    return false;
  }
}

/**
 * Requires: none.
 * Effects: remembers userId, token and whether the user is an admin, for this browser tab.
 */
export function storeSession(userId: string, token?: string, isAdmin = false): void {
  tokenInMemory = token ?? null;
  try {
    sessionStorage.setItem(USER_KEY, userId);
    if (isAdmin) sessionStorage.setItem(ADMIN_KEY, 'yes');
    else sessionStorage.removeItem(ADMIN_KEY);
    if (token !== undefined) sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage blocked: the session still works until the tab reloads.
  }
}

/**
 * Requires: none.
 * Effects: forgets the user ID and token.
 */
export function clearStoredSession(): void {
  tokenInMemory = null;
  try {
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
}

/**
 * Requires: none.
 * Effects: tells the app that the session is no longer valid, which logs the user out.
 */
export function notifySessionExpired(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
