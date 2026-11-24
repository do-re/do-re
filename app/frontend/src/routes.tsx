/**
 * URL routes for Gavin's views. One route per view so back/forward and refresh work
 * (CLAUDE.md; architecture.md ViewController).
 *
 * ViewController and the chat routes (/chats, /chats/:chatId) are Yara's. Agree on these
 * paths with him; until his router exists, this file is the routing table.
 */
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BottomBarPlaceholder } from './components/BottomBarPlaceholder';
import { useSession } from './session/SessionContext';
import { ChatPlaceholder } from './views/ChatPlaceholder';
import { CreateAccountView } from './views/CreateAccountView';
import { HomeView } from './views/HomeView';
import { LoginView } from './views/LoginView';
import { MatchView } from './views/MatchView';
import { ProfileView } from './views/ProfileView';
import { PATHS } from './paths';

/**
 * Requires: inside a SessionProvider and a router.
 * Effects: renders the child route if someone is logged in, otherwise redirects to /login
 *          and remembers where the user was going (R-SEC-03: no access without logging in).
 */
function RequireSession() {
  const { userId } = useSession();
  const location = useLocation();
  if (userId === null) {
    return <Navigate to={PATHS.login} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Layout for views that show the bottom bar (all but login and signup, OPEN-10). */
function WithBottomBar() {
  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <Outlet />
      </div>
      <BottomBarPlaceholder />
    </div>
  );
}

/**
 * Requires: inside ApiProvider, SessionProvider and a router.
 * Effects: renders the view for the current URL.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path={PATHS.login} element={<LoginView />} />
      <Route path={PATHS.signup} element={<CreateAccountView />} />
      <Route element={<RequireSession />}>
        <Route element={<WithBottomBar />}>
          <Route path={PATHS.home} element={<HomeView />} />
          <Route path={PATHS.profile} element={<ProfileView />} />
          <Route path="/match/:matchId" element={<MatchView />} />
          {/* Placeholders until Yara's MessageLogView and ChatView exist. */}
          <Route path={PATHS.chats} element={<ChatPlaceholder />} />
          <Route path="/chats/:chatId" element={<ChatPlaceholder />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={PATHS.home} replace />} />
    </Routes>
  );
}
