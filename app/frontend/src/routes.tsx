/**
 * ViewController (owner: Yara): the app's router. One URL route per ViewType, so back/forward and
 * refresh work (CLAUDE.md; architecture.md ViewController). Paths are agreed in notes-for-yara Y-1.
 *
 * Logged-out users are sent to /login, and LoginView and CreateAccountView send logged-in users
 * home. The bottom bar is on every page except login and signup (OPEN-10, assumed).
 *
 * Satisfies: R-ACC-06, R-UI-04, R-CHAT-05.
 */
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BottomBarView } from './components/BottomBarView';
import { useSession } from './session/SessionContext';
import { ChatView } from './views/ChatView';
import { CreateAccountView } from './views/CreateAccountView';
import { HomeView } from './views/HomeView';
import { LoginView } from './views/LoginView';
import { MatchView } from './views/MatchView';
import { MessageLogView } from './views/MessageLogView';
import { ProfileView } from './views/ProfileView';
import { VerifyEmailView } from './views/VerifyEmailView';
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
      <BottomBarView />
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
      <Route path={PATHS.verify} element={<VerifyEmailView />} />
      <Route element={<RequireSession />}>
        <Route element={<WithBottomBar />}>
          <Route path={PATHS.home} element={<HomeView />} />
          <Route path={PATHS.profile} element={<ProfileView />} />
          <Route path="/match/:matchId" element={<MatchView />} />
          <Route path={PATHS.chats} element={<MessageLogView />} />
          <Route path="/chats/:chatId" element={<ChatView />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={PATHS.home} replace />} />
    </Routes>
  );
}
