/**
 * Test helper: a fake of the browser's push machinery (Notification, PushManager and
 * navigator.serviceWorker), which jsdom does not have.
 */
import { vi } from 'vitest';

/** The server key the fake API hands out: base64url of bytes 1..8. */
export const KEY = 'AQIDBAUGBwg';
export const KEY_BYTES = [1, 2, 3, 4, 5, 6, 7, 8];
export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

/** A fake of the browser's push machinery, installed on navigator and window. */
export function installBrowser(options: { permission?: NotificationPermission; answer?: NotificationPermission; subscribedWith?: number[] } = {}) {
  let permission = options.permission ?? 'default';
  let subscription: ReturnType<typeof makeSubscription> | null = null;
  const makeSubscription = (key: number[]) => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: Uint8Array.from(key).buffer },
    unsubscribe: vi.fn(async () => {
      subscription = null;
      return true;
    }),
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p256', auth: 'auth' } }),
  });
  if (options.subscribedWith) subscription = makeSubscription(options.subscribedWith);
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async (init: { applicationServerKey: Uint8Array; userVisibleOnly: boolean }) => {
      subscription = makeSubscription([...init.applicationServerKey]);
      return subscription;
    }),
  };
  let registered = options.subscribedWith !== undefined;
  const listeners = new Set<(event: MessageEvent) => void>();
  const serviceWorker = {
    register: vi.fn(async () => {
      registered = true;
      return { pushManager };
    }),
    getRegistration: vi.fn(async () => (registered ? { pushManager } : undefined)),
    get ready() {
      return Promise.resolve({ pushManager });
    },
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
  };
  const requestPermission = vi.fn(async () => {
    permission = options.answer ?? 'granted';
    return permission;
  });
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  return {
    pushManager,
    serviceWorker,
    requestPermission,
    current: () => subscription,
    post: (data: unknown) => listeners.forEach((listener) => listener({ data } as MessageEvent)),
    listenerCount: () => listeners.size,
  };
}

/** Removes what installBrowser installed. Call in afterEach. */
export function uninstallBrowser(): void {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
}
