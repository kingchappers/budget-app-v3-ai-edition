import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { getInsights, MIN_INSIGHTS_MONTHS, MAX_INSIGHTS_MONTHS } from '../insights';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function getEvent(query: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    queryStringParameters: query,
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

interface Store {
  customCategories?: unknown[];
  transactionPages?: unknown[][];
}

function useStore(store: Store): void {
  let page = 0;
  mockSend.mockImplementation(async (command: Record<string, any>) => {
    const values = command.ExpressionAttributeValues as Record<string, string>;
    if (values[':prefix'] === 'CAT#') return { Items: store.customCategories ?? [] };
    const pages = store.transactionPages ?? [[]];
    const items = pages[page] ?? [];
    const last = page < pages.length - 1;
    page += 1;
    return last ? { Items: items, LastEvaluatedKey: { PK: 'x', SK: `page-${page}` } } : { Items: items };
  });
}

beforeEach(() => {
  mockSend.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
});

afterEach(() => { vi.useRealTimers(); });

describe('getInsights', () => {
  it.each([undefined, '', '2026-13', '2026-9', 'nope', '2026-11'])('returns 400 for asOf %j', async (asOf) => {
    const res = await getInsights(getEvent(asOf === undefined ? {} : { asOf }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('accepts a past month and the month after the server month', async () => {
    useStore({});
    expect((await getInsights(getEvent({ asOf: '2024-01' }), 'user-1', {})).statusCode).toBe(200);
    expect((await getInsights(getEvent({ asOf: '2026-10' }), 'user-1', {})).statusCode).toBe(200);
  });

  it.each(['2', '13', '6.5', 'abc'])('returns 400 for an out-of-range months value %j', async (months) => {
    const res = await getInsights(getEvent({ asOf: '2026-09', months }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([String(MIN_INSIGHTS_MONTHS), String(MAX_INSIGHTS_MONTHS)])('accepts a months value at the boundary %j', async (months) => {
    useStore({});
    const res = await getInsights(getEvent({ asOf: '2026-09', months }), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });

  it('defaults months to 6 when omitted', async () => {
    useStore({});
    const body = JSON.parse((await getInsights(getEvent({ asOf: '2026-09' }), 'user-1', {})).body);
    expect(body.months).toHaveLength(6);
  });

  it('includes default and custom EXPENSE categories', async () => {
    useStore({
      customCategories: [{ categoryId: 'custom-spend', name: 'Padel', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag' }],
    });
    const body = JSON.parse((await getInsights(getEvent({ asOf: '2026-09', months: '3' }), 'user-1', {})).body);
    const ids = body.categories.map((c: { categoryId: string }) => c.categoryId);
    expect(ids).toContain('custom-spend');
    expect(ids).toContain('cat-groceries');
  });

  it('derives totals from every page of transactions', async () => {
    useStore({
      transactionPages: [
        [{ yearMonth: '2026-08', amount: 1000, type: 'EXPENSE', categoryId: 'cat-groceries', description: '', date: '2026-08-10', createdAt: '' }],
        [{ yearMonth: '2026-09', amount: 2000, type: 'EXPENSE', categoryId: 'cat-groceries', description: '', date: '2026-09-10', createdAt: '' }],
      ],
    });
    const body = JSON.parse((await getInsights(getEvent({ asOf: '2026-09', months: '3' }), 'user-1', {})).body);
    const groceries = body.categories.find((c: { categoryId: string }) => c.categoryId === 'cat-groceries');
    expect(groceries.total).toBe(3000);
    const transactionQueries = mockSend.mock.calls.filter(([c]) => c.ExpressionAttributeValues[':prefix'] === 'TXN#');
    expect(transactionQueries).toHaveLength(2);
  });
});
