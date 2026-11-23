import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import { createMockApi } from '../api/mock';
import type { LoginResponse } from '../api/types';
import { SessionProvider } from '../session/SessionContext';
import { renderApp } from '../test/renderApp';
import { LoginView } from './LoginView';
import { safeRedirect, validateLogin } from './authLogic';

const DEMO = { email: 'demo@do-re.test', password: 'demo-pass-1' };

const emailBox = () => screen.getByLabelText('Email');
const passwordBox = () => screen.getByLabelText('Password');
const submitButton = () => screen.getByRole('button', { name: /log in|logging in/i });

async function logIn(email: string, password: string) {
  if (email !== '') await userEvent.type(emailBox(), email);
  if (password !== '') await userEvent.type(passwordBox(), password);
  await userEvent.click(submitButton());
}

describe('LoginView layout', () => {
  it('R_ACC_03 prompts for email and password with the right input types and autocomplete', () => {
    renderApp({ path: '/login' });
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(emailBox()).toHaveAttribute('type', 'email');
    expect(emailBox()).toHaveAttribute('autocomplete', 'email');
    expect(passwordBox()).toHaveAttribute('type', 'password');
    expect(passwordBox()).toHaveAttribute('autocomplete', 'current-password');
    expect(submitButton()).toHaveAttribute('type', 'submit');
    expect(emailBox().closest('form')).not.toBeNull();
  });
});

describe('LoginView successful login', () => {
  it('R_ACC_01 R_ACC_06 correct credentials open the home page and start a session', async () => {
    renderApp({ path: '/login' });
    await logIn(DEMO.email, DEMO.password);
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(sessionStorage.getItem('do-re.userId')).toBe('u-demo');
  });

  it('R_ACC_01 pressing Enter in the password box submits', async () => {
    renderApp({ path: '/login' });
    await userEvent.type(emailBox(), DEMO.email);
    await userEvent.type(passwordBox(), `${DEMO.password}{Enter}`);
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('R_ACC_06 returns the user to the page they were sent away from', async () => {
    renderApp({ path: '/profile' }); // logged out: redirected to /login with from=/profile
    await logIn(DEMO.email, DEMO.password);
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });

  it('trims spaces around the email before sending it', async () => {
    const { api } = renderApp({ path: '/login' });
    const login = vi.spyOn(api.account, 'login');
    await logIn(`  ${DEMO.email}  `, DEMO.password);
    expect(login).toHaveBeenCalledWith(DEMO.email, DEMO.password);
  });

  it('redirects an already logged-in user to home', () => {
    renderApp({ path: '/login', userId: 'u-demo' });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});

describe('LoginView error popups', () => {
  it.each([
    ['R_ACC_05 wrong password', DEMO.email, 'wrong-password'],
    ['R_ACC_05 no account', 'ghost@do-re.test', 'anything'],
  ])('%s shows "Email or password is incorrect", keeps the email and clears the password', async (_, email, password) => {
    renderApp({ path: '/login' });
    await logIn(email, password);
    const dialog = await screen.findByRole('dialog', { name: /email or password is incorrect/i });
    expect(dialog).toBeInTheDocument();
    expect(emailBox()).toHaveValue(email);
    expect(passwordBox()).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('R_SEC_03 an unverified account shows "Account not verified, please try again" and stays on login', async () => {
    renderApp({ path: '/login' });
    await logIn('unverified@do-re.test', 'demo-pass-1');
    const dialog = await screen.findByRole('dialog', { name: /account not verified/i });
    expect(within(dialog).getByText(/account not verified, please try again/i)).toHaveTextContent('unverified@do-re.test');
    expect(passwordBox()).toHaveValue('');
    expect(sessionStorage.getItem('do-re.userId')).toBeNull();
  });

  it('R_ACC_05 OK closes the popup and puts focus in the password box', async () => {
    renderApp({ path: '/login' });
    await logIn(DEMO.email, 'wrong-password');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(passwordBox()).toHaveFocus();
  });

  it('Escape closes the popup', async () => {
    renderApp({ path: '/login' });
    await logIn(DEMO.email, 'wrong-password');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a server that cannot be reached shows a connection popup', async () => {
    const { api } = renderApp({ path: '/login' });
    vi.spyOn(api.account, 'login').mockRejectedValue(new Error('network down'));
    await logIn(DEMO.email, DEMO.password);
    expect(await screen.findByRole('dialog', { name: /couldn't log in/i })).toHaveTextContent(/check your connection/i);
    expect(passwordBox()).toHaveValue('');
    expect(submitButton()).toBeEnabled();
  });
});

describe('LoginView pending state', () => {
  it('disables the button while waiting, and one press sends one request', async () => {
    const { api } = renderApp({ path: '/login' });
    let resolve!: (r: LoginResponse) => void;
    const login = vi
      .spyOn(api.account, 'login')
      .mockReturnValue(new Promise<LoginResponse>((r) => (resolve = r)));

    await logIn(DEMO.email, DEMO.password);
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent('Logging in…');
    await userEvent.type(passwordBox(), '{Enter}'); // Enter while pending is ignored
    expect(login).toHaveBeenCalledTimes(1);

    resolve({ result: 'WRONG_PASSWORD' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });
});

describe('LoginView client-side checks', () => {
  it.each([
    ['empty email', '', 'pw', 'Email', /enter your email address/i],
    ['malformed email', 'not-an-email', 'pw', 'Email', /like name@example\.com/i],
    ['empty password', DEMO.email, '', 'Password', /enter your password/i],
  ])('R_ACC_03 %s shows what to fix, focuses the field and sends nothing', async (_, email, password, label, message) => {
    const { api } = renderApp({ path: '/login' });
    const login = vi.spyOn(api.account, 'login');
    await logIn(email, password);
    const field = screen.getByLabelText(label);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(message);
    expect(field).toHaveFocus();
    expect(login).not.toHaveBeenCalled();
  });

  it('clears a field error once the user edits that field', async () => {
    renderApp({ path: '/login' });
    await userEvent.click(submitButton());
    expect(emailBox()).toHaveAttribute('aria-invalid', 'true');
    expect(passwordBox()).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(emailBox(), 'a');
    expect(emailBox()).toHaveAttribute('aria-invalid', 'false');
    expect(passwordBox()).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(passwordBox(), 'b');
    expect(passwordBox()).toHaveAttribute('aria-invalid', 'false');
    await userEvent.type(emailBox(), 'b'); // editing with no error leaves things as they are
    expect(emailBox()).toHaveAttribute('aria-invalid', 'false');
  });

  it('validateLogin covers each partition', () => {
    expect(validateLogin('a@b.co', 'x')).toEqual({});
    expect(validateLogin('   ', 'x')).toEqual({ email: 'Enter your email address.' });
    expect(validateLogin('a@b', '')).toEqual({
      email: 'Enter an email address like name@example.com.',
      password: 'Enter your password.',
    });
  });
});

describe('LoginView create-account link', () => {
  it('R_ACC_02 opens the Create a New Account page', async () => {
    renderApp({ path: '/login' });
    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  });

  it('R_ACC_02 passes the typed email so the sign-up page can pre-fill it', async () => {
    function SignupProbe() {
      const state = useLocation().state as { email?: string } | null;
      return <p>prefill: {state?.email}</p>;
    }
    render(
      <ApiProvider api={createMockApi()}>
        <SessionProvider initialUserId={null}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<LoginView />} />
              <Route path="/signup" element={<SignupProbe />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </ApiProvider>,
    );
    await userEvent.type(emailBox(), ' new@do-re.test ');
    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(screen.getByText('prefill: new@do-re.test')).toBeInTheDocument();
  });
});

describe('safeRedirect', () => {
  it.each([
    ['/profile', '/profile'],
    ['/match/m-1', '/match/m-1'],
    [undefined, '/home'],
    [42, '/home'],
    ['https://evil.example', '/home'],
    ['//evil.example', '/home'],
    ['/login', '/home'],
    ['/signup', '/home'],
  ])('%s -> %s', (from, expected) => {
    expect(safeRedirect(from)).toBe(expected);
  });
});
