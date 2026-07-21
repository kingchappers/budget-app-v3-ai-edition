import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  txnSk: (ym: string, id: string) => `TXN#${ym}#${id}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function(i: unknown) { return i; }),
  PutCommand: vi.fn(function(i: unknown) { return i; }),
  DeleteCommand: vi.fn(function(i: unknown) { return i; }),
}));

import { getTransactions, createTransaction, deleteTransaction } from '../transactions';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(opts: {
  body?: object;
  query?: Record<string, string>;
  params?: Record<string, string>;
} = {}): APIGatewayProxyEventV2 {
  return {
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    queryStringParameters: opts.query || {},
    pathParameters: opts.params,
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getTransactions', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns transactions for a valid year and month', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ transactionId: 'txn-1' }] });
    const res = await getTransactions(makeEvent({ query: { year: '2025', month: '1' } }), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).transactions).toHaveLength(1);
  });

  it('returns 400 when year or month is missing', async () => {
    const res = await getTransactions(makeEvent({ query: { year: '2025' } }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid month', async () => {
    const res = await getTransactions(makeEvent({ query: { year: '2025', month: '13' } }), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});

describe('createTransaction', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates a transaction and returns 201', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createTransaction(
      makeEvent({ body: { amount: 1500, type: 'EXPENSE', categoryId: 'cat-food', description: 'Tesco', date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.transaction.amount).toBe(1500);
    expect(body.transaction.yearMonth).toBe('2025-01');
  });

  it('returns 400 for non-integer amount', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 15.50, type: 'EXPENSE', categoryId: 'cat-food', description: 'Tesco', date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid date format', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 1500, type: 'EXPENSE', categoryId: 'cat-food', description: 'Tesco', date: '15/01/2025' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid transaction type', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 1500, type: 'INVALID', categoryId: 'cat-food', description: 'Tesco', date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for description over 200 chars', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 100, type: 'EXPENSE', categoryId: 'cat-food', description: 'a'.repeat(201), date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('deleteTransaction', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes a transaction and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteTransaction(makeEvent(), 'user-1', { yearMonth: '2025-01', transactionId: 'some-uuid' });
    expect(res.statusCode).toBe(204);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid yearMonth format', async () => {
    const res = await deleteTransaction(makeEvent(), 'user-1', { yearMonth: '01-2025', transactionId: 'uuid' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when transactionId is missing', async () => {
    const res = await deleteTransaction(makeEvent(), 'user-1', { yearMonth: '2025-01' });
    expect(res.statusCode).toBe(400);
  });
});
