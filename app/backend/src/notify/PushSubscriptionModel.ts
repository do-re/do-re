import { type Clock, sha256Hex } from '../deps';
import { badRequest } from '../errors';
import type { Key, Table, WriteOp } from '../store/Table';

/** A browser's push subscription, as PushSubscription.toJSON() gives it. */
export interface BrowserSubscription {
  /** The push service URL that delivers to this browser. */
  readonly endpoint: string;
  readonly keys: {
    /** The browser's public key (base64url), used to encrypt the payload. */
    readonly p256dh: string;
    /** The browser's authentication secret (base64url). */
    readonly auth: string;
  };
}

const subscriptionKey = (userId: string, endpoint: string): Key => ({ pk: `USER#${userId}`, sk: `PUSH#${sha256Hex(endpoint)}` });
const ownerKey = (endpoint: string): Key => ({ pk: `PUSHENDPOINT#${sha256Hex(endpoint)}`, sk: 'OWNER' });

/**
 * Push services browsers use. The notifier sends HTTP requests to subscription endpoints,
 * so only these hosts are accepted; otherwise a caller could make the server send requests
 * to any address it liked.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, Opera, Brave
  // Chrome's newer endpoints, e.g. jmt17.google.com (seen 2026-11-26). Not all of google.com:
  // hosts such as script.google.com run code written by anyone.
  /^jmt\d+\.google\.com$/,
  /^(?:[\w-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^(?:[\w-]+\.)*notify\.windows\.com$/, // Edge
  /^(?:[\w-]+\.)*push\.apple\.com$/, // Safari
];

/**
 * @param endpoint a subscription endpoint
 * @returns true iff endpoint is an https URL on a known browser push service, with no
 *          credentials or port in it, and at most 1000 characters long
 */
export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const plain = url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '';
  return plain && endpoint.length <= 1000 && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

/**
 * PushSubscriptionModel: remembers which browsers each user wants notifications in.
 * New in the TypeScript backend ("notification services" in architecture.md, Felix).
 * Resides on: server. Communicates with: the HTTP layer (save / remove) and the Notifier.
 *
 * Stored state:
 *   USER#<id> / PUSH#<sha256 of endpoint>      endpoint, p256dh, auth, createdAt
 *   PUSHENDPOINT#<sha256 of endpoint> / OWNER  userId   (which user a browser belongs to)
 *
 * Abstraction function: AF(table) = for each user, the set of browser subscriptions to push
 *   their notifications to.
 * Rep invariant: an endpoint is subscribed for at most one user (the OWNER item names that
 *   user, and only that user has a PUSH item for it), so a browser never shows one account's
 *   notifications to another account's user; a user has at most MAX_PER_USER subscriptions;
 *   every stored endpoint satisfies isPushEndpoint.
 *
 * Concurrency: save() moves an endpoint to its new owner in one atomic write (delete the old
 * user's item, put the new user's item, put the OWNER item), so at every moment exactly one
 * user holds it. Two saves racing for one endpoint are both plain atomic writes; whichever
 * is applied last owns the endpoint, and the other user's item is removed by it.
 */
export class PushSubscriptionModel {
  /** Most browsers one user can be subscribed in; the oldest is dropped to make room. */
  static readonly MAX_PER_USER = 10;

  constructor(
    private readonly table: Table,
    private readonly clock: Clock,
  ) {}

  /**
   * Requires: userId belongs to a logged-in user; subscription came from that user's browser.
   * Effects: the browser is subscribed for userId, and for no other user. If userId already
   *          has MAX_PER_USER other subscriptions, the oldest is removed.
   * @throws AppError 400 if the endpoint is not a browser push service URL or a key is not
   *         base64url of a plausible length
   */
  async save(userId: string, subscription: BrowserSubscription): Promise<void> {
    const { endpoint, keys } = subscription;
    const key = /^[A-Za-z0-9_-]{16,200}$/;
    if (!isPushEndpoint(endpoint) || !key.test(keys.p256dh) || !key.test(keys.auth)) {
      throw badRequest('That is not a browser push subscription.');
    }
    const mine = subscriptionKey(userId, endpoint);
    const [owner, existing] = await Promise.all([this.table.get(ownerKey(endpoint)), this.table.query(`USER#${userId}`, { prefix: 'PUSH#' })]);
    const ops: WriteOp[] = [
      { op: 'put', item: { ...mine, version: 1, endpoint, p256dh: keys.p256dh, auth: keys.auth, createdAt: this.clock() }, expect: 'any' },
      { op: 'put', item: { ...ownerKey(endpoint), version: 1, userId }, expect: 'any' },
    ];
    if (owner !== undefined && owner.userId !== userId) {
      ops.push({ op: 'delete', key: subscriptionKey(owner.userId as string, endpoint), expect: 'any' });
    }
    const others = existing.filter((item) => item.sk !== mine.sk).sort((a, b) => (a.createdAt as number) - (b.createdAt as number));
    for (const old of others.slice(0, Math.max(0, others.length + 1 - PushSubscriptionModel.MAX_PER_USER))) {
      ops.push({ op: 'delete', key: { pk: old.pk, sk: old.sk }, expect: 'any' });
      ops.push({ op: 'delete', key: ownerKey(old.endpoint as string), expect: 'any' });
    }
    await this.table.write(ops);
  }

  /**
   * Effects: the browser with this endpoint is no longer subscribed for userId. Nothing
   *          happens if it was not (including when it now belongs to another user).
   */
  async remove(userId: string, endpoint: string): Promise<void> {
    const owner = await this.table.get(ownerKey(endpoint));
    const ops: WriteOp[] = [{ op: 'delete', key: subscriptionKey(userId, endpoint), expect: 'any' }];
    if (owner?.userId === userId) {
      ops.push({ op: 'delete', key: ownerKey(endpoint), expect: 'any' });
    }
    await this.table.write(ops);
  }

  /**
   * Effects: userId has no subscriptions afterwards (used when an account is suspended).
   */
  async removeAll(userId: string): Promise<void> {
    for (const subscription of await this.list(userId)) {
      await this.remove(userId, subscription.endpoint);
    }
  }

  /**
   * Effects: none.
   * @returns the user's subscriptions, oldest first
   */
  async list(userId: string): Promise<BrowserSubscription[]> {
    const items = await this.table.query(`USER#${userId}`, { prefix: 'PUSH#' });
    return items
      .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
      .map((item) => ({ endpoint: item.endpoint as string, keys: { p256dh: item.p256dh as string, auth: item.auth as string } }));
  }
}
