import type { RandomSource } from '../deps';
import { badRequest, pictureTooLarge, userNotFound } from '../errors';
import type { UserProfile } from '../model/types';
import { attributesOf, type Item, type Key, type Table, updateItem } from '../store/Table';
import type { PasswordHasher, PasswordRecord } from './PasswordHasher';
import type { PictureStore, PictureType } from './PictureStore';

const accountKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'PROFILE' });
const emailKey = (email: string): Key => ({ pk: `EMAIL#${email}`, sk: 'EMAIL' });

/**
 * @param email an email address as typed
 * @returns the form accounts are stored and compared under: trimmed and lower-cased
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * @param bytes a file's contents
 * @returns the image type if bytes start with a PNG, JPEG, GIF or WebP signature, otherwise
 *          undefined. The type comes from the contents, never from what the uploader claims.
 */
export function sniffImageType(bytes: Uint8Array): PictureType | undefined {
  const has = (signature: string, at = 0) => [...signature].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (has('\x89PNG\r\n\x1a\n')) {
    return 'image/png';
  }
  if (has('\xff\xd8\xff')) {
    return 'image/jpeg';
  }
  if (has('GIF87a') || has('GIF89a')) {
    return 'image/gif';
  }
  return has('RIFF') && has('WEBP', 8) ? 'image/webp' : undefined;
}

/**
 * AccountModel: stores email / salted-password-hash combinations, unique user IDs, usernames
 * and profile pictures; validates logins and checks whether an email is already in use.
 * Passwords are never stored in plaintext.
 * Resides on: server. Communicates with: AccountController only.
 *
 * Stored state (DynamoDB items):
 *   USER#<id> / PROFILE   email, salt, hash, cost, active, username, pictureUrl?
 *   EMAIL#<email> / EMAIL userId           (the claim that makes emails unique)
 * Picture files themselves are in the PictureStore (S3); the account holds only the URL.
 *
 * Abstraction function: AF(table) = the set of accounts, one per PROFILE item, each
 *   reachable by its normalized email through its EMAIL item.
 * Rep invariant (database integrity, testing.md proof 1): every EMAIL item names an existing
 *   PROFILE item whose email is that address, and every PROFILE item has exactly one EMAIL
 *   item; so emails and user IDs are unique. Only salts and hashes are stored.
 *
 * Concurrency: createAccount writes the EMAIL claim and the PROFILE item in one atomic write
 * that requires both to be absent. Of any number of concurrent sign-ups for one email, on
 * any Lambda instances, DynamoDB lets exactly one apply, so the invariant holds without
 * in-process locks. Updates to one account go through updateItem (see its argument).
 */
export class AccountModel {
  static readonly MAX_USERNAME_LENGTH = 30;
  /**
   * Largest profile picture accepted: 4 MB. The upload passes through Lambda, whose request
   * limit is 6 MB after base64 encoding (api.md Q-11).
   */
  static readonly MAX_PICTURE_BYTES = 4 * 1024 * 1024;

  constructor(
    private readonly table: Table,
    private readonly hasher: PasswordHasher,
    private readonly random: RandomSource,
    private readonly pictures: PictureStore,
  ) {}

  /**
   * Effects: none.
   * @returns true iff an account (active or not) exists with this email
   */
  async isEmailInUse(email: string): Promise<boolean> {
    return (await this.table.get(emailKey(normalizeEmail(email)))) !== undefined;
  }

  /**
   * Satisfies: R-ACC-04.
   * Effects: none.
   * @returns true iff an account exists with this email and hashing password with that
   *          account's stored salt gives the stored hash
   */
  async isValidLogin(email: string, password: string): Promise<boolean> {
    const claim = await this.table.get(emailKey(normalizeEmail(email)));
    if (claim === undefined) {
      return false;
    }
    const account = await this.requireAccount(claim.userId as string);
    return this.hasher.verify(password, account as unknown as PasswordRecord);
  }

  /**
   * Creates a new, not-yet-activated account and assigns it a unique ID.
   * Satisfies: R-ACC-09.
   *
   * Requires: email and password are non-empty.
   * Effects: if no account uses email, stores an inactive account with the normalized email,
   *          a new random salt and hash(salt + password), an empty username and no profile
   *          picture (a "blank account"); afterwards isEmailInUse(email) is true and
   *          isActive(returned id) is false. Otherwise changes nothing.
   *          Changed from stubs v2, which required isEmailInUse(email) to be false: two
   *          requests can both pass that check, so the model decides atomically instead.
   * @returns the new account's unique user ID, or undefined if the email was already in use
   * @throws AppError 400 if email or password is empty
   */
  async createAccount(email: string, password: string): Promise<string | undefined> {
    const address = normalizeEmail(email);
    if (address === '' || password === '') {
      throw badRequest('Enter an email and a password.');
    }
    const userId = this.random.id();
    const record = await this.hasher.hash(password);
    const created = await this.table.write([
      { op: 'put', item: { ...emailKey(address), version: 1, userId }, expect: 'absent' },
      {
        op: 'put',
        item: { ...accountKey(userId), version: 1, email: address, ...record, active: false, username: '' },
        expect: 'absent',
      },
    ]);
    return created ? userId : undefined;
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: isActive(userId) is true afterwards.
   * @throws AppError 404 if there is no such account
   */
  async activateAccount(userId: string): Promise<void> {
    await this.change(userId, (account) => (account.active === true ? undefined : { ...account, active: true }));
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns true iff the account's email has been verified
   * @throws AppError 404 if there is no such account
   */
  async isActive(userId: string): Promise<boolean> {
    return (await this.requireAccount(userId)).active === true;
  }

  /**
   * Requires: isEmailInUse(email) is true.
   * Effects: none.
   * @returns the unique user ID attached to this email
   * @throws AppError 404 if no account uses the email
   */
  async getUserId(email: string): Promise<string> {
    const claim = await this.table.get(emailKey(normalizeEmail(email)));
    if (claim === undefined) {
      throw userNotFound();
    }
    return claim.userId as string;
  }

  /**
   * Requires: userId belongs to an existing account; username is non-empty after trimming
   *           and at most MAX_USERNAME_LENGTH characters.
   * Effects: the account's stored username is replaced with the trimmed username.
   * @throws AppError 400 if the username is not acceptable; 404 if there is no such account
   */
  async setUsername(userId: string, username: string): Promise<void> {
    const name = username.trim();
    if (name === '' || name.length > AccountModel.MAX_USERNAME_LENGTH) {
      throw badRequest(`Choose a username between 1 and ${AccountModel.MAX_USERNAME_LENGTH} characters long.`);
    }
    await this.change(userId, (account) => ({ ...account, username: name }));
  }

  /**
   * Requires: userId belongs to an existing account; image is a PNG, JPEG, GIF or WebP file
   *           of at most MAX_PICTURE_BYTES bytes.
   * Effects: image is saved in the PictureStore under a new unguessable name, and the
   *          account's profile picture URL becomes that file's URL.
   * @throws AppError 413 if the image is too large; 400 if it is not an accepted image type;
   *         404 if there is no such account
   */
  async setProfilePicture(userId: string, image: Uint8Array): Promise<void> {
    if (image.length > AccountModel.MAX_PICTURE_BYTES) {
      const megabytes = AccountModel.MAX_PICTURE_BYTES / (1024 * 1024);
      throw pictureTooLarge(`Choose an image of at most ${megabytes} MB.`);
    }
    const type = sniffImageType(image);
    if (type === undefined) {
      throw badRequest('Choose a PNG, JPEG, GIF or WebP image.');
    }
    await this.requireAccount(userId);
    const pictureUrl = await this.pictures.save(`${userId}-${this.random.id()}`, image, type);
    await this.change(userId, (account) => ({ ...account, pictureUrl }));
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns the account's current username and profile picture
   * @throws AppError 404 if there is no such account
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const account = await this.requireAccount(userId);
    return {
      userId,
      username: account.username as string,
      profilePictureUrl: (account.pictureUrl as string | undefined) ?? null,
    };
  }

  private async requireAccount(userId: string): Promise<Item> {
    const account = await this.table.get(accountKey(userId));
    if (account === undefined) {
      throw userNotFound();
    }
    return account;
  }

  /** Atomically replaces an account's attributes with edit(old attributes), unless edit returns undefined. */
  private async change(
    userId: string,
    edit: (account: Readonly<Record<string, unknown>>) => Record<string, unknown> | undefined,
  ): Promise<void> {
    await updateItem(this.table, accountKey(userId), (current) => {
      if (current === undefined) {
        throw userNotFound();
      }
      return { attrs: edit(attributesOf(current)), result: undefined };
    });
  }
}
