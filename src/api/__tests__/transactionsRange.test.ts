import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  catSk: (categoryId: string) => `CAT#${categoryId}`,
  potSk: (categoryId: string) => `POT#${categoryId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { getTransactionsRange } from '../transactionsRange';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function getEvent(from?: string, to?: string): APIGatewayProxyEventV2 {
  const queryStringParameters: Record<string, string> = {};
  if (from !== undefined) queryStringParameters.from = from;
  if (to !== undefined) queryStringParameters.to = to;
  return { queryStringParameters, requestContext: { http: { method: 'GET' } } } as unknown as APIGatewayProxyEventV2;
}

function txnItem(yearMonth: string, categoryId: string, amount = 100) {
  return { SK: `TXN#${yearMonth}#${categoryId}${amount}`, yearMonth, amount, type: 'EXPENSE', categoryId, description: '', date: `${yearMonth}-10`, createdAt: '' };
}

function useTransactionPages(pages: unknown[][]): void {
  let page = 0;
  mockSend.mockImplementation(async () => {
    const items = pages[page] ?? [];
    const last = page < pages.length - 1;
    page += 1;
    return last ? { Items: items, LastEvaluatedKey: { PK: 'x', SK: `page-${page}` } } : { Items: items };
  });
}

beforeEach(() => { mockSend.mockReset(); });

describe('getTransactionsRange validation', () => {
  it.each([
    ['missing from', getEvent(undefined, '2026-09')],
    ['missing to', getEvent('2026-01', undefined)],
    ['malformed from', getEvent('2026-1', '2026-09')],
    ['malformed to', getEvent('2026-01', '2026-9')],
    ['from after to', getEvent('2026-09', '2026-01')],
    ['span over 24 months', getEvent('2024-01', '2026-02')],
  ])('returns 400 for %s', async (_label, event) => {
    const res = await getTransactionsRange(event, 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('accepts a span of exactly 24 months', async () => {
    useTransactionPages([[]]);
    const res = await getTransactionsRange(getEvent('2024-10', '2026-09'), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });

  it('accepts a single-month span', async () => {
    useTransactionPages([[]]);
    const res = await getTransactionsRange(getEvent('2026-09', '2026-09'), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });
});

describe('getTransactionsRange', () => {
  it('filters to the requested months only', async () => {
    useTransactionPages([[
      txnItem('2026-06', 'cat-a'),
      txnItem('2026-07', 'cat-a'),
      txnItem('2026-08', 'cat-a'),
      txnItem('2026-09', 'cat-a'),
    ]]);
    const res = await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-1', {});
    const body = JSON.parse(res.body);
    expect(body.transactions.map((t: { yearMonth: string }) => t.yearMonth).sort()).toEqual(['2026-07', '2026-08']);
  });

  it('reads every page of transactions', async () => {
    useTransactionPages([[txnItem('2026-07', 'cat-a')], [txnItem('2026-08', 'cat-b')]]);
    const res = await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-1', {});
    expect(JSON.parse(res.body).transactions).toHaveLength(2);
  });

  it('scopes the query to the caller, not another user', async () => {
    useTransactionPages([[]]);
    await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-42', {});
    const call = mockSend.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':pk']).toBe('USER#user-42');
    expect(call.ExpressionAttributeValues[':prefix']).toBe('TXN#');
  });
});
