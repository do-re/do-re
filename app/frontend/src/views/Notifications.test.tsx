/**
 * The Notifications switch on Profile and the one-time hint on Home (src/notifications/push.ts).
 * Push notifications are an extra feature with no requirement ID.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBrowser, KEY, KEY_BYTES, uninstallBrowser } from '../test/fakePush';
import { renderApp } from '../test/renderApp';

afterEach(uninstallBrowser);

const pushSwitch = () => screen.findByRole('switch', { name: 'Notifications' });

/** Renders a page with a push API that works (the demo's own refuses). */
function renderWithPush(path: string) {
  const rendered = renderApp({ path, userId: 'u-demo' });
  const getPublicKey = vi.spyOn(rendered.api.push, 'getPublicKey').mockResolvedValue(KEY);
  const save = vi.spyOn(rendered.api.push, 'saveSubscription').mockResolvedValue();
  const remove = vi.spyOn(rendered.api.push, 'removeSubscription').mockResolvedValue();
  return { ...rendered, getPublicKey, save, remove };
}

describe('Notifications switch on Profile', () => {
  it('is off and disabled, and says why, where the browser cannot show notifications', async () => {
    renderApp({ path: '/profile', userId: 'u-demo' });
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toHaveAccessibleDescription(/can't show notifications.*Home Screen/));
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
  });

  it('is disabled and says how to allow notifications when the browser blocks them', async () => {
    installBrowser({ permission: 'denied' });
    renderApp({ path: '/profile', userId: 'u-demo' });
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toHaveAccessibleDescription(/blocked.*site settings/));
    expect(toggle).toBeDisabled();
  });

  it('turns notifications on and off for this browser', async () => {
    const browser = installBrowser();
    const { save, remove } = renderWithPush('/profile');
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAccessibleDescription(/new matches and messages/);

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(browser.requestPermission).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(remove).toHaveBeenCalledOnce();
  });

  it('becomes blocked when the user refuses the browser prompt', async () => {
    installBrowser({ answer: 'denied' });
    const { save } = renderWithPush('/profile');
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).not.toBeChecked();
    expect(save).not.toHaveBeenCalled();
  });

  it('says what went wrong when it cannot be turned on (as in the demo)', async () => {
    installBrowser();
    renderApp({ path: '/profile', userId: 'u-demo' }); // the demo has no push server
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    expect(await screen.findByText(/Couldn't turn notifications on/)).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  // The next person to log in on this browser must not get this account's notifications.
  it('security_loggingOutRemovesThisBrowsersSubscriptionFirst', async () => {
    const browser = installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    const subscription = browser.current()!;
    const { remove } = renderWithPush('/profile');
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(remove).toHaveBeenCalledOnce();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('still logs out when the subscription cannot be removed', async () => {
    const browser = installBrowser({ permission: 'granted', subscribedWith: KEY_BYTES });
    renderWithPush('/profile');
    const toggle = await pushSwitch();
    await waitFor(() => expect(toggle).toBeChecked());
    browser.serviceWorker.getRegistration.mockRejectedValue(new Error('broken'));
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('Notifications hint on Home', () => {
  const hint = () => screen.queryByRole('complementary', { name: 'Notifications' });

  it('offers once to turn notifications on, and turns them on from there', async () => {
    const browser = installBrowser();
    const { save, unmount } = renderWithPush('/home');
    await waitFor(() => expect(hint()).toBeInTheDocument());
    expect(hint()).toHaveTextContent('Get notified about matches and messages.');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(hint()).not.toBeInTheDocument());
    expect(browser.requestPermission).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();

    unmount();
    renderWithPush('/home'); // not offered again
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(hint()).not.toBeInTheDocument();
  });

  it('goes away for good on "Not now"', async () => {
    const browser = installBrowser();
    const { unmount } = renderWithPush('/home');
    await waitFor(() => expect(hint()).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(hint()).not.toBeInTheDocument();
    expect(browser.requestPermission).not.toHaveBeenCalled();
    unmount();
    renderWithPush('/home');
    await screen.findByRole('heading', { name: 'Home' });
    await waitFor(() => expect(browser.serviceWorker.getRegistration).toHaveBeenCalled());
    expect(hint()).not.toBeInTheDocument();
  });

  it('is not shown where notifications are unsupported, blocked or already on', async () => {
    const first = renderWithPush('/home'); // jsdom: unsupported
    await screen.findByRole('heading', { name: 'Home' });
    expect(hint()).not.toBeInTheDocument();
    first.unmount();
    for (const options of [{ permission: 'denied' as const }, { permission: 'granted' as const, subscribedWith: KEY_BYTES }]) {
      const browser = installBrowser(options);
      const view = renderWithPush('/home');
      await screen.findByRole('heading', { name: 'Home' });
      if (options.permission === 'granted') await waitFor(() => expect(browser.pushManager.getSubscription).toHaveBeenCalled());
      expect(hint()).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
