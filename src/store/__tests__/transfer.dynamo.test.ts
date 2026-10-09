import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DynamoStore } from '../dynamo';
import { SqliteStore } from '../sqlite';
import { exportUser, importUser, parseJsonl, toJsonl } from '../transfer';
import type { Item } from '../types';

const endpoint = process.env.DYNAMODB_ENDPOINT;
if (process.env.CI && !endpoint) {
  throw new Error('DYNAMODB_ENDPOINT must be set in CI so the DynamoDB parity tests run');
}

const table = `store-transfer-${crypto.randomUUID()}`;
const raw = new DynamoDBClient({
  endpoint,
  region: 'eu-west-2',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const dynamo = new DynamoStore(
  DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } }),
  table,
);

const SOURCE_USER = 'auth0|roundtrip';
const SOURCE_PK = `USER#${SOURCE_USER}`;

// Ordered by SK, as both backends return them.
function sampleItems(pk: string): Item[] {
  return [
    { PK: pk, SK: 'CAT#c1', name: 'Garden', archivedAt: null, budget: 12.5, tags: ['a', 'b'] },
    { PK: pk, SK: 'TRASH#TARGET#c1', expiresAt: 4102444800, original: { name: 'Gone', nested: { deep: [1, null, 'x'] } } },
    {
      PK: pk,
      SK: 'TXN#2026-10#t1',
      amount: 350,
      split: { parts: [{ categoryId: 'c1', amount: 100 }, { categoryId: 'c2', amount: 250 }], note: null },
    },
  ];
}

const withPk = (items: Item[], pk: string): Item[] => items.map(item => ({ ...item, PK: pk }));

describe.skipIf(!endpoint)('export/import between DynamoDB Local and SQLite', () => {
  beforeAll(async () => {
    await raw.send(new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
    }));
  });

  afterAll(async () => {
    await raw.send(new DeleteTableCommand({ TableName: table }));
  });

  it('carries a user from DynamoDB to SQLite and back out unchanged', async () => {
    const original = sampleItems(SOURCE_PK);
    for (const item of original) await dynamo.put(item);
    await dynamo.put({ PK: SOURCE_PK, SK: 'PUSHSUB#hash', endpoint: 'https://example.test/x' });

    const exported = await exportUser(dynamo, SOURCE_USER);
    const sqlite = new SqliteStore(':memory:');
    await importUser(sqlite, parseJsonl(toJsonl(exported)), { asUser: 'local-1' });

    const roundTripped = await exportUser(sqlite, 'local-1');
    expect(roundTripped).toEqual(withPk(original, 'USER#local-1'));
    expect(roundTripped.some(item => item.SK.startsWith('PUSHSUB#'))).toBe(false);
  });

  it('carries a user from SQLite to DynamoDB unchanged', async () => {
    const sqlite = new SqliteStore(':memory:');
    const original = sampleItems('USER#local-2');
    for (const item of original) await sqlite.put(item);

    const exported = await exportUser(sqlite, 'local-2');
    await importUser(dynamo, parseJsonl(toJsonl(exported)), { asUser: 'auth0|from-sqlite' });

    const roundTripped = await exportUser(dynamo, 'auth0|from-sqlite');
    expect(roundTripped).toEqual(withPk(original, 'USER#auth0|from-sqlite'));
  });
});
