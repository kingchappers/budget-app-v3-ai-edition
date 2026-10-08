import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SqliteStore } from '../../store/sqlite';
import { ConditionFailedError } from '../../store';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';
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

const txn = {
  transactionId: 't1', yearMonth: '2026-09', amount: 350, type: 'EXPENSE',
  categoryId: 'cat-dining', description: 'Coffee', date: '2026-09-29', createdAt: '2026-09-29T08:00:00.000Z',
};

function trashRecord(over: Record<string, unknown> = {}): Record<string, unknown> & { SK: string } {
  return {
    SK: 'TRASH#TRANSACTION#2026-09#t1',
    entityType: 'TRANSACTION',
    originalSk: 'TXN#2026-09#t1',
    item: txn,
    deletedAt: '2026-09-29T10:00:00.000Z',
    expiresAt: NOW_SECONDS + 1000,
    ...over,
  };
}

let store: SqliteStore;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store = useTestStore();
});

afterEach(() => {
  vi.useRealTimers();
  resetTestStore();
});

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
  it('moves the item into trash with the original key and a 30-day expiry', async () => {
    await seedUser(store, 'user-1', [{ SK: 'TXN#2026-09#t1', ...txn }]);
    await moveToTrash('user-1', 'TRANSACTION', 'TXN#2026-09#t1');
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' })).toBeUndefined();
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' })).toMatchObject({
      entityType: 'TRANSACTION',
      originalSk: 'TXN#2026-09#t1',
      item: txn,
      deletedAt: '2026-09-30T12:00:00.000Z',
      expiresAt: NOW_SECONDS + THIRTY_DAYS,
    });
  });

  it('does nothing when the item is already gone', async () => {
    await moveToTrash('user-1', 'TRANSACTION', 'TXN#2026-09#missing');
    expect(await store.query('USER#user-1')).toEqual([]);
  });

  it('treats an item that vanished before the write as already deleted', async () => {
    await seedUser(store, 'user-1', [{ SK: 'RECUR#r1', recurringId: 'r1' }]);
    vi.spyOn(store, 'transact').mockRejectedValueOnce(new ConditionFailedError(0));
    await expect(moveToTrash('user-1', 'RECURRING', 'RECUR#r1')).resolves.toBeUndefined();
  });

  it('rethrows a failure that is not an Error object, unchanged', async () => {
    await seedUser(store, 'user-1', [{ SK: 'RECUR#r1', recurringId: 'r1' }]);
    vi.spyOn(store, 'transact').mockRejectedValueOnce(null);
    await expect(moveToTrash('user-1', 'RECURRING', 'RECUR#r1')).rejects.toBeNull();
  });

  it('rethrows any other failure', async () => {
    await seedUser(store, 'user-1', [{ SK: 'RECUR#r1', recurringId: 'r1' }]);
    vi.spyOn(store, 'transact').mockRejectedValueOnce(new Error('boom'));
    await expect(moveToTrash('user-1', 'RECURRING', 'RECUR#r1')).rejects.toThrow('boom');
  });
});

describe('getTrash', () => {
  it('returns unexpired items newest first without keys', async () => {
    await seedUser(store, 'user-1', [
      trashRecord({ SK: 'TRASH#TRANSACTION#2026-09#old', originalSk: 'TXN#2026-09#old', deletedAt: '2026-09-01T00:00:00.000Z' }),
      trashRecord({ SK: 'TRASH#ACCOUNT#acc-1', entityType: 'ACCOUNT', originalSk: 'ACCOUNT#acc-1', item: { accountId: 'acc-1' }, deletedAt: '2026-09-29T00:00:00.000Z' }),
    ]);

    const res = await getTrash(event(), 'user-1', {});

    expect(res.statusCode).toBe(200);
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
    await seedUser(store, 'user-1', [trashRecord({ expiresAt: NOW_SECONDS - 1 })]);
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items).toEqual([]);
  });

  it('keeps an item that expires one second from now and drops one that expires exactly now', async () => {
    await seedUser(store, 'user-1', [
      trashRecord({ SK: 'TRASH#ACCOUNT#acc-1', entityType: 'ACCOUNT', originalSk: 'ACCOUNT#acc-1', expiresAt: NOW_SECONDS + 1 }),
      trashRecord({ SK: 'TRASH#ACCOUNT#acc-2', entityType: 'ACCOUNT', originalSk: 'ACCOUNT#acc-2', expiresAt: NOW_SECONDS }),
    ]);
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
    await seedUser(store, 'user-1', [trashRecord(damage)]);
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items).toEqual([]);
  });

  it('leaves out records of an unknown type', async () => {
    await seedUser(store, 'user-1', [trashRecord({ entityType: 'CATEGORY' })]);
    const res = await getTrash(event(), 'user-1', {});
    expect(JSON.parse(res.body).items).toEqual([]);
  });
});

describe('restoreFromTrash', () => {
  const body = { entityType: 'TRANSACTION', id: '2026-09#t1' };

  it('puts the original back and deletes the trash record', async () => {
    await seedUser(store, 'user-1', [trashRecord()]);

    const res = await restoreFromTrash(event(body), 'user-1', {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ entityType: 'TRANSACTION', id: '2026-09#t1', item: txn });
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' })).toEqual({ ...txn, PK: 'USER#user-1', SK: 'TXN#2026-09#t1' });
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' })).toBeUndefined();
  });

  it('returns 409 when the original already exists', async () => {
    await seedUser(store, 'user-1', [trashRecord(), { SK: 'TXN#2026-09#t1', amount: 999 }]);
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/already/);
  });

  it('returns 404 when the trash record was removed in the meantime', async () => {
    await seedUser(store, 'user-1', [trashRecord()]);
    vi.spyOn(store, 'transact').mockRejectedValueOnce(new ConditionFailedError(1));
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when there is no trash record', async () => {
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the trash record has expired', async () => {
    await seedUser(store, 'user-1', [trashRecord({ expiresAt: NOW_SECONDS - 1 })]);
    const transact = vi.spyOn(store, 'transact');
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(404);
    expect(transact).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON or input, without touching the store', async () => {
    const get = vi.spyOn(store, 'get');
    const transact = vi.spyOn(store, 'transact');
    expect((await restoreFromTrash(event('{not json'), 'user-1', {})).statusCode).toBe(400);
    expect((await restoreFromTrash(event([1]), 'user-1', {})).statusCode).toBe(400);
    expect((await restoreFromTrash(event({ entityType: 'NOPE', id: 'x' }), 'user-1', {})).statusCode).toBe(400);
    expect(get).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
  });

  it('rethrows unexpected failures', async () => {
    await seedUser(store, 'user-1', [trashRecord()]);
    vi.spyOn(store, 'transact').mockRejectedValueOnce(new Error('boom'));
    await expect(restoreFromTrash(event(body), 'user-1', {})).rejects.toThrow('boom');
  });
});

describe('expired entries that have not been purged yet', () => {
  it('hides them from getTrash even though they are still stored', async () => {
    await seedUser(store, 'user-1', [
      trashRecord({ SK: 'TRASH#TRANSACTION#2026-09#live', originalSk: 'TXN#2026-09#live', expiresAt: NOW_SECONDS + 1000 }),
      trashRecord({ SK: 'TRASH#TRANSACTION#2026-09#old', originalSk: 'TXN#2026-09#old', expiresAt: NOW_SECONDS - 1 }),
    ]);
    const res = await getTrash(event(), 'user-1', {});
    const ids = JSON.parse(res.body).items.map((entry: { id: string }) => entry.id);
    expect(ids).toEqual(['2026-09#live']);
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#old' })).toBeDefined();
  });

  it('refuses to restore one', async () => {
    await seedUser(store, 'user-1', [trashRecord({ expiresAt: NOW_SECONDS - 1 })]);
    const res = await restoreFromTrash(event({ entityType: 'TRANSACTION', id: '2026-09#t1' }), 'user-1', {});
    expect(res.statusCode).toBe(404);
  });
});

describe('restore races', () => {
  const body = { entityType: 'TRANSACTION', id: '2026-09#t1' };

  it('restores once and answers 404 the second time without duplicating anything', async () => {
    await seedUser(store, 'user-1', [trashRecord()]);
    expect((await restoreFromTrash(event(body), 'user-1', {})).statusCode).toBe(200);
    expect((await restoreFromTrash(event(body), 'user-1', {})).statusCode).toBe(404);
    expect(await store.query('USER#user-1', { skPrefix: 'TXN#' })).toHaveLength(1);
    expect(await store.query('USER#user-1', { skPrefix: 'TRASH#' })).toHaveLength(0);
  });

  it('answers 409 and keeps the trash entry when the item has been re-created', async () => {
    await seedUser(store, 'user-1', [trashRecord(), { SK: 'TXN#2026-09#t1', amount: 999 }]);
    const res = await restoreFromTrash(event(body), 'user-1', {});
    expect(res.statusCode).toBe(409);
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' })).toMatchObject({ amount: 999 });
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' })).toBeDefined();
  });
});
