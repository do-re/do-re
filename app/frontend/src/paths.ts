/**
 * URL paths, one per view, used by <Route> and navigate() so a typo is a compile error.
 * The chat paths belong to Yara's views; agree on them with him.
 */
export const PATHS = {
  login: '/login',
  signup: '/signup',
  /** The page that the link in a verification email opens. */
  verify: '/verify',
  home: '/home',
  profile: '/profile',
  /** The admin page (OPEN-18). Only admins can use it; the server checks. */
  admin: '/admin',
  match: (matchId: string) => `/match/${encodeURIComponent(matchId)}`,
  /** Yara's MessageLogView. */
  chats: '/chats',
  /** Yara's ChatView. */
  chat: (chatId: string) => `/chats/${encodeURIComponent(chatId)}`,
} as const;
