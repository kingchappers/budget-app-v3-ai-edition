import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  catSk: (categoryId: string) => `CAT#${categoryId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
  PutCommand: vi.fn(function (i: unknown) { return i; }),
  DeleteCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { getCategories, createCategory, deleteCategory } from '../categories';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: object, params?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    pathParameters: params,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getCategories', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns default categories plus user custom categories', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ categoryId: 'custom-1', name: 'My Cat', type: 'EXPENSE', icon: 'star', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const res = await getCategories(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.categories.some((c: any) => c.categoryId === 'cat-housing')).toBe(true);
    expect(body.categories.some((c: any) => c.categoryId === 'custom-1')).toBe(true);
  });
});

describe('createCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates a category and returns 201', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(
      makeEvent({ name: 'My Custom Cat', type: 'EXPENSE', icon: 'star' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.category.name).toBe('My Custom Cat');
    expect(body.category.isDefault).toBe(false);
  });

  it('returns 400 for missing name', async () => {
    const res = await createCategory(makeEvent({ type: 'EXPENSE' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid type', async () => {
    const res = await createCategory(makeEvent({ name: 'X', type: 'INVALID' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for name over 50 chars', async () => {
    const res = await createCategory(
      makeEvent({ name: 'a'.repeat(51), type: 'EXPENSE' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('deleteCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes a custom category and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteCategory(makeEvent(), 'user-1', { categoryId: 'custom-abc' });
    expect(res.statusCode).toBe(204);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 403 when trying to delete a default category', async () => {
    const res = await deleteCategory(makeEvent(), 'user-1', { categoryId: 'cat-housing' });
    expect(res.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await deleteCategory(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});
