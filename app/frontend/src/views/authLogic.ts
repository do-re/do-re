/**
 * Pure helpers for LoginView and CreateAccountView, kept out of the component files so React
 * fast refresh works. The client checks give fast feedback; the server still decides
 * (CLAUDE.md), so they must agree with AccountController (notes-for-felix F-9).
 */
import { isWellFormedEmail } from '../api/validation';
import { PATHS } from '../paths';

export interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

/** How often the "check your email" popup asks whether the account is verified yet. */
export const VERIFY_POLL_MS = 3000;

export const EMAIL_MISSING = 'Enter your email address.';
export const EMAIL_MALFORMED = 'Enter an email address like name@example.com.';

function emailError(email: string): string | undefined {
  if (email.trim() === '') return EMAIL_MISSING;
  if (!isWellFormedEmail(email)) return EMAIL_MALFORMED;
  return undefined;
}

/** Copies only the fields that have a message, so `{}` means "no errors". */
function compact(errors: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v !== undefined)) as FieldErrors;
}

/**
 * Satisfies: R-ACC-03 (client-side half).
 * Requires: none.
 * Effects: none.
 * @returns a message per field that must be fixed before logging in; empty if none
 */
export function validateLogin(email: string, password: string): FieldErrors {
  return compact({
    email: emailError(email),
    password: password === '' ? 'Enter your password.' : undefined,
  });
}

/** Shortest password the server accepts for a new account (backend MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Same rules as the server's sign-up route: a well-formed email, a password of at least
 * MIN_PASSWORD_LENGTH characters, and the confirmation equal to the password.
 * Satisfies: R-ACC-07, R-ACC-08 (client-side half).
 * Requires: none.
 * Effects: none.
 * @returns a message per field that must be fixed before signing up; empty if none
 */
export function validateSignup(email: string, password: string, confirmPassword: string): FieldErrors {
  let confirm: string | undefined;
  if (password !== '' && confirmPassword === '') confirm = 'Type your password again to confirm it.';
  else if (password !== '' && confirmPassword !== password) {
    confirm = "Passwords don't match. Type the same password in both boxes.";
  }
  return compact({
    email: emailError(email),
    password:
      password === ''
        ? 'Choose a password.'
        : password.length < MIN_PASSWORD_LENGTH
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
          : undefined,
    confirmPassword: confirm,
  });
}

/**
 * Where to go after logging in. Only in-app paths are allowed, so a crafted link can't send
 * the user to another site.
 * Satisfies: R-ACC-06.
 * Requires: none (from is any value taken from router state).
 * Effects: none.
 * @returns from if it is an in-app path other than login/signup, otherwise the home path
 */
export function safeRedirect(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return PATHS.home;
  if (from === PATHS.login || from === PATHS.signup) return PATHS.home;
  return from;
}

/** Router state passed between the login and sign-up pages. */
export interface AuthNavState {
  /** Email typed on the other page, to pre-fill ("" if none). */
  readonly email: string;
  /** True when arriving at login right after the email was verified. */
  readonly verified: boolean;
  /** Page the user was sent away from before logging in (see safeRedirect). */
  readonly from: unknown;
}

/**
 * Reads router state defensively: it can be anything (or null) after a refresh or a
 * hand-typed URL.
 * Requires: none.
 * Effects: none.
 * @returns the email (if a string), verified (if exactly true) and from in state
 */
export function readAuthNavState(state: unknown): AuthNavState {
  const s = (typeof state === 'object' && state !== null ? state : {}) as Record<string, unknown>;
  return {
    email: typeof s.email === 'string' ? s.email : '',
    verified: s.verified === true,
    from: s.from,
  };
}
