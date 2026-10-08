import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getTransactionsRange } from '../transactionsRange';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';

let store: SqliteStore;

function getEvent(from?: string, to?: string): APIGatewayProxyEventV2 {
  const queryStringParameters: Record<string, string> = {};
  if (from !== undefined) queryStringParameters.from = from;
  if (to !== undefined) queryStringParameters.to = to;
  return { queryStringParameters, requestContext: { http: { method: 'GET' } } } as unknown as APIGatewayProxyEventV2;
}

function txnItem(yearMonth: string, categoryId: string, amount = 100) {
  return { SK: `TXN#${yearMonth}#${categoryId}${amount}`, yearMonth, amount, type: 'EXPENSE', categoryId, description: '', date: `${yearMonth}-10`, createdAt: '' };
}

beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

describe('getTransactionsRange validation', () => {
  it.each([
    ['missing from', getEvent(undefined, '2026-09')],
    ['missing to', getEvent('2026-01', undefined)],
    ['malformed from', getEvent('2026-1', '2026-09')],
    ['malformed to', getEvent('2026-01', '2026-9')],
    ['from after to', getEvent('2026-09', '2026-01')],
    ['span over 24 months', getEvent('2024-01', '2026-02')],
  ])('returns 400 for %s', async (_label, event) => {
    const spy = vi.spyOn(store, 'query');
    const res = await getTransactionsRange(event, 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts a span of exactly 24 months', async () => {
    const res = await getTransactionsRange(getEvent('2024-10', '2026-09'), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });

  it('accepts a single-month span', async () => {
    const res = await getTransactionsRange(getEvent('2026-09', '2026-09'), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });
});

describe('getTransactionsRange', () => {
  it('filters to the requested months only', async () => {
    await seedUser(store, 'user-1', [
      txnItem('2026-06', 'cat-a'),
      txnItem('2026-07', 'cat-a'),
      txnItem('2026-08', 'cat-a'),
      txnItem('2026-09', 'cat-a'),
    ]);
    const res = await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-1', {});
    const body = JSON.parse(res.body);
    expect(body.transactions.map((t: { yearMonth: string }) => t.yearMonth).sort()).toEqual(['2026-07', '2026-08']);
  });

  it('scopes the query to the caller, not another user', async () => {
    await seedUser(store, 'user-42', [txnItem('2026-07', 'cat-mine')]);
    await seedUser(store, 'user-1', [txnItem('2026-07', 'cat-other')]);
    const res = await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-42', {});
    const ids = JSON.parse(res.body).transactions.map((t: { categoryId: string }) => t.categoryId);
    expect(ids).toEqual(['cat-mine']);
  });
});
