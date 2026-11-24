/**
 * VerifyEmailView: the /verify page that the link in a confirmation email opens
 * (/verify?userId=...&token=...). It activates the account and sends the user to log in.
 * No bottom bar, since nobody is logged in yet (OPEN-10).
 *
 * Satisfies: R-SEC-02.
 * Communicates with: AccountController (via useApi().account), ViewController (via the router).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { Wordmark } from '../components/TextField';
import { PATHS } from '../paths';
import './auth.css';

type VerifyState = 'checking' | 'verified' | 'invalid' | 'failed';

/**
 * The /verify page.
 * Requires: rendered inside ApiProvider and a router.
 * Effects: sends the link's user ID and token to AccountController.confirmEmail once per attempt
 *          (the token is single-use, so React's development double-render must not send it twice)
 *          and shows the outcome. A link without both values is invalid.
 */
export function VerifyEmailView() {
  const api = useApi();
  const [params] = useSearchParams();
  const userId = params.get('userId');
  const token = params.get('token');

  const [state, setState] = useState<VerifyState>(userId && token ? 'checking' : 'invalid');
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ attempt: number; result: Promise<boolean> } | null>(null);

  useEffect(() => {
    if (!userId || !token) return;
    if (request.current?.attempt !== attempt) {
      request.current = { attempt, result: api.account.confirmEmail(userId, token) };
    }
    let cancelled = false;
    request.current.result.then(
      (confirmed) => {
        if (!cancelled) setState(confirmed ? 'verified' : 'invalid');
      },
      () => {
        if (!cancelled) setState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, userId, token, attempt]);

  return (
    <main className="page auth-page">
      <Wordmark />
      <h1 className="auth-page__title">Verify your email</h1>

      {state === 'checking' && (
        <p className="auth-page__message" role="status">
          Checking your link…
        </p>
      )}

      {state === 'verified' && (
        <>
          <p className="auth-page__notice" role="status">
            Your email is verified. Log in to start swiping.
          </p>
          <Link className="button-primary button-link" to={PATHS.login}>
            Go to login
          </Link>
        </>
      )}

      {state === 'invalid' && (
        <>
          <p className="auth-page__message" role="alert">
            This link is invalid or has already been used. If your account is verified, you can log in.
          </p>
          <Link className="button-primary button-link" to={PATHS.login}>
            Go to login
          </Link>
        </>
      )}

      {state === 'failed' && (
        <div className="auth-page__message" role="alert">
          <p>We couldn't verify your email. Check your connection and try again.</p>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              setState('checking');
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
