import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend, mockMoveToTrash } = vi.hoisted(() => ({ mockSend: vi.fn(), mockMoveToTrash: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  catSk: (categoryId: string) => `CAT#${categoryId}`,
  potSk: (categoryId: string) => `POT#${categoryId}`,
  recurringSk: (recurringId: string) => `RECUR#${recurringId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
  PutCommand: vi.fn(function (i: unknown) { return i; }),
}));

vi.mock('../trash', () => ({ moveToTrash: mockMoveToTrash }));

import { archivePot, unarchivePot } from '../potArchive';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function event(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

interface Store {
  customCategories?: unknown[];
  settings?: unknown[];
  transactions?: unknown[];
  recurring?: unknown[];
}

function useStore(store: Store): void {
  mockSend.mockImplementation(async (command: Record<string, any>) => {
    if (command.Item) return {};
    const values = command.ExpressionAttributeValues as Record<string, string>;
    if (values[':sk']?.startsWith('CAT#')) {
      const id = values[':sk'].slice(4);
      return { Items: (store.customCategories ?? []).filter((c: any) => c.categoryId === id) };
    }
    if (values[':sk']?.startsWith('POT#')) {
      const id = values[':sk'].slice(4);
      return { Items: (store.settings ?? []).filter((s: any) => s.categoryId === id) };
    }
    if (values[':prefix'] === 'CAT#') return { Items: store.customCategories ?? [] };
    if (values[':prefix'] === 'POT#') return { Items: store.settings ?? [] };
    if (values[':prefix'] === 'TXN#') return { Items: store.transactions ?? [] };
    if (values[':prefix'] === 'RECUR#') return { Items: store.recurring ?? [] };
    return { Items: [] };
  });
}

function txn(type: string, amount: number, yearMonth = '2026-10', categoryId = 'cat-garden') {
  return { categoryId, type, amount, yearMonth, transactionId: `${type}-${amount}` };
}

const gardenPot = { categoryId: 'cat-garden', name: 'Garden', type: 'POT', icon: 'tag', isDefault: false };

function puts(): Record<string, any>[] {
  return mockSend.mock.calls.map(call => call[0]).filter((c: any) => c.Item);
}

describe('archivePot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    mockSend.mockReset();
    mockMoveToTrash.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('archives an empty pot and stamps archivedAt', async () => {
    useStore({ customCategories: [gardenPot], transactions: [txn('SET_ASIDE', 5000), txn('TAKE_OUT', 5000)] });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(200);
    expect(puts()[0].Item).toMatchObject({
      PK: 'USER#user-1', SK: 'POT#cat-garden', categoryId: 'cat-garden', archivedAt: '2026-10-15T12:00:00.000Z',
    });
  });

  it('refuses with 409 and the balance while the pot still holds money', async () => {
    useStore({ customCategories: [gardenPot], transactions: [txn('SET_ASIDE', 5000), txn('TAKE_OUT', 1500)] });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ balance: 3500 });
    expect(puts()).toHaveLength(0);
    expect(mockMoveToTrash).not.toHaveBeenCalled();
  });

  it('reports a pot below zero as a negative balance', async () => {
    useStore({ customCategories: [gardenPot], transactions: [txn('EXPENSE', 2000)] });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).balance).toBe(-2000);
  });

  it('does not count this month\'s auto-contribution, because archiving stops it', async () => {
    useStore({
      customCategories: [gardenPot],
      settings: [{ categoryId: 'cat-garden', monthlyAmount: 5000, goalAmount: null, autoContribute: [{ from: '2026-10', amount: 5000 }], updatedAt: 'u' }],
    });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(200);
    const saved = puts()[0].Item;
    expect(saved.autoContribute).toEqual([]);
  });

  it('keeps earlier auto-contribution history and records the stop from this month', async () => {
    useStore({
      customCategories: [gardenPot],
      transactions: [txn('TAKE_OUT', 5000, '2026-09')],
      settings: [{ categoryId: 'cat-garden', monthlyAmount: 5000, goalAmount: 90000, autoContribute: [{ from: '2026-09', amount: 5000 }], updatedAt: 'u' }],
    });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(200);
    expect(puts()[0].Item).toMatchObject({
      goalAmount: 90000,
      monthlyAmount: 5000,
      autoContribute: [{ from: '2026-09', amount: 5000 }, { from: '2026-10', amount: 0 }],
    });
  });

  it('moves only this pot\'s recurring items to the trash', async () => {
    useStore({
      customCategories: [gardenPot],
      recurring: [
        { recurringId: 'r1', categoryId: 'cat-garden' },
        { recurringId: 'r2', categoryId: 'cat-other' },
        { recurringId: 'r3', categoryId: 'cat-garden' },
      ],
    });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).cancelledRecurring).toBe(2);
    expect(mockMoveToTrash).toHaveBeenCalledTimes(2);
    expect(mockMoveToTrash).toHaveBeenCalledWith('user-1', 'RECURRING', 'RECUR#r1');
    expect(mockMoveToTrash).toHaveBeenCalledWith('user-1', 'RECURRING', 'RECUR#r3');
  });

  it('works for a built-in pot that has no stored category or settings', async () => {
    useStore({});
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-holidays' });
    expect(res.statusCode).toBe(200);
    expect(puts()[0].Item).toMatchObject({ SK: 'POT#cat-holidays', monthlyAmount: null, goalAmount: null });
  });

  it('rejects a category that is not a pot', async () => {
    useStore({});
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-mortgage' });
    expect(res.statusCode).toBe(400);
    expect(puts()).toHaveLength(0);
  });

  it('rejects a category that does not exist', async () => {
    useStore({});
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'nope' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing or malformed month', async () => {
    useStore({ customCategories: [gardenPot] });
    expect((await archivePot(event({}), 'user-1', { categoryId: 'cat-garden' })).statusCode).toBe(400);
    expect((await archivePot(event({ month: '2026-13' }), 'user-1', { categoryId: 'cat-garden' })).statusCode).toBe(400);
    expect((await archivePot(event({ month: '2024-01' }), 'user-1', { categoryId: 'cat-garden' })).statusCode).toBe(400);
  });

  it('rejects unexpected body fields', async () => {
    useStore({ customCategories: [gardenPot] });
    const res = await archivePot(event({ month: '2026-10', archivedAt: 'x' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid JSON body', async () => {
    const bad = { body: '{nope', requestContext: { http: { method: 'POST' } } } as unknown as APIGatewayProxyEventV2;
    const res = await archivePot(bad, 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(400);
  });

  it('is safe to run again on an already archived pot', async () => {
    useStore({
      customCategories: [gardenPot],
      settings: [{ categoryId: 'cat-garden', monthlyAmount: null, goalAmount: null, autoContribute: [], archivedAt: '2026-09-01T00:00:00.000Z', updatedAt: 'u' }],
    });
    const res = await archivePot(event({ month: '2026-10' }), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(200);
    expect(puts()[0].Item.archivedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('unarchivePot', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockMoveToTrash.mockReset();
  });

  it('clears archivedAt and keeps the rest of the settings', async () => {
    useStore({
      customCategories: [gardenPot],
      settings: [{ categoryId: 'cat-garden', monthlyAmount: 5000, goalAmount: 90000, autoContribute: [{ from: '2026-09', amount: 0 }], archivedAt: '2026-10-01T00:00:00.000Z', updatedAt: 'u' }],
    });
    const res = await unarchivePot(event({}), 'user-1', { categoryId: 'cat-garden' });
    expect(res.statusCode).toBe(200);
    expect(puts()[0].Item).toMatchObject({
      categoryId: 'cat-garden', monthlyAmount: 5000, goalAmount: 90000, archivedAt: null,
      autoContribute: [{ from: '2026-09', amount: 0 }],
    });
  });

  it('does not bring cancelled recurring items back', async () => {
    useStore({ customCategories: [gardenPot] });
    await unarchivePot(event({}), 'user-1', { categoryId: 'cat-garden' });
    expect(mockMoveToTrash).not.toHaveBeenCalled();
  });

  it('rejects a category that is not a pot', async () => {
    useStore({});
    const res = await unarchivePot(event({}), 'user-1', { categoryId: 'cat-mortgage' });
    expect(res.statusCode).toBe(400);
  });
});
