/**
 * Client-side checks for fast feedback. The server is the authority (CLAUDE.md); these must
 * agree with AccountController.createAccount so the user never sees two different answers.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Satisfies: R-ACC-07, R-ACC-08 (client-side half).
 * Requires: none.
 * Effects: none.
 * @param email the text typed in an email box
 * @returns true iff email (after trimming) has the form local@domain.tld with no spaces
 */
export function isWellFormedEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}
