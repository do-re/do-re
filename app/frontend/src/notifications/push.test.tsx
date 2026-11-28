import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import type { Api, BrowserSubscription, PushApi } from '../api/client';
import { createMockApi } from '../api/mock';
import { SessionProvider } from '../session/SessionContext';
import { ENDPOINT, installBrowser, KEY, KEY_BYTES, uninstallBrowser } from '../test/fakePush';
import { PushBridge } from './PushBridge';
import {
  decodeKey,
  disablePush,
  dismissPushHint,
  enablePush,
  isPushSupported,
  readPushState,
  shouldShowPushHint,
  syncPush,
  usePushNotifications,
} from './push';


function fakeApi(overrides: Partial<PushApi> = {}) {
  const saved: BrowserSubscription[] = [];
  const removed: string[] = [];
  const api: PushApi = {
    getPublicKey: vi.fn(async () => KEY),
    saveSubscription: vi.fn(async (subscription) => void saved.push(subscription)),
    removeSubscription: vi.fn(async (endpoint) => void removed.push(endpoint)),
    ...overrides,
  };
  return { api, saved, removed };
}

afterEach(uninstallBrowser);

describe('push support and state', () => {
  // spec: partitions of readPushState
  it('reports unsupported, blocked, off and on', async () => {
    expect(isPushSupported()).toBe(false); // jsdom has no Push API
    expect(await readPushState()).toBe('unsupported');
    installBrowser({ permission: 'denied' });
    expect(isPushSupported()).toBe(true);
    expect(await readPushState()).toBe('blocked');
    installBrowser();
    expect(await readPushState()).toBe('off'); // no service worker registered yet
    installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    expect(await readPushState()).toBe('on');
  });

  it('decodeKey turns a base64url key into its bytes', () => {
    expect([...decodeKey(KEY)]).toEqual(KEY_BYTES);
    expect([...decodeKey('-_8')]).toEqual([251, 255]); // url-safe characters, no padding
    expect([...decodeKey('')]).toEqual([]);
  });
});

describe('enablePush', () => {
  it('asks permission, subscribes with the server key and saves the subscription', async () => {
    const browser = installBrowser();
    const { api, saved } = fakeApi();
    expect(await enablePush(api)).toBe('on');
    expect(browser.requestPermission).toHaveBeenCalledOnce();
    expect(browser.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    const init = browser.pushManager.subscribe.mock.calls[0]![0];
    expect(init.userVisibleOnly).toBe(true);
    expect([...init.applicationServerKey]).toEqual(KEY_BYTES);
    expect(saved).toEqual([{ endpoint: ENDPOINT, keys: { p256dh: 'p256', auth: 'auth' } }]);
    expect(await readPushState()).toBe('on');
  });

  // spec: a refusal is 'blocked', a dismissed prompt is 'off'; nothing is subscribed either way
  it('does not subscribe when the user refuses or dismisses the prompt', async () => {
    for (const [answer, expected] of [['denied', 'blocked'], ['default', 'off']] as const) {
      const browser = installBrowser({ answer });
      const { api, saved } = fakeApi();
      expect(await enablePush(api)).toBe(expected);
      expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
      expect(saved).toEqual([]);
    }
  });

  it('reuses a subscription made with the same key and replaces one made with another', async () => {
    const same = installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    const first = fakeApi();
    expect(await enablePush(first.api)).toBe('on');
    expect(same.pushManager.subscribe).not.toHaveBeenCalled();
    expect(first.saved).toHaveLength(1);

    const other = installBrowser({ permission: 'granted', subscribedWith: [9, 9, 9] });
    const old = other.current()!;
    const second = fakeApi();
    expect(await enablePush(second.api)).toBe('on');
    expect(old.unsubscribe).toHaveBeenCalledOnce(); // the server's key changed
    expect(other.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(second.saved).toHaveLength(1);
  });

  it('is unsupported without a Push API, and passes on a server failure', async () => {
    const { api } = fakeApi();
    expect(await enablePush(api)).toBe('unsupported');
    expect(await disablePush(api)).toBe('unsupported');
    installBrowser();
    await expect(enablePush(fakeApi({ getPublicKey: async () => Promise.reject(new Error('503')) }).api)).rejects.toThrow('503');
  });

  // spec: after a failure this browser is left unsubscribed
  it('drops the browser subscription again when the server refuses to save it', async () => {
    const browser = installBrowser();
    const refusing = fakeApi({ saveSubscription: async () => Promise.reject(new Error('400')) });
    await expect(enablePush(refusing.api)).rejects.toThrow('400');
    expect(browser.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(browser.current()).toBeNull();
    expect(await readPushState()).toBe('off');
  });
});

describe('disablePush and syncPush', () => {
  it('removes the subscription from the server and the browser', async () => {
    const browser = installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    const subscription = browser.current()!;
    const { api, removed } = fakeApi();
    expect(await disablePush(api)).toBe('off');
    expect(removed).toEqual([ENDPOINT]);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(await disablePush(api)).toBe('off'); // nothing left to remove
    expect(removed).toHaveLength(1);
  });

  // spec: the browser is unsubscribed even if the server cannot be told
  it('still unsubscribes the browser when the server cannot be reached', async () => {
    const browser = installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    const subscription = browser.current()!;
    const { api } = fakeApi({ removeSubscription: async () => Promise.reject(new Error('offline')) });
    expect(await disablePush(api)).toBe('off');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    installBrowser({ permission: 'denied' });
    expect(await disablePush(api)).toBe('blocked');
  });

  // spec: syncPush acts only when already subscribed with permission; never throws
  it('re-saves an existing subscription for the logged-in user, and otherwise does nothing', async () => {
    const quiet = fakeApi();
    await syncPush(quiet.api); // unsupported
    installBrowser(); // permission not granted
    await syncPush(quiet.api);
    installBrowser({ permission: 'granted' }); // granted but not subscribed
    await syncPush(quiet.api);
    expect(quiet.saved).toEqual([]);

    installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    const { api, saved } = fakeApi();
    await syncPush(api);
    expect(saved).toHaveLength(1);
    await expect(syncPush(fakeApi({ getPublicKey: async () => Promise.reject(new Error('down')) }).api)).resolves.toBeUndefined();
  });
});

describe('the one-time hint', () => {
  it('shows until dismissed, and stays dismissed', () => {
    expect(shouldShowPushHint()).toBe(true);
    dismissPushHint();
    expect(shouldShowPushHint()).toBe(false);
  });

  it('is never shown, and dismissing is harmless, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    expect(shouldShowPushHint()).toBe(false);
    expect(() => dismissPushHint()).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('usePushNotifications', () => {
  function Probe({ api }: { api: PushApi }) {
    const push = usePushNotifications(api);
    return (
      <div>
        <p data-testid="state">{String(push.state)}</p>
        <p data-testid="busy">{String(push.busy)}</p>
        {push.error !== null && <p role="alert">{push.error}</p>}
        <button onClick={() => void push.setEnabled(true)}>on</button>
        <button onClick={() => void push.setEnabled(false)}>off</button>
      </div>
    );
  }

  it('reads the state, then turns notifications on and off', async () => {
    installBrowser();
    const { api, saved, removed } = fakeApi();
    render(<Probe api={api} />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('off'));
    await userEvent.click(screen.getByRole('button', { name: 'on' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('on'));
    expect(saved).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'off' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('off'));
    expect(removed).toHaveLength(1);
    expect(screen.getByTestId('busy')).toHaveTextContent('false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says what to do when turning on or off fails, and shows the true state', async () => {
    const browser = installBrowser();
    render(<Probe api={fakeApi({ getPublicKey: async () => Promise.reject(new Error('down')) }).api} />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('off'));
    await userEvent.click(screen.getByRole('button', { name: 'on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't turn notifications on");
    expect(screen.getByTestId('state')).toHaveTextContent('off');

    browser.serviceWorker.getRegistration.mockRejectedValueOnce(new Error('broken'));
    await userEvent.click(screen.getByRole('button', { name: 'off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't turn notifications off");
  });

  it('is unsupported where there is no Push API or its state cannot be read', async () => {
    const { api } = fakeApi();
    const first = render(<Probe api={api} />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unsupported'));
    first.unmount();
    const browser = installBrowser();
    browser.serviceWorker.getRegistration.mockRejectedValue(new Error('broken'));
    render(<Probe api={api} />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unsupported'));
  });
});

describe('PushBridge', () => {
  function Where() {
    return <p data-testid="path">{useLocation().pathname}</p>;
  }
  function renderBridge(api: Api, userId: string | null) {
    return render(
      <MemoryRouter initialEntries={['/home']}>
        <ApiProvider api={api}>
          <SessionProvider initialUserId={userId}>
            <PushBridge />
            <Routes>
              <Route path="*" element={<Where />} />
            </Routes>
          </SessionProvider>
        </ApiProvider>
      </MemoryRouter>,
    );
  }

  it('goes to the page a clicked notification names, and ignores anything else', async () => {
    const browser = installBrowser();
    const view = renderBridge(createMockApi(), null);
    browser.post({ type: 'do-re:navigate', url: '/chats/a_b' });
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/chats/a_b'));
    for (const data of [{ type: 'do-re:navigate', url: '//evil.example' }, { type: 'do-re:navigate', url: 'https://evil.example' }, { type: 'other', url: '/profile' }, { type: 'do-re:navigate' }, null]) {
      browser.post(data);
    }
    expect(screen.getByTestId('path')).toHaveTextContent('/chats/a_b');
    view.unmount();
    expect(browser.listenerCount()).toBe(0);
  });

  it('re-saves the subscription for a logged-in user only, and does nothing without a Push API', async () => {
    const { api: push, saved } = fakeApi();
    const api = { ...createMockApi(), push };
    renderBridge(api, 'u-demo').unmount(); // no Push API: nothing happens, nothing breaks
    installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    renderBridge(api, null).unmount();
    expect(saved).toEqual([]);
    renderBridge(api, 'u-demo');
    await waitFor(() => expect(saved).toHaveLength(1));
  });
});

describe('the demo', () => {
  it("can't turn notifications on, and says so", async () => {
    const { push } = createMockApi();
    await expect(push.getPublicKey()).rejects.toThrow("demo can't send");
    await expect(push.saveSubscription({ endpoint: ENDPOINT, keys: { p256dh: 'a', auth: 'b' } })).resolves.toBeUndefined();
    await expect(push.removeSubscription(ENDPOINT)).resolves.toBeUndefined();
  });
});
