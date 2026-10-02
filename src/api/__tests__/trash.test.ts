import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
  GetCommand: vi.fn(function (i: unknown) { return i; }),
  TransactWriteCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { getTrash, moveToTrash, restoreFromTrash, validateRestoreInput } from '../trash';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60;

function event(body?: unknown): APIGatewayProxyEventV2 {
  return {
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    queryStringParameters: {},
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

function cancelled(codes: string[]): Error {
  const error = new Error('Transaction cancelled') as Error & { CancellationReasons: { Code: string }[] };
  error.name = 'TransactionCanceledException';
  error.CancellationReasons = codes.map(Code => ({ Code }));
  return error;
}

const txn = {
  transactionId: 't1', yearMonth: '2026-09', amount: 350, type: 'EXPENSE',
  categoryId: 'cat-dining', description: 'Coffee', date: '2026-09-29', createdAt: '2026-09-29T08:00:00.000Z',
};

function trashRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PK: 'USER#user-1',
    SK: 'TRASH#TRANSACTION#2026-09#t1',
    entityType: 'TRANSACTION',
    originalSk: 'TXN#2026-09#t1',
    item: txn,
    deletedAt: '2026-09-29T10:00:00.000Z',
    expiresAt: NOW_SECONDS + 1000,
    ...over,
  };
}

beforeEach(() => {
  mockSend.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => { vi.useRealTimers(); });

describe('validateRestoreInput', () => {
  it('accepts each entity type with a well-formed id', () => {
    expect(validateRestoreInput({ entityType: 'TRANSACTION', id: '2026-09#t1' }).ok).toBe(true);
    expect(validateRestoreInput({ entityType: 'TARGET', id: 'cat-food' }).ok).toBe(true);
    expect(validateRestoreInput({ entityType: 'RECURRING', id: 'r1' }).ok).toBe(true);
    expect(validateRestoreInput({ entityType: 'ACCOUNT', id: 'acc-1' }).ok).toBe(true);
  });

  it('rejects an unknown entity type', () => {
    expect(validateRestoreInput({ entityType: 'CATEGORY', id: 'cat-food' }).ok).toBe(false);
  });

  it('rejects a missing or non-string field', () => {
    expect(validateRestoreInput({ id: 'r1' }).ok).toBe(false);
    expect(validateRestoreInput({ entityType: 'RECURRING' }).ok).toBe(false);
    expect(validateRestoreInput({ entityType: 'RECURRING', id: 42 }).ok).toBe(false);
  });

  it('rejects an id with characters outside the allowlist or over 100 characters', () => {
    expect(validateRestoreInput({ entityType: 'RECURRING', id: 'r1#x' }).ok).toBe(false);
    expect(validateRestoreInput({ entityType: 'RECURRING', id: '' }).ok).toBe(false);
    expect(validateRestoreInput({ entityType: 'RECURRING', id: 'a'.repeat(101) }).ok).toBe(false);
  });

  it('requires a transaction id to carry its month', () => {
    expect(validateRestoreInput({ entityType: 'TRANSACTION', id: 't1' }).ok).toBe(false);
    expect(validateRestoreInput({ entityType: 'TRANSACTION', id: '2026-13#t1' }).ok).toBe(false);
  });

  it('rejects unexpected fields', () => {
    expect(validateRestoreInput({ entityType: 'RECURRING', id: 'r1', PK: 'USER#someone' }).ok).toBe(false);
  });
});

describe('moveToTrash', () => {
  it('deletes the original and writes the trash record in one transaction', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'TXN#2026-09#t1', ...txn } });
    mockSend.mockResolvedValueOnce({});

    await moveToTrash('user-1', 'TRANSACTION', 'TXN#2026-09#t1');

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].Key).toEqual({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' });
    const { TransactItems } = mockSend.mock.calls[1][0];
    expect(TransactItems).toHaveLength(2);
    expect(TransactItems[0].Delete).toEqual({
      TableName: 'test-table',
      Key: { PK: 'USER#user-1', SK: 'TXN#2026-09#t1' },
      ConditionExpression: 'attribute_exists(PK)',
    });
    expect(TransactItems[1].Put).toEqual({
      TableName: 'test-table',
      Item: {
        PK: 'USER#user-1',
        SK: 'TRASH#TRANSACTION#2026-09#t1',
        entityType: 'TRANSACTION',
        originalSk: 'TXN#2026-09#t1',
        item: txn,
        deletedAt: '2026-09-30T12:00:00.000Z',
        expiresAt: NOW_SECONDS + THIRTY_DAYS,
      },
    });
  });

  it('writes nothing when the item does not exist', async () => {
    mockSend.mockResolvedValueOnce({});
    await moveToTrash('user-1', 'RECURRING', 'RECUR#r1');
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('treats an item that vanished before the write as already deleted', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'RECUR#r1', recurringId: 'r1' } });
    mockSend.mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None']));
    await expect(moveToTrash('user-1', 'RECURRING', 'RECUR#r1')).resolves.toBeUndefined();
  });

  it('rethrows a failure that is not an Error object, unchanged', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'RECUR#r1', recurringId: 'r1' } });
    mockSend.mockRejectedValueOnce(null);
    await expect(moveToTrash('user-1', 'RECURRING', 'RECUR#r1')).rejects.toBeNull();
  });

  it('rethrows any other failure', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'RECUR#r1', recurringId: 'r1' } });
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(moveToTrash('user-1', 'RECURRING', 'RECUR#r1')).rejects.toThrow('boom');
  });
});

describe('getTrash', () => {
  it('returns unexpired items newest first without keys', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        trashRecord({ SK: 'TRASH#TRANSACTION#2026-09#old', originalSk: 'TXN#2026-09#old', deletedAt: '2026-09-01T00:00:00.000Z' }),
        trashRecord({ SK: 'TRASH#ACCOUNT#acc-1', entityType: 'ACCOUNT', originalSk: 'ACCOUNT#acc-1', item: { accountId: 'acc-1' }, deletedAt: '2026-09-29T00:00:00.000Z' }),
      ],
    });

    const res = await getTrash(event(), 'user-1', {});

    expect(res.statusCode).toBe(200);
    expect(mockSend.mock.calls[0][0].ExpressionAttributeValues).toEqual({ ':pk': 'USER#user-1', ':prefix': 'TRASH#' });
    const { items } = JSON.parse(res.body);
    expect(items.map((i: { id: string }) => i.id)).toEqual(['acc-1', '2026-09#old']);
    expect(items[0]).toEqual({
      entityType: 'ACCOUNT', id: 'acc-1', item: { accountId: 'acc-1' },
      deletedAt: '2026-09-29T00:00:00.000Z', expiresAt: NOW_SECONDS + 1000,
    });
    expect(res.body).not.toContain('USER#');
    expect(res.body).not.toContain('TRASH#');
  });

  it('leaves out items whose expiry has passed but TTL has not yet removed', async () => {
    mockSend.mockResolvedValueOnce({ Items: [trashRecord({ expiresAt: NOW_SECONDS - 1 })] });
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items).toEqual([]);
  });

  it('keeps an item that expires one second from now and drops one that expires exactly now', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        trashRecord({ SK: 'TRASH#ACCOUNT#acc-1', entityType: 'ACCOUNT', originalSk: 'ACCOUNT#acc-1', expiresAt: NOW_SECONDS + 1 }),
        trashRecord({ SK: 'TRASH#ACCOUNT#acc-2', entityType: 'ACCOUNT', originalSk: 'ACCOUNT#acc-2', expiresAt: NOW_SECONDS }),
      ],
    });
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items.map((i: { id: string }) => i.id)).toEqual(['acc-1']);
  });

  it.each([
    ['originalSk', { originalSk: undefined }],
    ['deletedAt', { deletedAt: undefined }],
    ['expiresAt', { expiresAt: '9999999999' }],
    ['item, when it is missing', { item: undefined }],
    ['item, when it is null', { item: null }],
    ['item, when it is not an object', { item: 'text' }],
  ])('leaves out a damaged record with a bad %s', async (_label, damage) => {
    mockSend.mockResolvedValueOnce({ Items: [trashRecord(damage)] });
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items).toEqual([]);
  });

  it('leaves out records of an unknown type', async () => {
    mockSend.mockResolvedValueOnce({ Items: [trashRecord({ entityType: 'CATEGORY' })] });
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items).toEqual([]);
  });
});

describe('restoreFromTrash', () => {
  const body = { entityType: 'TRANSACTION', id: '2026-09#t1' };

  it('puts the original back and deletes the trash record in one transaction', async () => {
    mockSend.mockResolvedValueOnce({ Item: trashRecord() });
    mockSend.mockResolvedValueOnce({});

    const res = await restoreFromTrash(event(body), 'user-1', {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ entityType: 'TRANSACTION', id: '2026-09#t1', item: txn });
    expect(mockSend.mock.calls[0][0].Key).toEqual({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' });
    const { TransactItems } = mockSend.mock.calls[1][0];
    expect(TransactItems[0].Put).toEqual({
      TableName: 'test-table',
      Item: { ...txn, PK: 'USER#user-1', SK: 'TXN#2026-09#t1' },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
    expect(TransactItems[1].Delete).toEqual({
      TableName: 'test-table',
      Key: { PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' },
      ConditionExpression: 'attribute_exists(PK)',
    });
  });

  it('returns 409 when the original already exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: trashRecord() });
    mockSend.mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None']));
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/already/);
  });

  it('returns 404 when the trash record was removed in the meantime', async () => {
    mockSend.mockResolvedValueOnce({ Item: trashRecord() });
    mockSend.mockRejectedValueOnce(cancelled(['None', 'ConditionalCheckFailed']));
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when there is no trash record', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(404);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 404 when the trash record has expired', async () => {
    mockSend.mockResolvedValueOnce({ Item: trashRecord({ expiresAt: NOW_SECONDS - 1 }) });
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(404);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid JSON or input, without touching the table', async () => {
    expect((await restoreFromTrash(event('{not json'), 'user-1', {})).statusCode).toBe(400);
    expect((await restoreFromTrash(event([1]), 'user-1', {})).statusCode).toBe(400);
    expect((await restoreFromTrash(event({ entityType: 'NOPE', id: 'x' }), 'user-1', {})).statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rethrows unexpected failures', async () => {
    mockSend.mockResolvedValueOnce({ Item: trashRecord() });
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(restoreFromTrash(event(body), 'user-1', {})).rejects.toThrow('boom');
  });
});
