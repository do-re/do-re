/**
 * BottomBarView: Home / Messages / Profile, shown on every page except login and signup
 * (architecture-stubs-v2.java BottomBarView; OPEN-10, assumed). The router marks the current
 * section with the "active" class and aria-current, including Messages while a chat is open.
 *
 * WEB (OPEN-18): admins get a fourth tab, Admin, after Profile. Whether the user is an admin
 * comes from the session (the login response says so); the server still checks every admin
 * request itself. Someone made an admin while logged in sees the tab after their next login.
 *
 * Satisfies: R-UI-04, R-UI-05.
 * Communicates with: ViewController (via router links).
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { usePendingMatches } from '../matches/pendingMatchesContext';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './bottomBar.css';

const TABS: readonly { readonly to: string; readonly label: string; readonly icon: ReactNode }[] = [
  { to: PATHS.home, label: 'Home', icon: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  { to: PATHS.chats, label: 'Messages', icon: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" /> },
  {
    to: PATHS.profile,
    label: 'Profile',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1-4.5 4-6.5 8-6.5s7 2 8 6.5" />
      </>
    ),
  },
];

/** Shown to admins only: a shield. */
const ADMIN_TAB = {
  to: PATHS.admin,
  label: 'Admin',
  icon: <path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6z" />,
};

/**
 * Requires: rendered inside SessionProvider and a router, with a user logged in.
 * Effects: renders one link per section; following a link asks the router for that view
 *          (stub onHomePressed, onMessagesPressed, onProfilePressed). For a user who logged in
 *          as an admin, adds the Admin tab at the end. While matches are waiting for the user's
 *          answer, Home carries a badge with their number.
 */
export function BottomBarView() {
  const { isAdmin } = useSession();
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS;
  // Matches waiting for an answer show as a badge on Home, wherever the user is (R-HOME-20).
  const waiting = usePendingMatches().length;
  const badgeFor = (to: string) => (to === PATHS.home && waiting > 0 ? waiting : undefined);
  return (
    <nav className="bottom-bar" aria-label="Main">
      {tabs.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          className="bottom-bar__tab"
          data-badge={badgeFor(to)}
          aria-describedby={badgeFor(to) === undefined ? undefined : 'bottom-bar-matches'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
          {label}
        </NavLink>
      ))}
      {/* Read out with the Home tab; the visible badge is drawn from data-badge (bottomBar.css). */}
      {waiting > 0 && (
        <span id="bottom-bar-matches" className="visually-hidden">
          {waiting} new {waiting === 1 ? 'match' : 'matches'}
        </span>
      )}
    </nav>
  );
}
