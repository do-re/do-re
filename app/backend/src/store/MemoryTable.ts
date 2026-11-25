import type { Expect, Item, Key, QueryRange, Table, WriteOp } from './Table';

/**
 * In-memory Table for unit tests, with the same conditional-write semantics as DynamoDB.
 *
 * Abstraction function: AF(items) = the table whose item under key (pk, sk) is
 *   items.get(pk + "\u0000" + sk), for every key present.
 * Rep invariant: every map key equals idOf(its item); every stored item is a private deep
 *   copy (callers never hold a reference into the map).
 *
 * Concurrency: JavaScript runs one callback at a time, and each method does all of its
 * reading and writing in one synchronous block after a single `await`. So every operation is
 * atomic, and concurrent callers (Promise.all) are interleaved between operations, never
 * inside one. That is the guarantee DynamoDB gives per request.
 */
export class MemoryTable implements Table {
  private readonly items = new Map<string, Item>();

  async get(key: Key): Promise<Item | undefined> {
    await yieldToOthers();
    const item = this.items.get(idOf(key));
    return item === undefined ? undefined : structuredClone(item);
  }

  async query(pk: string, range: QueryRange = {}): Promise<Item[]> {
    await yieldToOthers();
    const prefix = range.prefix ?? '';
    return [...this.items.values()]
      .filter((item) => item.pk === pk && item.sk.startsWith(prefix))
      .filter((item) => range.after === undefined || item.sk > range.after)
      .sort((a, b) => (a.sk < b.sk ? -1 : 1))
      .map((item) => structuredClone(item));
  }

  async write(ops: readonly WriteOp[]): Promise<boolean> {
    await yieldToOthers();
    const ids = ops.map((op) => idOf(op.op === 'put' ? op.item : op.key));
    if (ops.length === 0 || new Set(ids).size !== ids.length) {
      throw new Error('write needs at least one op and at most one op per key');
    }
    if (!ops.every((op, i) => holds(op.expect, this.items.get(ids[i]!)))) {
      return false;
    }
    ops.forEach((op, i) => {
      if (op.op === 'put') {
        this.items.set(ids[i]!, structuredClone(op.item));
      } else {
        this.items.delete(ids[i]!);
      }
    });
    return true;
  }
}

function idOf(key: Key): string {
  return `${key.pk}\u0000${key.sk}`;
}

function holds(expect: Expect, stored: Item | undefined): boolean {
  if (expect === 'any') {
    return true;
  }
  if (expect === 'absent') {
    return stored === undefined;
  }
  return stored !== undefined && stored.version === expect.version;
}

/** Lets other pending operations run first, so concurrent callers really interleave. */
function yieldToOthers(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
