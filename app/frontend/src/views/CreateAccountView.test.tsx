import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateAccountResult } from '../api/types';
import { renderApp } from '../test/renderApp';
import { readAuthNavState, validateSignup, VERIFY_POLL_MS } from './authLogic';

const NEW_EMAIL = 'new@do-re.test';
const PW = 'new-pass-1';

// Fake timers drive the verification polling; user-event advances them while typing.
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
});
afterEach(() => {
  vi.useRealTimers();
});

const emailBox = () => screen.getByLabelText('Email');
const passwordBox = () => screen.getByLabelText('Password');
const confirmBox = () => screen.getByLabelText('Confirm password');
const createButton = () => screen.getByRole('button', { name: /create account|creating account/i });

async function signUp(email: string, password: string, confirm: string) {
  if (email !== '') await user.type(emailBox(), email);
  if (password !== '') await user.type(passwordBox(), password);
  if (confirm !== '') await user.type(confirmBox(), confirm);
  await user.click(createButton());
}

/** Lets one polling interval pass, and the check it triggers settle. */
async function pollOnce() {
  await act(() => vi.advanceTimersByTimeAsync(VERIFY_POLL_MS));
}

describe('CreateAccountView layout', () => {
  it('R_ACC_07 R_ACC_08 prompts for email, password and password confirmation', () => {
    renderApp({ path: '/signup' });
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(emailBox()).toHaveAttribute('type', 'email');
    expect(emailBox()).toHaveAttribute('autocomplete', 'email');
    expect(emailBox()).toHaveValue('');
    for (const box of [passwordBox(), confirmBox()]) {
      expect(box).toHaveAttribute('type', 'password');
      expect(box).toHaveAttribute('autocomplete', 'new-password');
      expect(box).toHaveValue('');
    }
    expect(createButton()).toHaveAttribute('type', 'submit');
  });

  it('R_ACC_10 shows terms of service describing the policy against fake accounts', () => {
    renderApp({ path: '/signup' });
    const terms = screen.getByRole('region', { name: 'Terms of service' });
    expect(terms).toBeVisible();
    expect(terms).toHaveTextContent(/fake/i);
  });

  it('R_ACC_02 R_ACC_07 pre-fills the email typed on the login page', async () => {
    renderApp({ path: '/login' });
    await user.type(screen.getByLabelText('Email'), NEW_EMAIL);
    await user.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(emailBox()).toHaveValue(NEW_EMAIL);
    expect(passwordBox()).toHaveValue('');
  });

  it('"Back to login" returns to the login page with the typed email', async () => {
    renderApp({ path: '/signup' });
    await user.type(emailBox(), NEW_EMAIL);
    await user.click(screen.getByRole('link', { name: 'Back to login' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue(NEW_EMAIL);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('redirects a logged-in user to home', () => {
    renderApp({ path: '/signup', userId: 'u-demo' });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});

describe('CreateAccountView successful sign-up', () => {
  it('R_ACC_09 R_SEC_01 creates an unverified account and shows the "check your email" popup', async () => {
    const { api } = renderApp({ path: '/signup' });
    const create = vi.spyOn(api.account, 'createAccount');
    await signUp(`  ${NEW_EMAIL} `, PW, PW);

    expect(create).toHaveBeenCalledWith(NEW_EMAIL, PW, PW);
    const dialog = await screen.findByRole('dialog', { name: 'Check your email' });
    expect(dialog).toHaveTextContent(`We sent a verification link to ${NEW_EMAIL}`);
    expect(within(dialog).getByRole('button', { name: 'Back to login' })).toHaveFocus();
    expect(passwordBox()).toHaveValue('');
    expect(confirmBox()).toHaveValue('');
    expect((await api.account.login(NEW_EMAIL, PW)).result).toBe('NOT_VERIFIED');
  });

  it('R_SEC_02 once the link is clicked, moves to login with the email and a verified notice', async () => {
    const { api } = renderApp({ path: '/signup' });
    await signUp(NEW_EMAIL, PW, PW);
    await screen.findByRole('dialog', { name: 'Check your email' });

    await pollOnce(); // not verified yet: still waiting
    expect(screen.getByRole('dialog', { name: 'Check your email' })).toBeInTheDocument();

    api.backend.verifyEmail(NEW_EMAIL); // the user clicks the emailed link
    await pollOnce();
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/your email is verified/i);
    expect(screen.getByLabelText('Email')).toHaveValue(NEW_EMAIL);
  });

  it('R_SEC_02 R_ACC_01 the new account can log in after verification', async () => {
    const { api } = renderApp({ path: '/signup' });
    await signUp(NEW_EMAIL, PW, PW);
    await screen.findByRole('dialog');
    api.backend.verifyEmail(NEW_EMAIL);
    await pollOnce();
    await user.type(screen.getByLabelText('Password'), `${PW}{Enter}`);
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('keeps polling after a failed check', async () => {
    const { api } = renderApp({ path: '/signup' });
    await signUp(NEW_EMAIL, PW, PW);
    await screen.findByRole('dialog');
    const isVerified = vi.spyOn(api.account, 'isVerified').mockRejectedValueOnce(new Error('offline'));
    await pollOnce();
    expect(isVerified).toHaveBeenCalledTimes(1);
    api.backend.verifyEmail(NEW_EMAIL);
    await pollOnce();
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('R_SEC_03 closing the popup with Escape stops waiting and stays on the page', async () => {
    const { api } = renderApp({ path: '/signup' });
    await signUp(NEW_EMAIL, PW, PW);
    await screen.findByRole('dialog');
    const isVerified = vi.spyOn(api.account, 'isVerified');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(emailBox()).toHaveFocus();

    api.backend.verifyEmail(NEW_EMAIL);
    await pollOnce();
    await pollOnce();
    expect(isVerified).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  });

  it('the popup\'s "Back to login" button opens login with the email, without the verified notice', async () => {
    renderApp({ path: '/signup' });
    await signUp(NEW_EMAIL, PW, PW);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Back to login' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue(NEW_EMAIL);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('CreateAccountView error popups', () => {
  it('EMAIL_IN_USE names the problem, keeps the email, clears both passwords', async () => {
    renderApp({ path: '/signup' });
    await signUp('demo@do-re.test', PW, PW);
    const dialog = await screen.findByRole('dialog', { name: 'Email already in use' });
    expect(dialog).toHaveTextContent('An account already uses demo@do-re.test');
    expect(emailBox()).toHaveValue('demo@do-re.test');
    expect(passwordBox()).toHaveValue('');
    expect(confirmBox()).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(emailBox()).toHaveFocus();
  });

  it('EMAIL_IN_USE offers "Log in instead", which opens login with the email', async () => {
    renderApp({ path: '/signup' });
    await signUp('demo@do-re.test', PW, PW);
    await user.click(await screen.findByRole('button', { name: 'Log in instead' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('demo@do-re.test');
  });

  // The client checks catch these first; the server is still the authority, so its answers
  // must be shown if they ever disagree.
  it.each<[CreateAccountResult, RegExp, string]>([
    ['INVALID_EMAIL', /isn't valid/i, 'Email'],
    ['PASSWORDS_DO_NOT_MATCH', /passwords don't match/i, 'Password'],
  ])('R_ACC_08 server answer %s shows its popup and returns focus to the field to fix', async (result, title, field) => {
    const { api } = renderApp({ path: '/signup' });
    vi.spyOn(api.account, 'createAccount').mockResolvedValue(result);
    await signUp(NEW_EMAIL, PW, PW);
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(within(dialog).queryByRole('button', { name: 'Log in instead' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText(field)).toHaveFocus();
  });

  it('a server that cannot be reached shows a connection popup', async () => {
    const { api } = renderApp({ path: '/signup' });
    vi.spyOn(api.account, 'createAccount').mockRejectedValue(new Error('offline'));
    await signUp(NEW_EMAIL, PW, PW);
    expect(await screen.findByRole('dialog', { name: /couldn't create your account/i })).toHaveTextContent(
      /check your connection/i,
    );
    expect(createButton()).toBeEnabled();
  });
});

describe('CreateAccountView pending state', () => {
  it('R_ACC_09 disables the button while waiting, so one press creates at most one account', async () => {
    const { api } = renderApp({ path: '/signup' });
    let resolve!: (r: CreateAccountResult) => void;
    const create = vi
      .spyOn(api.account, 'createAccount')
      .mockReturnValue(new Promise<CreateAccountResult>((r) => (resolve = r)));
    await signUp(NEW_EMAIL, PW, PW);
    expect(createButton()).toBeDisabled();
    expect(createButton()).toHaveTextContent('Creating account…');
    await user.type(confirmBox(), '{Enter}');
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => resolve('PENDING_VERIFICATION'));
    expect(screen.getByRole('dialog', { name: 'Check your email' })).toBeInTheDocument();
  });
});

describe('CreateAccountView client-side checks', () => {
  it.each([
    ['empty email', '', PW, PW, 'Email', /enter your email address/i],
    ['malformed email', 'nope', PW, PW, 'Email', /like name@example\.com/i],
    ['empty password', NEW_EMAIL, '', '', 'Password', /choose a password/i],
    ['missing confirmation', NEW_EMAIL, PW, '', 'Confirm password', /type your password again/i],
    ['mismatched confirmation', NEW_EMAIL, PW, 'other', 'Confirm password', /don't match/i],
  ])('R_ACC_08 %s shows what to fix, focuses the field and sends nothing', async (_, email, pw, confirm, field, message) => {
    const { api } = renderApp({ path: '/signup' });
    const create = vi.spyOn(api.account, 'createAccount');
    await signUp(email, pw, confirm);
    const box = screen.getByLabelText(field);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(message);
    expect(box).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it('clears a field error once the user edits that field', async () => {
    renderApp({ path: '/signup' });
    await signUp(NEW_EMAIL, PW, 'x');
    expect(confirmBox()).toHaveAttribute('aria-invalid', 'true');
    await user.type(confirmBox(), 'y');
    expect(confirmBox()).toHaveAttribute('aria-invalid', 'false');
  });
});

describe('validateSignup', () => {
  it('accepts a well-formed email with matching non-empty passwords', () => {
    expect(validateSignup('a@b.co', 'pw', 'pw')).toEqual({});
  });

  it('reports every invalid field at once', () => {
    expect(validateSignup('bad', '', '')).toEqual({
      email: 'Enter an email address like name@example.com.',
      password: 'Choose a password.',
    });
    expect(validateSignup('', 'pw', 'nope')).toEqual({
      email: 'Enter your email address.',
      confirmPassword: "Passwords don't match. Type the same password in both boxes.",
    });
  });

  it('does not flag the confirmation while the password itself is empty', () => {
    expect(validateSignup('a@b.co', '', 'x')).toEqual({ password: 'Choose a password.' });
  });
});

describe('readAuthNavState', () => {
  it.each([
    [null, { email: '', verified: false, from: undefined }],
    ['text', { email: '', verified: false, from: undefined }],
    [{ email: 42, verified: 'yes' }, { email: '', verified: false, from: undefined }],
    [{ email: 'a@b.co', verified: true, from: '/profile' }, { email: 'a@b.co', verified: true, from: '/profile' }],
  ])('%j', (state, expected) => {
    expect(readAuthNavState(state)).toEqual(expected);
  });
});
