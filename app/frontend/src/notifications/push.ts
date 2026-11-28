/**
 * Browser push notifications (matches and chat messages), client side. The browser's own Push API
 * does the delivery: this module asks permission, subscribes this browser with the server's public
 * key, and tells the server about the subscription (api.md, "Push notifications"). The service
 * worker that shows the notifications is public/sw.js.
 *
 * Nothing here runs until the user turns notifications on, except syncPush, which only acts when
 * permission was already granted.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PushApi } from '../api/client';

/**
 * What the Notifications switch shows.
 *   unsupported  this browser has no Push API (or, on iPhone, the app isn't on the Home Screen)
 *   blocked      the user refused permission; only the browser's site settings can undo that
 *   off / on     whether this browser is subscribed
 */
export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

export const SERVICE_WORKER_URL = '/sw.js';
const HINT_KEY = 'do-re.pushHint';

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff this browser can receive push notifications
 */
export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Requires: base64url is a base64url string (the server's VAPID public key).
 * Effects: none.
 * @returns its bytes, the form PushManager.subscribe needs
 */
export function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (a === null) return false;
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((value, i) => value === b[i]);
}

/**
 * Requires: none.
 * Effects: none.
 * @returns the state the switch should show
 */
export async function readPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

/**
 * Subscribes this browser with the server's key and saves the subscription on the server.
 * A subscription made with another key (the server's key changed) is replaced.
 * Requires: notification permission is granted.
 * Effects: registers the service worker; subscribes; saves the subscription for the logged-in user.
 */
async function subscribe(api: PushApi): Promise<void> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  const registration = await navigator.serviceWorker.ready;
  const key = decodeKey(await api.getPublicKey());
  let subscription = await registration.pushManager.getSubscription();
  if (subscription !== null && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { endpoint, keys } = subscription.toJSON();
  await api.saveSubscription({ endpoint: endpoint!, keys: { p256dh: keys!.p256dh!, auth: keys!.auth! } });
}

/**
 * Turns notifications on for this browser.
 * Requires: called from a click or key press (browsers only show the permission prompt then).
 * Effects: asks for permission if not yet decided; if granted, subscribes this browser and saves
 *          the subscription for the logged-in user.
 * @returns the new state: 'on', or 'blocked' / 'off' if the user refused or dismissed the prompt
 * @throws if the browser or the server could not complete the subscription; this browser is then
 *         left unsubscribed
 */
export async function enablePush(api: PushApi): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  try {
    await subscribe(api);
  } catch (error) {
    // The server didn't get the subscription, so it could never be used: drop it again, so the
    // switch doesn't show "on" for notifications that will not arrive.
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL).catch(() => undefined);
    const subscription = await registration?.pushManager.getSubscription().catch(() => null);
    await subscription?.unsubscribe().catch(() => false);
    throw error;
  }
  return 'on';
}

/**
 * Turns notifications off for this browser.
 * Requires: none.
 * Effects: removes this browser's subscription from the server and from the browser. The server
 *          is told first, on a best-effort basis: a subscription the browser has dropped stops
 *          working anyway, and the server forgets it at the next failed delivery.
 * @returns the new state
 */
export async function disablePush(api: PushApi): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api.removeSubscription(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return Notification.permission === 'denied' ? 'blocked' : 'off';
}

/**
 * Keeps an existing subscription attached to the logged-in user, e.g. after logging in again on a
 * browser where notifications were already on, or after the server's key changed.
 * Requires: a user is logged in.
 * Effects: if this browser is subscribed and permission is still granted, re-saves the
 *          subscription for the logged-in user (resubscribing if the key changed); otherwise
 *          nothing. Never throws: this runs in the background.
 */
export async function syncPush(api: PushApi): Promise<void> {
  try {
    if (!isPushSupported() || Notification.permission !== 'granted') return;
    if ((await readPushState()) === 'on') await subscribe(api);
  } catch {
    // Offline, or the server has no push key: the switch still shows the true browser state.
  }
}

/**
 * Requires: none.
 * Effects: none.
 * @returns true iff the one-time hint on Home has not been dismissed in this browser
 */
export function shouldShowPushHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * Requires: none.
 * Effects: the hint on Home is not shown again in this browser.
 */
export function dismissPushHint(): void {
  try {
    localStorage.setItem(HINT_KEY, 'dismissed');
  } catch {
    // Storage blocked: the hint goes away for this page only.
  }
}

export interface PushControls {
  /** null while the state is being read. */
  readonly state: PushState | null;
  /** True while turning on or off. */
  readonly busy: boolean;
  /** What went wrong the last time, in words for the user, or null. */
  readonly error: string | null;
  /** Requires: called from a click or key press. Effects: see enablePush / disablePush. */
  setEnabled(on: boolean): Promise<void>;
}

/**
 * Requires: called from a React component.
 * Effects: reads this browser's notification state once.
 * @returns the state and a function that turns notifications on or off
 */
export function usePushNotifications(api: PushApi): PushControls {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readPushState().then(
      (value) => !cancelled && setState(value),
      () => !cancelled && setState('unsupported'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(
    async (on: boolean) => {
      setBusy(true);
      setError(null);
      try {
        setState(on ? await enablePush(api) : await disablePush(api));
      } catch {
        setError(
          on
            ? "Couldn't turn notifications on. Check your connection and try again."
            : "Couldn't turn notifications off. Try again.",
        );
        setState(await readPushState().catch(() => 'off' as const));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  return { state, busy, error, setEnabled };
}
