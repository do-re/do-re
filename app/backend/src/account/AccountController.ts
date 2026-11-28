import { type Clock, type RandomSource, sha256Hex } from '../deps';
import type { CreateAccountResult, LoginResult, UserProfile } from '../model/types';
import { AppError } from '../errors';
import { type Key, type Table, updateItem } from '../store/Table';
import { type AccountModel, normalizeEmail } from './AccountModel';
import type { EmailSender } from './EmailSender';

const verifyKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'VERIFY' });
/** Failed-login counter for an email address, whether or not an account uses it. */
const guardKey = (email: string): Key => ({ pk: `LOGIN#${email}`, sk: 'ATTEMPTS' });

/**
 * @param email an email address as typed
 * @returns true iff email (trimmed) has the form local@domain.tld with no spaces and is at
 *          most 254 characters long
 */
export function isWellFormedEmail(email: string): boolean {
  const address = email.trim();
  return address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

/**
 * AccountController (server half): handles every query and update to AccountModel on behalf
 * of LoginView, CreateAccountView and ProfileView, and sends confirmation emails.
 * Resides on: client and server; this is the server side. The client side sends each request
 * as an HTTPS call (see docs/project/api.md).
 * Communicates with: AccountModel, the email service, LoginView, CreateAccountView, ProfileView.
 *
 * Stored state: USER#<id> / VERIFY with tokenHash, expiresAt, sentAt, ttl: the one valid
 * confirmation token of an unverified account, stored only as a SHA-256 digest.
 * LOGIN#<email> / ATTEMPTS with failures, windowStart, lockedUntil, ttl: the failed-login
 * counter that slows password guessing (updated through updateItem, so concurrent failures
 * are all counted).
 *
 * Concurrency: sending writes the VERIFY item with a plain put (a later email replaces an
 * earlier one's token). confirmEmail activates first, which is idempotent, then deletes the
 * token; two concurrent clicks on one link both leave the account active and the token gone,
 * which is the same state as one click.
 */
export class AccountController {
  /** How long a confirmation link stays valid. */
  static readonly VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
  /** A failed login by an unverified user re-sends the link at most this often. */
  static readonly RESEND_COOLDOWN_MS = 60 * 1000;
  /** This many failed logins for one email within LOGIN_WINDOW_MS lock it for LOGIN_LOCK_MS. */
  static readonly MAX_FAILED_LOGINS = 10;
  static readonly LOGIN_WINDOW_MS = 15 * 60 * 1000;
  static readonly LOGIN_LOCK_MS = 15 * 60 * 1000;

  /**
   * @param appBaseUrl origin of the web app, e.g. "https://d123.cloudfront.net", no trailing slash
   */
  constructor(
    private readonly accountModel: AccountModel,
    private readonly table: Table,
    private readonly email: EmailSender,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    private readonly appBaseUrl: string,
  ) {}

  /**
   * Validates submitted login details.
   * Satisfies: R-ACC-03, R-ACC-04, R-SEC-03.
   *
   * Effects: counts failed attempts per email: after MAX_FAILED_LOGINS failures within
   *          LOGIN_WINDOW_MS the email is locked for LOGIN_LOCK_MS, whether or not an account
   *          uses it (so the lock reveals nothing); a correct password clears the count.
   *          If the result is NOT_VERIFIED and no confirmation email was sent to this
   *          account in the last RESEND_COOLDOWN_MS, a new one is sent (replacing the old
   *          link), so a lost email cannot lock an account out for good.
   * @returns SUSPENDED if the password is right but an admin suspended the account (so only
   *          someone who knows the password learns that); otherwise
   *          SUCCESS if valid and verified; NOT_VERIFIED if valid but unverified;
   *          WRONG_PASSWORD if the email exists but the password does not match;
   *          NO_ACCOUNT if no account uses the email
   * @throws AppError 429 RATE_LIMITED while the email is locked (the password is not checked)
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const address = normalizeEmail(email);
    const guard = await this.table.get(guardKey(address));
    const lockedFor = ((guard?.lockedUntil ?? 0) as number) - this.clock();
    if (lockedFor > 0) {
      const minutes = Math.ceil(lockedFor / 60_000);
      throw new AppError(429, 'RATE_LIMITED', `Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`);
    }
    if (!(await this.accountModel.isValidLogin(email, password))) {
      await this.recordFailedLogin(address);
      return (await this.accountModel.isEmailInUse(email)) ? 'WRONG_PASSWORD' : 'NO_ACCOUNT';
    }
    if (guard !== undefined) {
      await this.table.write([{ op: 'delete', key: guardKey(address), expect: 'any' }]);
    }
    const userId = await this.accountModel.getUserId(email);
    const account = await this.accountModel.getAccount(userId);
    if (account.suspended !== null) {
      return 'SUSPENDED';
    }
    if (account.active) {
      return 'SUCCESS';
    }
    const pending = await this.table.get(verifyKey(userId));
    if (pending === undefined || this.clock() - (pending.sentAt as number) >= AccountController.RESEND_COOLDOWN_MS) {
      await this.sendConfirmationEmail(address, userId);
    }
    return 'NOT_VERIFIED';
  }

  /** Counts one failed login for address, locking it when the limit is reached. */
  private async recordFailedLogin(address: string): Promise<void> {
    const now = this.clock();
    await updateItem(this.table, guardKey(address), (current) => {
      const fresh = current === undefined || now - (current.windowStart as number) >= AccountController.LOGIN_WINDOW_MS;
      const failures = fresh ? 1 : (current.failures as number) + 1;
      const windowStart = fresh ? now : (current.windowStart as number);
      const locked = failures >= AccountController.MAX_FAILED_LOGINS;
      const lockedUntil = locked ? now + AccountController.LOGIN_LOCK_MS : 0;
      const keepUntil = Math.max(windowStart + AccountController.LOGIN_WINDOW_MS, lockedUntil);
      // After a lock the count starts again, so the next lock needs another full run of failures.
      return { attrs: { failures: locked ? 0 : failures, windowStart, lockedUntil, ttl: Math.ceil(keepUntil / 1000) }, result: undefined };
    });
  }

  /**
   * Effects: none.
   * @returns true iff an account already uses this email
   */
  isEmailInUse(email: string): Promise<boolean> {
    return this.accountModel.isEmailInUse(email);
  }

  /**
   * Creates an inactive account and sends a confirmation email containing a link.
   * Satisfies: R-ACC-02, R-ACC-08, R-ACC-09, R-SEC-01.
   *
   * Effects: if email is well-formed, password is non-empty, password equals confirmPassword
   *          and the email is not in use, an inactive account is created in AccountModel and
   *          a confirmation email is sent to email. If the email is used only by an account
   *          that was never verified (and is not suspended), and its last confirmation email
   *          is at least RESEND_COOLDOWN_MS old, that account's password is replaced with
   *          this one and a new confirmation email is sent (the old link stops working).
   *          Otherwise nothing changes.
   * @returns INVALID_EMAIL if email is not well-formed; otherwise PASSWORDS_DO_NOT_MATCH if
   *          password is empty or differs from confirmPassword; otherwise EMAIL_IN_USE if a
   *          verified or suspended account uses email, or an unverified one was emailed less
   *          than RESEND_COOLDOWN_MS ago; otherwise PENDING_VERIFICATION
   * @throws AppError 502 if the account was created but the email could not be sent
   */
  async createAccount(email: string, password: string, confirmPassword: string): Promise<CreateAccountResult> {
    if (!isWellFormedEmail(email)) {
      return 'INVALID_EMAIL';
    }
    if (password === '' || password !== confirmPassword) {
      return 'PASSWORDS_DO_NOT_MATCH';
    }
    let userId = await this.accountModel.createAccount(email, password);
    if (userId === undefined) {
      // The email has an account. If nobody ever verified it, whoever signs up now takes it
      // over with their own password: otherwise anyone could block an address they do not
      // own, or leave an account under it with a password of their choosing for the owner to
      // activate by mistake. Not within RESEND_COOLDOWN_MS of the last email, so a real
      // sign-up has time to be confirmed and the address cannot be flooded with emails.
      const existing = await this.accountModel.getUserId(email);
      const pending = await this.table.get(verifyKey(existing));
      const recent = pending !== undefined && this.clock() - (pending.sentAt as number) < AccountController.RESEND_COOLDOWN_MS;
      if (recent || !(await this.accountModel.replaceUnverifiedPassword(existing, password))) {
        return 'EMAIL_IN_USE';
      }
      userId = existing;
    }
    await this.sendConfirmationEmail(normalizeEmail(email), userId);
    return 'PENDING_VERIFICATION';
  }

  /**
   * Sends an email containing a confirmation link for an account.
   * Satisfies: R-SEC-01.
   *
   * Requires: userId belongs to an existing, inactive account whose email is email.
   * Effects: a new token becomes the account's only valid confirmation token, expiring
   *          VERIFY_TTL_MS from now, and one email with the link
   *          <appBaseUrl>/verify?userId=...&token=... is sent to email.
   */
  async sendConfirmationEmail(email: string, userId: string): Promise<void> {
    const token = this.random.token();
    const now = this.clock();
    const expiresAt = now + AccountController.VERIFY_TTL_MS;
    const item = {
      ...verifyKey(userId),
      version: 1,
      tokenHash: sha256Hex(token),
      expiresAt,
      sentAt: now,
      ttl: Math.ceil(expiresAt / 1000),
    };
    await this.table.write([{ op: 'put', item, expect: 'any' }]);
    const link = `${this.appBaseUrl}/verify?userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
    await this.email.send({
      to: email,
      subject: 'Confirm your Do~Re account',
      text:
        `Welcome to Do~Re!\n\nOpen this link to confirm your email address and activate your account:\n\n${link}\n\n` +
        'The link works for 24 hours. If you did not create a Do~Re account, you can ignore this email.\n',
    });
  }

  /**
   * Handles a click on a confirmation link.
   * Satisfies: R-SEC-02.
   *
   * Effects: if token is the valid, unexpired token for userId, the account is activated and
   *          the token is consumed; otherwise nothing changes.
   * @returns true iff the token was valid (so the account is now active)
   */
  async confirmEmail(userId: string, token: string): Promise<boolean> {
    const pending = await this.table.get(verifyKey(userId));
    const valid =
      pending !== undefined && (pending.expiresAt as number) > this.clock() && pending.tokenHash === sha256Hex(token);
    if (!valid) {
      return false;
    }
    await this.accountModel.activateAccount(userId);
    await this.table.write([{ op: 'delete', key: verifyKey(userId), expect: 'any' }]);
    return true;
  }

  /**
   * Requires: email belongs to an existing account.
   * Effects: none.
   * @returns true iff the account's email has been verified
   */
  async isVerified(email: string): Promise<boolean> {
    return this.accountModel.isActive(await this.accountModel.getUserId(email));
  }

  /**
   * Requires: isEmailInUse(email) is true.
   * Effects: none.
   * @returns the account's unique user ID
   */
  getUserId(email: string): Promise<string> {
    return this.accountModel.getUserId(email);
  }

  /**
   * Requires: userId belongs to an existing account; newUsername is non-empty.
   * Effects: the username stored in AccountModel is replaced with newUsername.
   */
  updateUsername(userId: string, newUsername: string): Promise<void> {
    return this.accountModel.setUsername(userId, newUsername);
  }

  /**
   * Requires: userId belongs to an existing account; image is a non-empty image file.
   * Effects: the profile picture stored in AccountModel is replaced with image.
   */
  updateProfilePicture(userId: string, image: Uint8Array): Promise<void> {
    return this.accountModel.setProfilePicture(userId, image);
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns the account's username and profile picture
   */
  getProfile(userId: string): Promise<UserProfile> {
    return this.accountModel.getProfile(userId);
  }
}
