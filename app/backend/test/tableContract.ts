import { describe, expect, it } from 'vitest';
import { attributesOf, type Table, updateItem } from '../src/store/Table';

let run = 0;

/**
 * The behaviour every Table must have. Run against MemoryTable and against DynamoTable on
 * DynamoDB Local: passing both is the evidence that models tested on the fake behave the
 * same on DynamoDB, including under concurrent writes.
 */
export function describeTableContract(name: string, getTable: () => Table): void {
  describe(`Table contract: ${name}`, () => {
    // Each test works in its own partitions, so tests can share one table.
    const fresh = () => `T${Date.now()}-${++run}`;

    // spec: get returns undefined for a missing item and the stored item otherwise
    it('get returns what was put, or undefined', async () => {
      const table = getTable();
      const pk = fresh();
      expect(await table.get({ pk, sk: 'a' })).toBeUndefined();
      expect(await table.write([{ op: 'put', item: { pk, sk: 'a', version: 1, n: 7 }, expect: 'any' }])).toBe(true);
      expect(await table.get({ pk, sk: 'a' })).toEqual({ pk, sk: 'a', version: 1, n: 7 });
    });

    // spec: attributes of every supported type survive a round trip
    it('round-trips strings, numbers, booleans, lists, maps and bytes', async () => {
      const table = getTable();
      const pk = fresh();
      const attrs = { s: 'x', n: 0.25, yes: true, no: false, list: ['a', 'b'], empty: [], map: [{ k: 1 }] };
      const bytes = Uint8Array.from([0, 1, 254, 255]);
      await table.write([{ op: 'put', item: { pk, sk: 'a', version: 1, ...attrs, bytes }, expect: 'any' }]);
      const item = (await table.get({ pk, sk: 'a' }))!;
      expect(attributesOf({ ...item, bytes: undefined })).toEqual({ ...attrs, bytes: undefined });
      expect(Array.from(item.bytes as Uint8Array)).toEqual([0, 1, 254, 255]);
    });

    // spec: expect 'absent' holds only when no item is stored
    it("put with expect 'absent' applies once", async () => {
      const table = getTable();
      const pk = fresh();
      expect(await table.write([{ op: 'put', item: { pk, sk: 'a', version: 1, n: 1 }, expect: 'absent' }])).toBe(true);
      expect(await table.write([{ op: 'put', item: { pk, sk: 'a', version: 1, n: 2 }, expect: 'absent' }])).toBe(false);
      expect((await table.get({ pk, sk: 'a' }))!.n).toBe(1);
    });

    // spec: expect {version} holds only when the stored item has that version
    it('put with a version expectation applies only on that version', async () => {
      const table = getTable();
      const pk = fresh();
      const put = (version: number, expected: number) =>
        table.write([{ op: 'put', item: { pk, sk: 'a', version, n: version }, expect: { version: expected } }]);
      expect(await put(1, 0)).toBe(false); // nothing stored
      await table.write([{ op: 'put', item: { pk, sk: 'a', version: 1, n: 1 }, expect: 'absent' }]);
      expect(await put(2, 5)).toBe(false);
      expect(await put(2, 1)).toBe(true);
      expect(await put(3, 1)).toBe(false); // stale
      expect((await table.get({ pk, sk: 'a' }))!.version).toBe(2);
    });

    // spec: delete removes the item if its expectation holds
    it('delete honours its expectation', async () => {
      const table = getTable();
      const pk = fresh();
      const key = { pk, sk: 'a' };
      expect(await table.write([{ op: 'delete', key, expect: 'any' }])).toBe(true); // deleting nothing is fine
      await table.write([{ op: 'put', item: { ...key, version: 3 }, expect: 'any' }]);
      expect(await table.write([{ op: 'delete', key, expect: { version: 2 } }])).toBe(false);
      expect(await table.get(key)).toBeDefined();
      expect(await table.write([{ op: 'delete', key, expect: { version: 3 } }])).toBe(true);
      expect(await table.get(key)).toBeUndefined();
    });

    // spec: several ops apply all together or not at all
    it('a multi-op write is all-or-nothing', async () => {
      const table = getTable();
      const pk = fresh();
      await table.write([{ op: 'put', item: { pk, sk: 'taken', version: 1 }, expect: 'any' }]);
      await table.write([{ op: 'put', item: { pk, sk: 'old', version: 1 }, expect: 'any' }]);
      const failed = await table.write([
        { op: 'put', item: { pk, sk: 'new', version: 1 }, expect: 'absent' },
        { op: 'delete', key: { pk, sk: 'old' }, expect: 'any' },
        { op: 'put', item: { pk, sk: 'taken', version: 1 }, expect: 'absent' },
      ]);
      expect(failed).toBe(false);
      expect((await table.query(pk)).map((item) => item.sk)).toEqual(['old', 'taken']);
      const applied = await table.write([
        { op: 'put', item: { pk, sk: 'new', version: 1 }, expect: 'absent' },
        { op: 'delete', key: { pk, sk: 'old' }, expect: { version: 1 } },
      ]);
      expect(applied).toBe(true);
      expect((await table.query(pk)).map((item) => item.sk)).toEqual(['new', 'taken']);
    });

    // spec: Requires non-empty ops with distinct keys
    it('rejects empty writes and two ops on one key', async () => {
      const table = getTable();
      const pk = fresh();
      await expect(table.write([])).rejects.toThrow();
      await expect(
        table.write([
          { op: 'put', item: { pk, sk: 'a', version: 1 }, expect: 'any' },
          { op: 'delete', key: { pk, sk: 'a' }, expect: 'any' },
        ]),
      ).rejects.toThrow();
    });

    // spec: query returns the partition in ascending sk order, restricted by prefix and after
    it('query filters by partition, prefix and after, in sort-key order', async () => {
      const table = getTable();
      const pk = fresh();
      const other = fresh();
      for (const sk of ['MSG#03', 'META', 'MSG#01', 'MSG#02', 'ZED']) {
        await table.write([{ op: 'put', item: { pk, sk, version: 1 }, expect: 'any' }]);
      }
      await table.write([{ op: 'put', item: { pk: other, sk: 'MSG#09', version: 1 }, expect: 'any' }]);
      const sks = async (range?: { prefix?: string; after?: string }) => (await table.query(pk, range)).map((i) => i.sk);
      expect(await sks()).toEqual(['META', 'MSG#01', 'MSG#02', 'MSG#03', 'ZED']);
      expect(await sks({ prefix: 'MSG#' })).toEqual(['MSG#01', 'MSG#02', 'MSG#03']);
      expect(await sks({ after: 'MSG#02' })).toEqual(['MSG#03', 'ZED']);
      expect(await sks({ prefix: 'MSG#', after: 'MSG#01' })).toEqual(['MSG#02', 'MSG#03']);
      expect(await sks({ prefix: 'MSG#', after: 'MSG#03' })).toEqual([]);
      expect(await table.query(fresh())).toEqual([]);
    });

    // spec: callers never share state with the table
    it('returns copies, not references into the store', async () => {
      const table = getTable();
      const pk = fresh();
      const list = ['a'];
      await table.write([{ op: 'put', item: { pk, sk: 'a', version: 1, list }, expect: 'any' }]);
      list.push('b');
      const read = (await table.get({ pk, sk: 'a' }))!;
      (read.list as string[]).push('c');
      expect((await table.get({ pk, sk: 'a' }))!.list).toEqual(['a']);
    });

    // spec (concurrency): concurrent conditional writes behave as if run one after another
    it('lets exactly one of many concurrent creations win', async () => {
      const table = getTable();
      const pk = fresh();
      const results = await Promise.all(
        Array.from({ length: 24 }, (_, n) =>
          table.write([
            { op: 'put', item: { pk, sk: 'claim', version: 1, n }, expect: 'absent' },
            { op: 'put', item: { pk, sk: `side-${n}`, version: 1 }, expect: 'absent' },
          ]),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const items = await table.query(pk);
      expect(items).toHaveLength(2); // the claim and the winner's side item only
      expect(items[1]!.sk).toBe(`side-${items[0]!.n}`);
    });

    // spec (updateItem): no concurrent update is lost
    it('updateItem loses no concurrent increment', async () => {
      const table = getTable();
      const key = { pk: fresh(), sk: 'counter' };
      const results = await Promise.all(
        Array.from({ length: 24 }, () =>
          updateItem(table, key, (current) => {
            const n = ((current?.n ?? 0) as number) + 1;
            return { attrs: { n }, result: n };
          }),
        ),
      );
      expect((await table.get(key))!.n).toBe(24);
      expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    });

    // spec (updateItem): no attrs means no write; a throwing decide aborts
    it('updateItem writes nothing when the decision has no attrs or throws', async () => {
      const table = getTable();
      const key = { pk: fresh(), sk: 'a' };
      expect(await updateItem(table, key, () => ({ result: 'kept' }))).toBe('kept');
      await expect(
        updateItem(table, key, () => {
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(await table.get(key)).toBeUndefined();
    });
  });
}
