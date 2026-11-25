import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Expect, Item, Key, QueryRange, Table, WriteOp } from './Table';

/** How many times a write is retried when DynamoDB cancels it for a transaction conflict. */
const MAX_CONFLICT_RETRIES = 8;

/**
 * Table backed by one DynamoDB table with string keys `pk` (partition) and `sk` (sort).
 *
 * Atomicity comes from DynamoDB itself, so it holds across Lambda instances: a single op is
 * a PutItem/DeleteItem with a ConditionExpression, and several ops are one
 * TransactWriteItems call, which applies all of them or none. Reads use ConsistentRead.
 *
 * Abstraction function: AF(client, tableName) = the items of DynamoDB table tableName.
 * Rep invariant: tableName is non-empty; pageSize, if set, is a positive integer.
 */
export class DynamoTable implements Table {
  /**
   * @param client    document client for the table's region
   * @param tableName the DynamoDB table
   * @param pageSize  maximum items per Query page; only tests set this, to exercise paging
   */
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly pageSize?: number,
  ) {}

  async get(key: Key): Promise<Item | undefined> {
    const out = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: key.pk, sk: key.sk }, ConsistentRead: true }),
    );
    return out.Item as Item | undefined;
  }

  async query(pk: string, range: QueryRange = {}): Promise<Item[]> {
    const prefix = range.prefix ?? '';
    const values: Record<string, string> = { ':pk': pk };
    let condition = 'pk = :pk';
    if (range.after !== undefined) {
      condition += ' AND sk > :after';
      values[':after'] = range.after;
    } else if (prefix !== '') {
      condition += ' AND begins_with(sk, :prefix)';
      values[':prefix'] = prefix;
    }
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: condition,
          ExpressionAttributeValues: values,
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
          Limit: this.pageSize,
        }),
      );
      items.push(...((page.Items ?? []) as Item[]));
      startKey = page.LastEvaluatedKey;
    } while (startKey !== undefined);
    // Only one key condition can be sent, so the prefix is applied here when `after` was used.
    return items.filter((item) => item.sk.startsWith(prefix));
  }

  async write(ops: readonly WriteOp[]): Promise<boolean> {
    const keys = ops.map((op) => (op.op === 'put' ? `${op.item.pk}\u0000${op.item.sk}` : `${op.key.pk}\u0000${op.key.sk}`));
    if (ops.length === 0 || new Set(keys).size !== keys.length) {
      throw new Error('write needs at least one op and at most one op per key');
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await this.send(ops);
        return true;
      } catch (error) {
        const outcome = classify(error);
        if (outcome === 'condition-failed') {
          return false;
        }
        if (outcome !== 'conflict' || attempt >= MAX_CONFLICT_RETRIES) {
          throw error;
        }
        // Another transaction was touching the same item; the condition was not evaluated.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * (attempt + 1)));
      }
    }
  }

  private async send(ops: readonly WriteOp[]): Promise<void> {
    const requests = ops.map((op) =>
      op.op === 'put'
        ? { Put: { TableName: this.tableName, Item: { ...op.item }, ...conditionFor(op.expect) } }
        : { Delete: { TableName: this.tableName, Key: { pk: op.key.pk, sk: op.key.sk }, ...conditionFor(op.expect) } },
    );
    const only = requests.length === 1 ? requests[0]! : undefined;
    if (only?.Put) {
      await this.client.send(new PutCommand(only.Put));
    } else if (only?.Delete) {
      await this.client.send(new DeleteCommand(only.Delete));
    } else {
      await this.client.send(new TransactWriteCommand({ TransactItems: requests }));
    }
  }
}

function conditionFor(expect: Expect): object {
  if (expect === 'any') {
    return {};
  }
  if (expect === 'absent') {
    return { ConditionExpression: 'attribute_not_exists(pk)' };
  }
  return {
    ConditionExpression: '#version = :version',
    ExpressionAttributeNames: { '#version': 'version' },
    ExpressionAttributeValues: { ':version': expect.version },
  };
}

/**
 * @param error anything thrown by a DynamoDB write
 * @returns 'condition-failed' if an `expect` did not hold; 'conflict' if DynamoDB cancelled
 *          the write only because another transaction was in progress on an item; 'other'
 *          for every other error
 */
export function classify(error: unknown): 'condition-failed' | 'conflict' | 'other' {
  const { name, CancellationReasons: reasons } = (error ?? {}) as {
    name?: string;
    CancellationReasons?: { Code?: string }[];
  };
  if (name === 'ConditionalCheckFailedException') {
    return 'condition-failed';
  }
  if (name === 'TransactionConflictException') {
    return 'conflict';
  }
  if (name === 'TransactionCanceledException') {
    const codes = (reasons ?? []).map((reason) => reason.Code);
    if (codes.includes('ConditionalCheckFailed')) {
      return 'condition-failed';
    }
    if (codes.includes('TransactionConflict')) {
      return 'conflict';
    }
  }
  return 'other';
}
