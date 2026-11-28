/**
 * Keeps the app aware of matches waiting for the user's answer, on every page (R-HOME-20: a match
 * is presented to both matched users). HomeView opens a new match once when it loads; this is what
 * tells a user who is already in the app, or who left the match screen without answering:
 * BottomBarView shows a badge on Home and HomeView shows a banner, both from here.
 *
 * The list is refreshed when the user logs in, on every page change (so it is right straight
 * after answering a match), every PENDING_POLL_MS, and at once when a push notification arrives.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import type { Match } from '../api/types';
import { isPushSupported } from '../notifications/push';
import { useSession } from '../session/SessionContext';
import { NONE, PENDING_POLL_MS, PendingMatchesContext } from './pendingMatchesContext';

/**
 * Requires: rendered inside ApiProvider, SessionProvider and a router.
 * Effects: while a user is logged in, reads their pending matches as described above and
 *          provides them to children. A failed read keeps the last list.
 */
export function PendingMatchesProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { userId } = useSession();
  const { pathname } = useLocation();
  // Kept with the user it was read for, so one account's matches never show for another.
  const [read, setRead] = useState<{ userId: string; matches: readonly Match[]; reads: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    api.matches.getPendingMatches(userId).then(
      (matches) => !cancelled && setRead((previous) => ({ userId, matches, reads: (previous?.reads ?? 0) + 1 })),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, userId, pathname, tick]);

  useEffect(() => {
    if (userId === null) return;
    const again = () => setTick((n) => n + 1);
    const timer = setInterval(again, PENDING_POLL_MS);
    // The service worker tells open pages when a push arrives (public/sw.js).
    const worker = isPushSupported() ? navigator.serviceWorker : null;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === 'do-re:push') again();
    };
    worker?.addEventListener('message', onMessage);
    return () => {
      clearInterval(timer);
      worker?.removeEventListener('message', onMessage);
    };
  }, [userId]);

  const mine = read !== null && read.userId === userId;
  const state = useMemo(() => ({ matches: mine ? read.matches : NONE, reads: read?.reads ?? 0 }), [mine, read]);
  return <PendingMatchesContext.Provider value={state}>{children}</PendingMatchesContext.Provider>;
}
