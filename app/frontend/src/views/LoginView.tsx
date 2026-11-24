/**
 * LoginView: the /login page (architecture-stubs-v2.java LoginView; layout from the UI sketch).
 * Email box, password box, Enter (arrow) button and a "Create an account" link. Results that
 * the server reports appear as popups on this page.
 * Email only, no username (OPEN-9, assumed). No bottom bar (OPEN-10, assumed).
 *
 * Satisfies: R-ACC-01, R-ACC-02 (link), R-ACC-03, R-ACC-05, R-ACC-06, R-SEC-03.
 * Communicates with: AccountController (via useApi().account), ViewController (via the router
 * and the session).
 */
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import type { LoginResult } from '../api/types';
import { Modal } from '../components/Modal';
import { TextField, Wordmark } from '../components/TextField';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './auth.css';
import { readAuthNavState, safeRedirect, validateLogin, type FieldErrors } from './authLogic';

/** A popup to show: the result that caused it, or a failure to reach the server. */
type Popup = Exclude<LoginResult, 'SUCCESS'> | 'NETWORK';

/**
 * The /login page.
 * Requires: rendered inside ApiProvider, SessionProvider and a router.
 * Effects: if someone is already logged in, redirects to home; otherwise shows the login form,
 *          with the email pre-filled and a "verified" notice when the router state carries them
 *          (arriving from CreateAccountView).
 */
export function LoginView() {
  const api = useApi();
  const session = useSession();
  const navState = readAuthNavState(useLocation().state);

  const [email, setEmail] = useState(navState.email);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState('');

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (session.userId !== null) {
    return <Navigate to={safeRedirect(navState.from)} replace />;
  }

  /**
   * Handles the Enter button or the Enter key in either box (stub onEnterPressed).
   * Satisfies: R-ACC-01, R-ACC-03, R-ACC-05, R-ACC-06, R-SEC-03.
   * Requires: none.
   * Effects: if a field is invalid, shows what to fix next to it and focuses it, sending
   *          nothing. Otherwise disables the button until the reply arrives; then on SUCCESS
   *          logs the user in and opens the page they were going to (home by default); on
   *          NOT_VERIFIED, NO_ACCOUNT, WRONG_PASSWORD or a network failure shows the matching
   *          popup. On any error the typed email is kept and the password box is cleared.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const errors = validateLogin(email, password);
    setFieldErrors(errors);
    if (errors.email !== undefined) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password !== undefined) {
      passwordRef.current?.focus();
      return;
    }

    const trimmed = email.trim();
    setPending(true);
    try {
      const response = await api.account.login(trimmed, password);
      if (response.result === 'SUCCESS') {
        // The re-render sees the session and redirects (the <Navigate> above).
        session.logIn(response.userId, response.token);
        return;
      }
      showError(response.result, trimmed);
    } catch {
      showError('NETWORK', trimmed);
    } finally {
      setPending(false);
    }
  }

  function showError(kind: Popup, forEmail: string) {
    setPassword('');
    setSubmittedEmail(forEmail);
    setPopup(kind);
  }

  function edit(field: keyof FieldErrors, setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      if (fieldErrors[field] !== undefined) setFieldErrors({ ...fieldErrors, [field]: undefined });
    };
  }

  const closePopup = () => setPopup(null);

  return (
    <main className="page auth-page">
      <Wordmark />
      <h1 className="auth-page__title">Log in</h1>

      {navState.verified && (
        <p className="auth-page__notice" role="status">
          Your email is verified. Log in to start swiping.
        </p>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <TextField
          id="login-email"
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onValueChange={edit('email', setEmail)}
          error={fieldErrors.email}
          inputRef={emailRef}
        />
        <TextField
          id="login-password"
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onValueChange={edit('password', setPassword)}
          error={fieldErrors.password}
          inputRef={passwordRef}
        />
        <button type="submit" className="button-primary" disabled={pending}>
          {pending ? 'Logging in…' : 'Log in'}
          {!pending && <span aria-hidden="true"> →</span>}
        </button>
      </form>

      <p className="auth-page__switch">
        New to Do~Re?{' '}
        <Link to={PATHS.signup} state={{ email: email.trim() }}>
          Create an account
        </Link>
      </p>

      {popup !== null && (
        <Modal title={POPUP_TEXT[popup].title} tone="error" onClose={closePopup} returnFocusTo={passwordRef}>
          <p>{POPUP_TEXT[popup].body(submittedEmail)}</p>
          <button type="button" className="button-primary" onClick={closePopup}>
            OK
          </button>
        </Modal>
      )}
    </main>
  );
}

/** Popup wording. Each body says what to do next (CLAUDE.md: error text says what to fix). */
const POPUP_TEXT: Record<Popup, { title: string; body: (email: string) => string }> = {
  NOT_VERIFIED: {
    title: 'Account not verified',
    body: (email) =>
      `Account not verified, please try again after opening the verification link we emailed to ${email}.`,
  },
  // Same message for both, so the page doesn't reveal which emails have accounts.
  WRONG_PASSWORD: {
    title: 'Email or password is incorrect',
    body: () => 'Check your email and password and try again, or create an account.',
  },
  NO_ACCOUNT: {
    title: 'Email or password is incorrect',
    body: () => 'Check your email and password and try again, or create an account.',
  },
  NETWORK: {
    title: "Couldn't log in",
    body: () => "We couldn't reach the server. Check your connection and try again.",
  },
};
