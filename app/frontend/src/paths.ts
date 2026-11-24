/**
 * URL paths, one per view, used by <Route> and navigate() so a typo is a compile error.
 * The chat paths belong to Yara's views; agree on them with him.
 */
export const PATHS = {
  login: '/login',
  signup: '/signup',
  home: '/home',
  profile: '/profile',
  match: (matchId: string) => `/match/${encodeURIComponent(matchId)}`,
  /** Yara's MessageLogView. */
  chats: '/chats',
  /** Yara's ChatView. */
  chat: (chatId: string) => `/chats/${encodeURIComponent(chatId)}`,
} as const;
