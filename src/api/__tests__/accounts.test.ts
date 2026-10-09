import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { applyBalanceEntry, balanceAsOf, getAccounts, createAccount, updateAccount, deleteAccount, addBalance } from '../accounts';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { BalanceEntry } from '../types';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';

let store: SqliteStore;

function event(body?: unknown, params?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: params,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

function account(overrides: Partial<Record<string, unknown>> = {}) {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

function seedAccounts(accounts: Record<string, unknown>[], userId = 'user-1'): Promise<void> {
  return seedUser(store, userId, accounts.map((a) => ({ SK: `ACCOUNT#${a.accountId}`, ...a })));
}

beforeEach(() => {
  store = useTestStore();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  resetTestStore();
});

describe('applyBalanceEntry', () => {
  const entries: BalanceEntry[] = [{ date: '2026-08-01', pence: 1000 }, { date: '2026-09-01', pence: 2000 }];

  it('inserts a new date in sorted order', () => {
    expect(applyBalanceEntry(entries, '2026-08-15', 1500)).toEqual([
      { date: '2026-08-01', pence: 1000 }, { date: '2026-08-15', pence: 1500 }, { date: '2026-09-01', pence: 2000 },
    ]);
  });

  it('replaces an entry with the same date instead of duplicating it', () => {
    expect(applyBalanceEntry(entries, '2026-08-01', 1200)).toEqual([
      { date: '2026-08-01', pence: 1200 }, { date: '2026-09-01', pence: 2000 },
    ]);
  });

  it('starts a new list from empty', () => {
    expect(applyBalanceEntry([], '2026-09-01', 500)).toEqual([{ date: '2026-09-01', pence: 500 }]);
  });
});

describe('balanceAsOf', () => {
  const entries: BalanceEntry[] = [{ date: '2026-07-01', pence: 1000 }, { date: '2026-09-01', pence: 3000 }];

  it('is 0 before the first entry', () => {
    expect(balanceAsOf(entries, '2026-06-30')).toBe(0);
  });

  it('is the last entry at or before the date', () => {
    expect(balanceAsOf(entries, '2026-07-01')).toBe(1000);
    expect(balanceAsOf(entries, '2026-08-15')).toBe(1000);
    expect(balanceAsOf(entries, '2026-12-31')).toBe(3000);
  });

  it('is 0 for an account with no entries', () => {
    expect(balanceAsOf([], '2026-09-15')).toBe(0);
  });
});

describe('getAccounts', () => {
  it('returns every account for the caller', async () => {
    await seedAccounts([account({ accountId: 'acc-1' }), account({ accountId: 'acc-2', kind: 'LIABILITY', type: 'LOAN' })]);
    const res = await getAccounts(event(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).accounts).toHaveLength(2);
  });

  it('is scoped to the caller', async () => {
    await seedAccounts([account({ accountId: 'acc-1' })], 'user-1');
    await seedAccounts([account({ accountId: 'acc-42' })], 'user-42');
    const res = await getAccounts(event(), 'user-42', {});
    expect(JSON.parse(res.body).accounts.map((a: { accountId: string }) => a.accountId)).toEqual(['acc-42']);
  });

  it('strips the raw DynamoDB key fields from the response', async () => {
    await seedAccounts([account()]);
    const res = await getAccounts(event(), 'user-1', {});
    const [returned] = JSON.parse(res.body).accounts;
    expect(returned).not.toHaveProperty('PK');
    expect(returned).not.toHaveProperty('SK');
  });
});

describe('createAccount', () => {
  it('creates an asset account', async () => {
    const res = await createAccount(event({ name: 'Lloyds', kind: 'ASSET', type: 'CASH' }), 'user-1', {});
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.account).toMatchObject({ name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [] });
    expect(await store.get({ PK: 'USER#user-1', SK: `ACCOUNT#${body.account.accountId}` })).toMatchObject({ name: 'Lloyds' });
  });

  it.each([
    ['missing name', { kind: 'ASSET', type: 'CASH' }],
    ['blank name', { name: '  ', kind: 'ASSET', type: 'CASH' }],
    ['invalid kind', { name: 'X', kind: 'SPARE', type: 'CASH' }],
    ['type does not match kind (liability type on an asset)', { name: 'X', kind: 'ASSET', type: 'LOAN' }],
    ['type does not match kind (asset type on a liability)', { name: 'X', kind: 'LIABILITY', type: 'CASH' }],
  ])('returns 400 for %s', async (_label, body) => {
    const spy = vi.spyOn(store, 'put');
    const res = await createAccount(event(body), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('updateAccount', () => {
  it('renames and changes the type within the same kind', async () => {
    await seedAccounts([account({ type: 'CASH' })]);
    const res = await updateAccount(event({ name: 'Lloyds current', type: 'SAVINGS' }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).account).toMatchObject({ name: 'Lloyds current', type: 'SAVINGS', kind: 'ASSET' });
  });

  it('ignores a kind sent in the body rather than changing it', async () => {
    await seedAccounts([account({ kind: 'ASSET', type: 'CASH' })]);
    const res = await updateAccount(event({ name: 'Lloyds', type: 'CASH', kind: 'LIABILITY' }), 'user-1', { accountId: 'acc-1' });
    expect(JSON.parse(res.body).account.kind).toBe('ASSET');
  });

  it('returns 400 when the new type does not match the existing kind', async () => {
    await seedAccounts([account({ kind: 'ASSET' })]);
    const res = await updateAccount(event({ name: 'Lloyds', type: 'LOAN' }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a missing account', async () => {
    const res = await updateAccount(event({ name: 'X', type: 'CASH' }), 'user-1', { accountId: 'acc-missing' });
    expect(res.statusCode).toBe(404);
  });
});

describe('deleteAccount', () => {
  it('moves the account and its balance history to the trash and returns 204', async () => {
    const stored = account({ balances: [{ date: '2026-09-01', pence: 250000 }] });
    await seedAccounts([stored]);
    const res = await deleteAccount(event(), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(204);
    expect(await store.get({ PK: 'USER#user-1', SK: 'ACCOUNT#acc-1' })).toBeUndefined();
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#ACCOUNT#acc-1' })).toMatchObject({ entityType: 'ACCOUNT', item: stored });
  });
});

describe('addBalance', () => {
  const valid = { date: '2026-09-15', pence: 250000 };

  it('appends a balance entry', async () => {
    await seedAccounts([account({ balances: [{ date: '2026-08-01', pence: 200000 }] })]);
    const res = await addBalance(event(valid), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).account.balances).toEqual([{ date: '2026-08-01', pence: 200000 }, valid]);
  });

  it.each([
    ['missing date', { pence: 100 }],
    ['malformed date', { date: '2026-9-15', pence: 100 }],
    ['date too far ahead', { date: '2026-09-17', pence: 100 }],
    ['a day that does not exist (rolls over instead of erroring)', { date: '2026-02-31', pence: 100 }],
    ['a month that does not exist', { date: '2026-13-01', pence: 100 }],
    ['fractional pence', { date: '2026-09-15', pence: 100.5 }],
    ['pence over the cap', { date: '2026-09-15', pence: 1_000_000_001 }],
    ['pence under the negative cap', { date: '2026-09-15', pence: -1_000_000_001 }],
  ])('returns 400 for %s', async (_label, body) => {
    await seedAccounts([account()]);
    const res = await addBalance(event(body), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a date one day ahead of the server', async () => {
    await seedAccounts([account()]);
    const res = await addBalance(event({ date: '2026-09-16', pence: 100 }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a zero balance, for an account paid off or closed', async () => {
    await seedAccounts([account()]);
    const res = await addBalance(event({ date: '2026-09-15', pence: 0 }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a negative balance, for an overdrawn account', async () => {
    await seedAccounts([account()]);
    const res = await addBalance(event({ date: '2026-09-15', pence: -5000 }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).account.balances).toEqual([{ date: '2026-09-15', pence: -5000 }]);
  });

  it('returns 404 for a missing account', async () => {
    const res = await addBalance(event(valid), 'user-1', { accountId: 'acc-missing' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when the entry would push the history over the cap', async () => {
    const full: BalanceEntry[] = Array.from({ length: 500 }, (_, i) => ({
      date: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, pence: 100,
    }));
    await seedAccounts([account({ balances: full })]);
    const res = await addBalance(event({ date: '2026-09-15', pence: 999 }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(400);
  });
});
