import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  txnSk: (ym: string, id: string) => `TXN#${ym}#${id}`,
  inboxSk: (date: string, key: string) => `INBOX#${date}#${key}`,
  seenSk: (key: string) => `SEEN#${key}`,
}));

// inbox.ts imports validateTransactionInput from transactions.ts, which imports these commands too
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (i: unknown) { return i; }),
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
  PutCommand: vi.fn(function (i: unknown) { return i; }),
  DeleteCommand: vi.fn(function (i: unknown) { return i; }),
  TransactWriteCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { confirmInboxItem, decodeCursor, encodeCursor, getInbox, getInboxCount, ignoreInboxItem } from '../inbox';

const USER = 'user-1';
const KEY = 'a'.repeat(32);
const params = { bookingDate: '2026-09-10', txnKey: KEY };
const stored = {
  PK: 'USER#user-1', SK: `INBOX#2026-09-10#${KEY}`, txnKey: KEY, amount: 499, direction: 'OUT',
  suggestedType: 'EXPENSE', description: 'NETFLIX', bookingDate: '2026-09-10', connectionId: 'c1',
  accountUid: 'acc-1', importedAt: '2026-09-13T12:00:00.000Z',
};

const makeEvent = (opts: { body?: unknown; query?: Record<string, string> } = {}) => ({
  body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  queryStringParameters: opts.query ?? {},
  requestContext: { http: { method: 'POST' } },
} as unknown as APIGatewayProxyEventV2);

const cancelled = (codes: string[]) => Object.assign(new Error('cancelled'), {
  name: 'TransactionCanceledException', CancellationReasons: codes.map(Code => ({ Code })),
});

beforeEach(() => { mockSend.mockReset(); });

describe('cursor', () => {
  it('round-trips a key belonging to the user', () => {
    const cursor = encodeCursor({ PK: 'USER#user-1', SK: 'INBOX#2026-09-10#k' });
    expect(decodeCursor(cursor, USER)).toEqual({ PK: 'USER#user-1', SK: 'INBOX#2026-09-10#k' });
  });

  it.each([
    ['another user', { PK: 'USER#other', SK: 'INBOX#x' }],
    ['another item type', { PK: 'USER#user-1', SK: 'TXN#2026-09#x' }],
    ['extra keys', { PK: 'USER#user-1', SK: 'INBOX#x', admin: true }],
  ])('rejects a cursor for %s', (_label, key) => {
    expect(decodeCursor(encodeCursor(key), USER)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(decodeCursor('%%%', USER)).toBeNull();
  });
});

describe('getInbox', () => {
  it('returns items newest first without table keys and a next cursor', async () => {
    mockSend.mockResolvedValueOnce({ Items: [stored], LastEvaluatedKey: { PK: 'USER#user-1', SK: stored.SK } });
    const res = await getInbox(makeEvent(), USER, {});
    const body = JSON.parse(res.body);
    expect(body.items[0]).not.toHaveProperty('PK');
    expect(decodeCursor(body.cursor, USER)).toEqual({ PK: 'USER#user-1', SK: stored.SK });
    expect(mockSend.mock.calls[0][0]).toMatchObject({ ScanIndexForward: false, Limit: 50 });
  });

  it('rejects a forged cursor', async () => {
    const res = await getInbox(makeEvent({ query: { cursor: encodeCursor({ PK: 'USER#other', SK: 'INBOX#x' }) } }), USER, {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('getInboxCount', () => {
  it('sums counts across pages', async () => {
    mockSend
      .mockResolvedValueOnce({ Count: 2, LastEvaluatedKey: { PK: 'x', SK: 'y' } })
      .mockResolvedValueOnce({ Count: 3 });
    const res = await getInboxCount(makeEvent(), USER, {});
    expect(JSON.parse(res.body)).toEqual({ count: 5 });
  });
});

describe('confirmInboxItem', () => {
  it('uses the stored amount and date, ignoring any in the body', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(201);
    const [put, del, update] = mockSend.mock.calls[1][0].TransactItems;
    expect(put.Put.Item).toMatchObject({
      SK: `TXN#2026-09#${KEY}`, transactionId: KEY, amount: 499, date: '2026-09-10',
      source: 'BANK', bankRef: { connectionId: 'c1', accountUid: 'acc-1', txnKey: KEY },
    });
    expect(put.Put.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect(del.Delete.ConditionExpression).toBe('attribute_exists(SK)');
    expect(update.Update.ExpressionAttributeValues).toEqual({ ':outcome': 'CONFIRMED' });
  });

  it('rejects amount or date in the body', async () => {
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1', amount: 499900 } }), USER, params);
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('lets the user override the description', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
    await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1', description: 'Netflix' } }), USER, params);
    expect(mockSend.mock.calls[1][0].TransactItems[0].Put.Item.description).toBe('Netflix');
  });

  it('returns 404 when the inbox item is missing', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when a double-submit already removed the item', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockRejectedValueOnce(cancelled(['None', 'ConditionalCheckFailed', 'None']));
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when the transaction already exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None', 'None']));
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(409);
  });

  it.each([
    ['bad date', { bookingDate: '10-09-2026', txnKey: KEY }],
    ['bad key', { bookingDate: '2026-09-10', txnKey: 'short' }],
  ])('rejects %s in the path', async (_label, badParams) => {
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, badParams);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid type via the shared transaction validation', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored });
    const res = await confirmInboxItem(makeEvent({ body: { type: 'GIFT', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(400);
  });
});

describe('ignoreInboxItem', () => {
  it('deletes the inbox item and marks it ignored', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await ignoreInboxItem(makeEvent(), USER, params);
    expect(res.statusCode).toBe(204);
    const [del, update] = mockSend.mock.calls[0][0].TransactItems;
    expect(del.Delete.Key).toEqual({ PK: 'USER#user-1', SK: `INBOX#2026-09-10#${KEY}` });
    expect(update.Update.ExpressionAttributeValues).toEqual({ ':outcome': 'IGNORED' });
  });

  it('returns 404 when the item is already gone', async () => {
    mockSend.mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None']));
    const res = await ignoreInboxItem(makeEvent(), USER, params);
    expect(res.statusCode).toBe(404);
  });
});
