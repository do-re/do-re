import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useApi } from './api/ApiContext';
import { PATHS } from './paths';
import { SessionProvider, useSession } from './session/SessionContext';
import { renderApp } from './test/renderApp';

describe('routes', () => {
  it.each([
    ['/login', 'Log in'],
    ['/signup', 'Create an account'],
  ])('R_UI_04 %s is reachable logged out and has no bottom bar (OPEN-10)', (path, heading) => {
    renderApp({ path });
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it.each([
    ['/home', 'Home'],
    ['/profile', 'Profile'],
    ['/match/m-seed', 'Match'],
    ['/chats', 'Messages'],
    ['/chats/c-1', 'Chat'],
  ])('R_UI_04 %s shows the bottom bar when logged in', (path, heading) => {
    renderApp({ path, userId: 'u-demo' });
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it.each(['/home', '/profile', '/match/m-seed'])('R_SEC_03 %s redirects to /login when logged out', (path) => {
    renderApp({ path });
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it.each(['/', '/nowhere'])('%s goes to home (or login when logged out)', (path) => {
    renderApp({ path, userId: 'u-demo' });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('R_UI_05 bottom bar navigates between home and profile', async () => {
    renderApp({ path: '/home', userId: 'u-demo' });
    await userEvent.click(screen.getByRole('link', { name: 'Profile' }));
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('PATHS encodes IDs', () => {
    expect(PATHS.match('a/b')).toBe('/match/a%2Fb');
    expect(PATHS.chat('c 1')).toBe('/chats/c%201');
  });
});

describe('SessionProvider', () => {
  function Probe() {
    const { userId, logIn, logOut } = useSession();
    return (
      <>
        <p>user: {userId ?? 'none'}</p>
        <button onClick={() => logIn('u-1')}>in</button>
        <button onClick={logOut}>out</button>
      </>
    );
  }

  it('remembers the user in sessionStorage across remounts and forgets on logout', async () => {
    const first = render(<SessionProvider><Probe /></SessionProvider>);
    expect(screen.getByText('user: none')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'in' }));
    expect(screen.getByText('user: u-1')).toBeInTheDocument();
    first.unmount();

    render(<SessionProvider><Probe /></SessionProvider>);
    expect(screen.getByText('user: u-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'out' }));
    expect(screen.getByText('user: none')).toBeInTheDocument();
    expect(sessionStorage.getItem('do-re.userId')).toBeNull();
  });

  it('still works when storage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      render(<SessionProvider><Probe /></SessionProvider>);
      expect(screen.getByText('user: none')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'in' }));
      expect(screen.getByText('user: u-1')).toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('useSession and useApi throw outside their providers', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    function UsesSession() {
      useSession();
      return null;
    }
    function UsesApi() {
      useApi();
      return null;
    }
    try {
      expect(() => render(<UsesSession />)).toThrow(/SessionProvider/);
      expect(() => render(<MemoryRouter><UsesApi /></MemoryRouter>)).toThrow(/ApiProvider/);
    } finally {
      quiet.mockRestore();
    }
  });
});
