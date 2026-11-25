import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { classify, DynamoTable } from '../src/store/DynamoTable';
import { MemoryTable } from '../src/store/MemoryTable';
import { MAX_UPDATE_ATTEMPTS, type Table, updateItem } from '../src/store/Table';
import { describeTableContract } from './tableContract';

const memory = new MemoryTable();
describeTableContract('MemoryTable', () => memory);

describe('updateItem under endless contention', () => {
  // spec: throws AppError 503 after MAX_UPDATE_ATTEMPTS failed attempts
  it('gives up with 503 BUSY', async () => {
    let writes = 0;
    const neverWins: Table = {
      get: async () => undefined,
      query: async () => [],
      write: async () => {
        writes++;
        return false;
      },
    };
    const error = await updateItem(neverWins, { pk: 'p', sk: 's' }, () => ({ attrs: {}, result: 1 })).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(503);
    expect(writes).toBe(MAX_UPDATE_ATTEMPTS);
  });
});

describe('DynamoTable error handling (no DynamoDB needed)', () => {
  const named = (name: string, codes?: string[]) =>
    Object.assign(new Error(name), { name, CancellationReasons: codes?.map((Code) => ({ Code })) });

  // spec: classify partitions DynamoDB write errors
  it('classify tells failed conditions from conflicts from other errors', () => {
    expect(classify(named('ConditionalCheckFailedException'))).toBe('condition-failed');
    expect(classify(named('TransactionConflictException'))).toBe('conflict');
    expect(classify(named('TransactionCanceledException', ['None', 'ConditionalCheckFailed']))).toBe('condition-failed');
    expect(classify(named('TransactionCanceledException', ['TransactionConflict', 'None']))).toBe('conflict');
    expect(classify(named('TransactionCanceledException', ['ValidationError']))).toBe('other');
    expect(classify(named('TransactionCanceledException'))).toBe('other');
    expect(classify(named('ProvisionedThroughputExceededException'))).toBe('other');
    expect(classify(undefined)).toBe('other');
  });

  const tableFailing = (errors: Error[]) => {
    let calls = 0;
    const client = {
      send: async () => {
        const error = errors[calls++];
        if (error) {
          throw error;
        }
        return {};
      },
    };
    return { table: new DynamoTable(client as never, 't'), calls: () => calls };
  };
  const put = { op: 'put', item: { pk: 'p', sk: 's', version: 1 }, expect: 'absent' } as const;

  // spec: a conflict means the condition was not evaluated, so the write is retried
  it('retries a write that hit a transaction conflict', async () => {
    const { table, calls } = tableFailing([named('TransactionConflictException'), named('TransactionConflictException')]);
    expect(await table.write([put])).toBe(true);
    expect(calls()).toBe(3);
  });

  it('gives up after repeated conflicts and rethrows other errors at once', async () => {
    const endless = tableFailing(Array.from({ length: 50 }, () => named('TransactionConflictException')));
    await expect(endless.table.write([put])).rejects.toThrow('TransactionConflictException');
    expect(endless.calls()).toBe(9);
    const broken = tableFailing([named('AccessDeniedException')]);
    await expect(broken.table.write([put])).rejects.toThrow('AccessDeniedException');
    expect(broken.calls()).toBe(1);
  });
});
