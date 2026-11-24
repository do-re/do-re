/**
 * CreateAccountView: the /signup page (architecture-stubs-v2.java CreateAccountView; its own
 * page per OPEN-3). Email (pre-filled from /login), password, confirm password, the terms of
 * service on fake accounts, a "Create account" button and a "Back to login" link. Errors and
 * the "check your email" confirmation are popups on this page. No bottom bar (OPEN-10).
 *
 * Satisfies: R-ACC-02, R-ACC-07, R-ACC-08, R-ACC-09, R-ACC-10, R-SEC-01, R-SEC-02, R-SEC-03.
 * Communicates with: AccountController (via useApi().account), ViewController (via the router).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import type { CreateAccountResult } from '../api/types';
import { Modal } from '../components/Modal';
import { TextField, Wordmark } from '../components/TextField';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './auth.css';
import { readAuthNavState, validateSignup, VERIFY_POLL_MS, type FieldErrors } from './authLogic';

type ErrorKind = Exclude<CreateAccountResult, 'PENDING_VERIFICATION'> | 'NETWORK';

/** The popup on screen, with the email it is about. */
type Popup = { kind: 'VERIFY'; email: string } | { kind: ErrorKind; email: string };

/**
 * The /signup page.
 * Requires: rendered inside ApiProvider, SessionProvider and a router.
 * Effects: if someone is logged in, redirects to home; otherwise shows the sign-up form with
 *          the email box pre-filled from router state (stub showWithEmail), both password boxes
 *          empty and the terms of service visible.
 */
export function CreateAccountView() {
  const api = useApi();
  const session = useSession();
  const navigate = useNavigate();
  const navState = readAuthNavState(useLocation().state);

  const [email, setEmail] = useState(navState.email);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  /**
   * While the verification popup is open, asks the server every VERIFY_POLL_MS whether the
   * account is verified (stub awaitEmailVerification).
   * Satisfies: R-SEC-02, R-SEC-03.
   * Effects: once verified, opens the login page with the email pre-filled and a "verified"
   *          notice; stops when the popup closes or the page is left. A failed check is
   *          retried on the next tick.
   */
  useEffect(() => {
    if (popup?.kind !== 'VERIFY') return;
    const verifyingEmail = popup.email;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        if (await api.account.isVerified(verifyingEmail)) {
          if (!cancelled) navigate(PATHS.login, { state: { email: verifyingEmail, verified: true } });
          return;
        }
      } catch {
        // Network hiccup: try again on the next tick.
      }
      if (!cancelled) timer = setTimeout(check, VERIFY_POLL_MS);
    }

    timer = setTimeout(check, VERIFY_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [popup, api, navigate]);

  if (session.userId !== null) {
    return <Navigate to={PATHS.home} replace />;
  }

  /**
   * Handles the "Create account" button or the Enter key in any box (stub
   * onCreateAccountPressed).
   * Satisfies: R-ACC-02, R-ACC-08, R-ACC-09, R-SEC-01.
   * Requires: none.
   * Effects: if a field is invalid, shows what to fix next to each invalid field and focuses
   *          the first, sending nothing. Otherwise disables the button until the reply arrives
   *          (so one press creates at most one account) and sends the three boxes to
   *          AccountController.createAccount; then on PENDING_VERIFICATION shows the
   *          verification popup; on INVALID_EMAIL, PASSWORDS_DO_NOT_MATCH, EMAIL_IN_USE or a
   *          network failure shows an error popup naming the problem. Afterwards the email is
   *          kept and both password boxes are cleared.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const errors = validateSignup(email, password, confirmPassword);
    setFieldErrors(errors);
    const firstInvalid =
      errors.email !== undefined ? emailRef : errors.password !== undefined ? passwordRef
        : errors.confirmPassword !== undefined ? confirmRef : null;
    if (firstInvalid !== null) {
      firstInvalid.current?.focus();
      return;
    }

    const trimmed = email.trim();
    setPending(true);
    try {
      const result = await api.account.createAccount(trimmed, password, confirmPassword);
      setPopup({ kind: result === 'PENDING_VERIFICATION' ? 'VERIFY' : result, email: trimmed });
    } catch {
      setPopup({ kind: 'NETWORK', email: trimmed });
    } finally {
      setPassword('');
      setConfirmPassword('');
      setPending(false);
    }
  }

  function edit(field: keyof FieldErrors, setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      if (fieldErrors[field] !== undefined) setFieldErrors({ ...fieldErrors, [field]: undefined });
    };
  }

  const closePopup = () => setPopup(null);
  const toLogin = (withEmail: string) => navigate(PATHS.login, { state: { email: withEmail } });
  const demoLink = popup?.kind === 'VERIFY' ? (api.demo?.verificationLinkFor(popup.email) ?? null) : null;

  return (
    <main className="page auth-page">
      <Wordmark />
      <h1 className="auth-page__title">Create an account</h1>

      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <TextField
          id="signup-email"
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
          id="signup-password"
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onValueChange={edit('password', setPassword)}
          error={fieldErrors.password}
          inputRef={passwordRef}
        />
        <TextField
          id="signup-confirm-password"
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onValueChange={edit('confirmPassword', setConfirmPassword)}
          error={fieldErrors.confirmPassword}
          inputRef={confirmRef}
        />

        <section className="terms" aria-labelledby="terms-title">
          <h2 id="terms-title" className="terms__title">Terms of service</h2>
          <p>
            Do~Re is for real people. One account per person: fake, impersonating or automated
            accounts are not allowed and will be removed. By creating an account, you agree to
            these terms.
          </p>
        </section>

        <button type="submit" className="button-primary" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="auth-page__switch">
        Already have an account?{' '}
        <Link to={PATHS.login} state={{ email: email.trim() }}>
          Back to login
        </Link>
      </p>

      {popup?.kind === 'VERIFY' && (
        <Modal title="Check your email" onClose={closePopup} returnFocusTo={emailRef}>
          <p>
            We sent a verification link to <strong>{popup.email}</strong>. Open it to activate your
            account, then log in. This page moves on by itself once you're verified.
          </p>
          <button type="button" className="button-primary" onClick={() => toLogin(popup.email)}>
            Back to login
          </button>
          {demoLink !== null && (
            <p className="auth-page__demo">
              Demo mode can't send real email. <Link to={demoLink}>Open your verification link</Link>
            </p>
          )}
        </Modal>
      )}

      {popup !== null && popup.kind !== 'VERIFY' && (
        <Modal
          title={ERROR_TEXT[popup.kind].title}
          tone="error"
          onClose={closePopup}
          returnFocusTo={ERROR_TEXT[popup.kind].fixEmail ? emailRef : passwordRef}
        >
          <p>{ERROR_TEXT[popup.kind].body(popup.email)}</p>
          <div className="modal__actions">
            {popup.kind === 'EMAIL_IN_USE' && (
              <button type="button" className="button-secondary" onClick={() => toLogin(popup.email)}>
                Log in instead
              </button>
            )}
            <button type="button" className="button-primary" onClick={closePopup}>
              OK
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

/**
 * Error popup wording; each names the problem and says what to do (CLAUDE.md).
 * fixEmail: focus goes back to the email box (true) or the password box (false) on close.
 */
const ERROR_TEXT: Record<ErrorKind, { title: string; body: (email: string) => string; fixEmail: boolean }> = {
  INVALID_EMAIL: {
    title: "That email address isn't valid",
    body: () => 'Enter an email address like name@example.com.',
    fixEmail: true,
  },
  PASSWORDS_DO_NOT_MATCH: {
    title: "Passwords don't match",
    body: () => 'Type the same password in both password boxes.',
    fixEmail: false,
  },
  EMAIL_IN_USE: {
    title: 'Email already in use',
    body: (email) => `An account already uses ${email}. Log in instead, or use a different email.`,
    fixEmail: true,
  },
  NETWORK: {
    title: "Couldn't create your account",
    body: () => "We couldn't reach the server. Check your connection and try again.",
    fixEmail: false,
  },
};
