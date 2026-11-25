import { AppError } from '../errors';

/**
 * The store interface every model reaches DynamoDB through (CLAUDE.md: "all model state lives
 * in DynamoDB, reached through store interfaces passed into each model").
 *
 * It exposes exactly the DynamoDB features the concurrency arguments rely on: strongly
 * consistent reads, and writes that apply only if a condition on the stored item holds,
 * alone or as an all-or-nothing group. DynamoTable implements it on AWS; MemoryTable is the
 * in-memory fake for unit tests. test/tableContract.ts runs the same assertions against
 * both, which is the evidence that the fake has the same semantics.
 */
export interface Table {
  /**
   * Effects: none.
   * @returns the item stored under key (strongly consistent), or undefined if there is none
   */
  get(key: Key): Promise<Item | undefined>;

  /**
   * Effects: none.
   * @param pk    the partition to read
   * @param range optional restriction on the sort key
   * @returns every item in the partition whose sk starts with range.prefix (if given) and is
   *          greater than range.after (if given), in ascending sk order, strongly consistent
   */
  query(pk: string, range?: QueryRange): Promise<Item[]>;

  /**
   * Requires: ops is non-empty and no two ops name the same key.
   * Effects: if every op's `expect` holds for the currently stored item, applies all ops
   *          atomically; otherwise changes nothing. Concurrent calls behave as if they ran
   *          one after another in some order.
   * @returns true iff the ops were applied
   */
  write(ops: readonly WriteOp[]): Promise<boolean>;
}

export interface Key {
  readonly pk: string;
  readonly sk: string;
}

/** A stored item: its key, a version that its writers increase, and any other attributes. */
export interface Item extends Key {
  readonly version: number;
  readonly [attribute: string]: unknown;
}

/** The non-key, non-version attributes of an item. */
export type Attributes = Readonly<Record<string, unknown>>;

/** What must be true of the stored item for a write to apply. */
export type Expect = 'any' | 'absent' | { readonly version: number };

export type WriteOp =
  | { readonly op: 'put'; readonly item: Item; readonly expect: Expect }
  | { readonly op: 'delete'; readonly key: Key; readonly expect: Expect };

export interface QueryRange {
  readonly prefix?: string;
  readonly after?: string;
}

/**
 * @param item a stored item
 * @returns item's attributes without pk, sk and version
 */
export function attributesOf(item: Item): Attributes {
  const { pk: _pk, sk: _sk, version: _version, ...rest } = item;
  return rest;
}

/** What an update decided after looking at the current item. */
export interface Change<T> {
  /** New attributes for the item (replacing all old ones). Omit to leave the item as it is. */
  readonly attrs?: Attributes;
  /** Further ops to apply in the same atomic write. Only used when attrs is given. */
  readonly also?: readonly WriteOp[];
  /** Returned to the caller once the change has been applied. */
  readonly result: T;
}

/** How many times updateItem re-reads and retries before giving up. */
export const MAX_UPDATE_ATTEMPTS = 64;

/**
 * Atomic read-modify-write of one item by optimistic concurrency control.
 *
 * Reads the item, asks `decide` what to write, and writes it on condition that the item still
 * has the version that was read (or is still absent). If another request changed the item in
 * between, the condition fails and the whole step is repeated on the new value. So the change
 * that is finally applied was computed from the value it replaces: no update is lost, and
 * concurrent updates of one item take effect one after another.
 *
 * Requires: decide has no side effects that must happen exactly once (it may run several times).
 * Effects: applies the decided change as described above.
 *
 * @param table  the table holding the item
 * @param key    the item to update
 * @param decide given the current item (undefined if absent), returns the change to make;
 *               may throw to abort without writing
 * @returns the `result` of the decision that was applied
 * @throws AppError 503 if the item was still contended after MAX_UPDATE_ATTEMPTS attempts
 */
export async function updateItem<T>(
  table: Table,
  key: Key,
  decide: (current: Item | undefined) => Change<T> | Promise<Change<T>>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
    const current = await table.get(key);
    const change = await decide(current);
    if (change.attrs === undefined) {
      return change.result;
    }
    const item: Item = { ...change.attrs, ...key, version: (current?.version ?? 0) + 1 };
    const expect: Expect = current === undefined ? 'absent' : { version: current.version };
    if (await table.write([{ op: 'put', item, expect }, ...(change.also ?? [])])) {
      return change.result;
    }
    // Lost a race: wait a little (randomised, growing) so contenders spread out, then retry.
    await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(attempt, 10) * 4));
  }
  throw new AppError(503, 'BUSY', 'The server is busy. Please try again.');
}
