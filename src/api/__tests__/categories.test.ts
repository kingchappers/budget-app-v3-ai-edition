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

import { getCategories, createCategory, deleteCategory, updateCategory } from '../categories';
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
    expect(body.categories.some((c: any) => c.categoryId === 'cat-mortgage')).toBe(true);
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

  it('stores a valid group', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Joint Account', type: 'EXPENSE', group: 'BILLS' }), 'user-1', {});
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).category.group).toBe('BILLS');
    expect(mockSend.mock.calls[0][0].Item.group).toBe('BILLS');
  });

  it('defaults an EXPENSE category to EVERYDAY', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Padel', type: 'EXPENSE' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBe('EVERYDAY');
  });

  it('defaults a POT category to SINKING_FUNDS', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Boiler', type: 'POT' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBe('SINKING_FUNDS');
  });

  it.each([null, '', 5, 'NOPE', 'bills'])('returns 400 for invalid group %j', async (group) => {
    const res = await createCategory(makeEvent({ name: 'X', type: 'EXPENSE', group }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when a group is sent for an INCOME category', async () => {
    const res = await createCategory(makeEvent({ name: 'Bonus', type: 'INCOME', group: 'BILLS' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('stores no group for an INCOME category', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Bonus', type: 'INCOME' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBeUndefined();
  });

  it.each([
    ['EXPENSE', 'SAVING_INVESTMENT'],
    ['EXPENSE', 'SINKING_FUNDS'],
    ['POT', 'BILLS'],
    ['POT', 'EVERYDAY'],
  ])('returns 400 for %s with group %s', async (type, group) => {
    const res = await createCategory(makeEvent({ name: 'X', type, group }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    ['EXPENSE', 'BILLS'],
    ['EXPENSE', 'EVERYDAY'],
    ['POT', 'SINKING_FUNDS'],
    ['POT', 'SAVING_INVESTMENT'],
  ])('returns 201 for %s with group %s', async (type, group) => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'X', type, group }), 'user-1', {});
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 for the removed INVESTMENT type', async () => {
    const res = await createCategory(makeEvent({ name: 'X', type: 'INVESTMENT' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
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
    const res = await deleteCategory(makeEvent(), 'user-1', { categoryId: 'cat-mortgage' });
    expect(res.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await deleteCategory(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});

describe('updateCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  const existingCategory = {
    categoryId: 'custom-abc', name: 'Old Name', type: 'EXPENSE', icon: 'star',
    group: 'EVERYDAY', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('renames a custom category and returns 200, preserving other fields', async () => {
    mockSend.mockResolvedValueOnce({ Items: [existingCategory] });
    mockSend.mockResolvedValueOnce({});
    const res = await updateCategory(makeEvent({ name: 'New Name' }), 'user-1', { categoryId: 'custom-abc' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.category).toEqual({ ...existingCategory, name: 'New Name' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('trims the new name', async () => {
    mockSend.mockResolvedValueOnce({ Items: [existingCategory] });
    mockSend.mockResolvedValueOnce({});
    const res = await updateCategory(makeEvent({ name: '  Padel  ' }), 'user-1', { categoryId: 'custom-abc' });
    expect(JSON.parse(res.body).category.name).toBe('Padel');
  });

  it('returns 404 for a category that does not exist for this user', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await updateCategory(makeEvent({ name: 'New Name' }), 'user-1', { categoryId: 'unknown-id' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when trying to rename a default category', async () => {
    const res = await updateCategory(makeEvent({ name: 'New Name' }), 'user-1', { categoryId: 'cat-mortgage' });
    expect(res.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await updateCategory(makeEvent({ name: 'New Name' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for missing name', async () => {
    const res = await updateCategory(makeEvent({}), 'user-1', { categoryId: 'custom-abc' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty name', async () => {
    const res = await updateCategory(makeEvent({ name: '   ' }), 'user-1', { categoryId: 'custom-abc' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for name over 50 chars', async () => {
    const res = await updateCategory(makeEvent({ name: 'a'.repeat(51) }), 'user-1', { categoryId: 'custom-abc' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('falls back to a default icon instead of the string "undefined" for a legacy item with no icon', async () => {
    const { icon: _icon, ...noIcon } = existingCategory;
    mockSend.mockResolvedValueOnce({ Items: [noIcon] });
    mockSend.mockResolvedValueOnce({});
    const res = await updateCategory(makeEvent({ name: 'New Name' }), 'user-1', { categoryId: 'custom-abc' });
    expect(JSON.parse(res.body).category.icon).toBe('default');
  });
});
