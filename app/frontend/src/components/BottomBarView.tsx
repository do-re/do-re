/**
 * BottomBarView: Home / Messages / Profile, shown on every page except login and signup
 * (architecture-stubs-v2.java BottomBarView; OPEN-10, assumed). The router marks the current
 * section with the "active" class and aria-current, including Messages while a chat is open.
 *
 * Satisfies: R-UI-04, R-UI-05.
 * Communicates with: ViewController (via router links).
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { PATHS } from '../paths';
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

/**
 * Requires: rendered inside a router, with a user logged in.
 * Effects: renders one link per section; following a link asks the router for that view
 *          (stub onHomePressed, onMessagesPressed, onProfilePressed).
 */
export function BottomBarView() {
  return (
    <nav className="bottom-bar" aria-label="Main">
      {TABS.map(({ to, label, icon }) => (
        <NavLink key={to} to={to} className="bottom-bar__tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
