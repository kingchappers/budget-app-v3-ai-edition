import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  catSk: (categoryId: string) => `CAT#${categoryId}`,
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

  it('reassigns to a non-default category that exists, running the existence check query', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ SK: 'CAT#cat-side-hustle' }] }); // existence check
    mockSend.mockResolvedValueOnce({ Items: [
      { SK: 'TXN#2026-07#a', categoryId: 'cat-custom' },
    ] }); // transaction query
    mockSend.mockResolvedValue({}); // update

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-side-hustle' }), 'user-1', { categoryId: 'cat-custom' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(1);
    expect(mockSend.mock.calls[0][0].ExpressionAttributeValues[':sk']).toBe('CAT#cat-side-hustle');
    expect(mockSend.mock.calls[2][0].ExpressionAttributeValues[':c']).toBe('cat-side-hustle');
  });

  it('paginates the transaction query across LastEvaluatedKey pages and reassigns items from both', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ SK: 'TXN#2026-06#a', categoryId: 'cat-custom' }],
      LastEvaluatedKey: { PK: 'USER#user-1', SK: 'TXN#2026-06#a' },
    });
    mockSend.mockResolvedValueOnce({
      Items: [{ SK: 'TXN#2026-07#b', categoryId: 'cat-custom' }],
    });
    mockSend.mockResolvedValue({});

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(2);

    const updateCalls = mockSend.mock.calls.filter(call => call[0].Key);
    const updatedSks = updateCalls.map(call => call[0].Key.SK);
    expect(updatedSks).toEqual(expect.arrayContaining(['TXN#2026-06#a', 'TXN#2026-07#b']));
  });

  it('follows ExclusiveStartKey when requesting the second page', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ SK: 'TXN#2026-06#a', categoryId: 'cat-custom' }],
      LastEvaluatedKey: { PK: 'USER#user-1', SK: 'TXN#2026-06#a' },
    });
    mockSend.mockResolvedValueOnce({
      Items: [{ SK: 'TXN#2026-07#b', categoryId: 'cat-custom' }],
    });
    mockSend.mockResolvedValue({});

    await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    const queryCalls = mockSend.mock.calls.filter(call => call[0].KeyConditionExpression?.includes('begins_with'));
    expect(queryCalls[0][0].ExclusiveStartKey).toBeUndefined();
    expect(queryCalls[1][0].ExclusiveStartKey).toEqual({ PK: 'USER#user-1', SK: 'TXN#2026-06#a' });
  });

  it('skips items that fail the existence check (deleted/moved between query and update) without failing the request', async () => {
    mockSend.mockResolvedValueOnce({ Items: [
      { SK: 'TXN#2026-07#a', categoryId: 'cat-custom' },
      { SK: 'TXN#2026-07#b', categoryId: 'cat-custom' },
      { SK: 'TXN#2026-07#c', categoryId: 'cat-custom' },
    ] });

    mockSend.mockImplementation((cmd: { Key?: { SK: string } }) => {
      if (cmd.Key?.SK === 'TXN#2026-07#b') {
        const error = new Error('The conditional request failed');
        error.name = 'ConditionalCheckFailedException';
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(2);
  });

  it('adds a ConditionExpression requiring the item to still exist on every update', async () => {
    mockSend.mockResolvedValueOnce({ Items: [
      { SK: 'TXN#2026-07#a', categoryId: 'cat-custom' },
    ] });
    mockSend.mockResolvedValue({});

    await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    const updateCall = mockSend.mock.calls.find(call => call[0].Key);
    expect(updateCall).toBeDefined();
    expect(updateCall![0].ConditionExpression).toBe('attribute_exists(SK)');
  });
});
