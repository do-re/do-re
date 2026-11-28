/**
 * Connects the service worker to the running app (part of ViewController): when a notification is
 * clicked while a tab is open, the worker asks that tab to go to the notification's page, and this
 * component does it with the router, so the tab keeps its login. It also keeps an existing push
 * subscription attached to whoever is logged in.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { useSession } from '../session/SessionContext';
import { isPushSupported, syncPush } from './push';

/**
 * Requires: rendered inside ApiProvider, SessionProvider and a router.
 * Effects: while mounted, navigates when the service worker sends { type: 'do-re:navigate', url }
 *          with a path inside the app; re-saves this browser's subscription when a user logs in.
 */
export function PushBridge() {
  const api = useApi();
  const { userId } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'do-re:navigate' && typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')) {
        navigate(data.url);
      }
    };
    const worker = navigator.serviceWorker;
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    if (userId !== null) void syncPush(api.push);
  }, [api, userId]);

  return null;
}
