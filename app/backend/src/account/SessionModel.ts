import { type Clock, type RandomSource, sha256Hex } from '../deps';
import type { Key, Table } from '../store/Table';

const sessionKey = (token: string): Key => ({ pk: `SESSION#${sha256Hex(token)}`, sk: 'SESSION' });

/**
 * SessionModel: remembers which user each login token belongs to. New in the TypeScript
 * backend: stubs v2 only say "userId belongs to a logged-in user"; this is what makes that
 * checkable on a server whose instances share no memory.
 * Resides on: server. Communicates with: the HTTP layer (every authenticated request).
 *
 * Stored state: SESSION#<sha256 of token> / SESSION with userId, expiresAt and ttl
 * (DynamoDB's TTL attribute, in seconds, so expired sessions are deleted automatically).
 *
 * Abstraction function: AF(table) = the map from each unexpired issued token to its user.
 * Rep invariant: tokens are stored only as SHA-256 digests, so a leaked table does not
 *   reveal usable tokens; expiresAt == creation time + TTL_MS.
 *
 * Concurrency: each session is one item written once and deleted at most once; there is no
 * read-modify-write, so concurrent requests cannot interfere.
 */
export class SessionModel {
  /** How long a login lasts. */
  static readonly TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly table: Table,
    private readonly clock: Clock,
    private readonly random: RandomSource,
  ) {}

  /**
   * Requires: userId belongs to an existing, verified account that just logged in.
   * Effects: stores a new session for userId that expires TTL_MS from now.
   * @returns the session's secret token, to be sent as "Authorization: Bearer <token>"
   */
  async createSession(userId: string): Promise<string> {
    const token = this.random.token();
    const expiresAt = this.clock() + SessionModel.TTL_MS;
    const item = { ...sessionKey(token), version: 1, userId, expiresAt, ttl: Math.ceil(expiresAt / 1000) };
    await this.table.write([{ op: 'put', item, expect: 'absent' }]);
    return token;
  }

  /**
   * Effects: none.
   * @returns the user the token was issued to, or undefined if the token is unknown, ended or
   *          expired (a session is expired from exactly TTL_MS after it was created)
   */
  async authenticate(token: string): Promise<string | undefined> {
    const session = await this.table.get(sessionKey(token));
    if (session === undefined || (session.expiresAt as number) <= this.clock()) {
      return undefined;
    }
    return session.userId as string;
  }

  /**
   * Effects: authenticate(token) returns undefined afterwards.
   */
  async endSession(token: string): Promise<void> {
    await this.table.write([{ op: 'delete', key: sessionKey(token), expect: 'any' }]);
  }
}
