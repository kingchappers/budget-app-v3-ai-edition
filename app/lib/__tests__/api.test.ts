import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../api';
import type { AccessToken, Category, Recurring } from '../types';

const recurring: Recurring = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: 'c', updatedAt: 'u',
};
const input = { type: 'INCOME' as const, categoryId: 'cat-salary', amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3 };

describe('recurring API calls', () => {
  it('lists templates', async () => {
    const request = vi.fn().mockResolvedValue({ recurring: [recurring] });
    expect(await createApi(request).getRecurring()).toEqual([recurring]);
    expect(request).toHaveBeenCalledWith('/api/recurring');
  });

  it('creates a template', async () => {
    const request = vi.fn().mockResolvedValue({ recurring });
    expect(await createApi(request).createRecurring(input)).toEqual(recurring);
    expect(request).toHaveBeenCalledWith('/api/recurring', { method: 'POST', body: JSON.stringify(input) });
  });

  it('updates a template', async () => {
    const request = vi.fn().mockResolvedValue({ recurring });
    expect(await createApi(request).updateRecurring('r1', input)).toEqual(recurring);
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'PUT', body: JSON.stringify(input) });
  });

  it('deletes a template', async () => {
    const request = vi.fn().mockResolvedValue(null);
    await createApi(request).deleteRecurring('r1');
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'DELETE' });
  });

  it('marks a period handled, and can clear it with null', async () => {
    const request = vi.fn().mockResolvedValue({ recurring });
    const api = createApi(request);

    await api.setRecurringHandled('r1', '2026-09');
    expect(request).toHaveBeenLastCalledWith('/api/recurring/r1/handled', { method: 'POST', body: JSON.stringify({ period: '2026-09' }) });

    await api.setRecurringHandled('r1', null);
    expect(request).toHaveBeenLastCalledWith('/api/recurring/r1/handled', { method: 'POST', body: JSON.stringify({ period: null }) });
  });

  it('encodes ids in the path', async () => {
    const request = vi.fn().mockResolvedValue(null);
    await createApi(request).deleteRecurring('a/b');
    expect(request).toHaveBeenCalledWith('/api/recurring/a%2Fb', { method: 'DELETE' });
  });
});

describe('category API calls', () => {
  const category: Category = {
    categoryId: 'cat-1', name: 'New Name', type: 'EXPENSE', icon: 'tag', isDefault: false, createdAt: 'c',
  };

  it('updates a category name', async () => {
    const request = vi.fn().mockResolvedValue({ category });
    expect(await createApi(request).updateCategory('cat-1', 'New Name')).toEqual(category);
    expect(request).toHaveBeenCalledWith('/api/categories/cat-1', { method: 'PUT', body: JSON.stringify({ name: 'New Name' }) });
  });

  it('encodes the category id in the path', async () => {
    const request = vi.fn().mockResolvedValue({ category });
    await createApi(request).updateCategory('a/b', 'New Name');
    expect(request).toHaveBeenCalledWith('/api/categories/a%2Fb', { method: 'PUT', body: JSON.stringify({ name: 'New Name' }) });
  });
});

describe('trash API calls', () => {
  it('lists recently deleted items', async () => {
    const items = [{ entityType: 'RECURRING', id: 'r1', item: recurring, deletedAt: 'd', expiresAt: 1 }];
    const request = vi.fn().mockResolvedValue({ items });
    expect(await createApi(request).getTrash()).toEqual(items);
    expect(request).toHaveBeenCalledWith('/api/trash');
  });

  it('restores an item by type and id', async () => {
    const request = vi.fn().mockResolvedValue({ entityType: 'TRANSACTION', id: '2026-09#t1', item: {} });
    await createApi(request).restoreFromTrash('TRANSACTION', '2026-09#t1');
    expect(request).toHaveBeenCalledWith('/api/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'TRANSACTION', id: '2026-09#t1' }),
    });
  });
});

describe('access token API calls', () => {
  const record: AccessToken = {
    tokenId: 'tok/1', name: 'Script', scope: 'read', createdAt: 1700000000, expiresAt: null, lastUsedAt: null, prefix: 'hw_abcd',
  };

  it('lists tokens', async () => {
    const request = vi.fn().mockResolvedValue({ tokens: [record] });
    expect(await createApi(request).listAccessTokens()).toEqual([record]);
    expect(request).toHaveBeenCalledWith('/api/tokens');
  });

  it('creates a token and returns the secret with its record', async () => {
    const created = { token: 'hw_secret', record };
    const request = vi.fn().mockResolvedValue(created);
    const body = { name: 'Script', scope: 'write' as const, expiryDays: 90 as const, password: 'pw' };
    expect(await createApi(request).createAccessToken(body)).toEqual(created);
    expect(request).toHaveBeenCalledWith('/api/tokens', { method: 'POST', body: JSON.stringify(body) });
  });

  it('revokes a token with the id encoded', async () => {
    const request = vi.fn().mockResolvedValue({});
    expect(await createApi(request).revokeAccessToken('tok/1')).toBeUndefined();
    expect(request).toHaveBeenCalledWith('/api/tokens/tok%2F1', { method: 'DELETE' });
  });
});
