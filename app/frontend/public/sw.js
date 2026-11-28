/*
 * Do~Re service worker: shows push notifications for matches and chat messages, and opens the
 * right page when one is clicked. It caches nothing and does not touch page requests.
 *
 * A push's data is JSON from the backend's Notifier: { title, body, url, tag }, where url is a
 * path in the app (/match/<id> or /chats/<id>).
 */

/** Only paths inside the app are ever opened. */
function appPath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch {
    // No payload, or not JSON: fall back to a plain notification.
  }
  const url = appPath(data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Open pages refresh what they show (e.g. the new-match badge) without waiting for a poll.
      for (const client of windows) client.postMessage({ type: 'do-re:push' });
      // The user is already looking at this chat or match: the page shows it, so stay quiet.
      if (windows.some((client) => client.focused && new URL(client.url).pathname === url)) return;
      await self.registration.showNotification(typeof data.title === 'string' ? data.title : 'Do~Re', {
        body: typeof data.body === 'string' ? data.body : '',
        tag: typeof data.tag === 'string' ? data.tag : undefined,
        renotify: typeof data.tag === 'string',
        icon: '/logo.png',
        badge: '/logo.png',
        data: { url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        // An open tab keeps its login (the session lives in the tab): bring it forward and
        // let the app's router go to the page (src/notifications/PushBridge.tsx).
        await open.focus();
        open.postMessage({ type: 'do-re:navigate', url });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
