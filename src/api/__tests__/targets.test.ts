import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  targetSk: (categoryId: string) => `TARGET#${categoryId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function(i: unknown) { return i; }),
  PutCommand: vi.fn(function(i: unknown) { return i; }),
  DeleteCommand: vi.fn(function(i: unknown) { return i; }),
}));

import { getTargets, upsertTarget, deleteTarget } from '../targets';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: object): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getTargets', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns all targets for the user', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ categoryId: 'cat-food', targetAmount: 30000, period: 'MONTHLY' }] });
    const res = await getTargets(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).targets).toHaveLength(1);
  });
});

describe('upsertTarget', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates or updates a target and returns 200', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.target.targetAmount).toBe(30000);
    expect(body.target.period).toBe('MONTHLY');
  });

  it('returns 400 for non-integer targetAmount', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 300.50, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid period', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'YEARLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'MONTHLY' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('deleteTarget', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes a target and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteTarget(makeEvent(), 'user-1', { categoryId: 'cat-food' });
    expect(res.statusCode).toBe(204);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await deleteTarget(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});
