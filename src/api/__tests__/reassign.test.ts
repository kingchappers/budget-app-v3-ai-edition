import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function(i: unknown) { return i; }),
  UpdateCommand: vi.fn(function(i: unknown) { return i; }),
}));

import { reassignCategory } from '../reassign';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: object): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('reassignCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('reassigns every matching transaction across months', async () => {
    mockSend.mockResolvedValueOnce({ Items: [
      { SK: 'TXN#2026-06#a', categoryId: 'cat-custom' },
      { SK: 'TXN#2026-07#b', categoryId: 'cat-custom' },
      { SK: 'TXN#2026-07#c', categoryId: 'cat-food' },
    ] });
    mockSend.mockResolvedValue({});

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[1][0].Key.SK).toBe('TXN#2026-06#a');
    expect(mockSend.mock.calls[1][0].ExpressionAttributeValues[':c']).toBe('cat-entertainment');
  });

  it('returns 200 with zero when nothing matches', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ SK: 'TXN#2026-07#c', categoryId: 'cat-food' }] });
    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(0);
  });

  it('rejects reassigning a category to itself', async () => {
    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-custom' }), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a missing toCategoryId', async () => {
    const res = await reassignCategory(makeEvent({}), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown target category', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-nonexistent' }), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(400);
  });
});
