import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AccessToken, Account, CategoryTarget, Recurring, Transaction } from '../types';

const request = vi.fn();

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true }) }));

import {
  queryKeys, useAccessTokens, useCreateAccessToken, useRevokeAccessToken, useDeleteAccount, useDeleteRecurring, useDeleteTarget, useDeleteTransaction, useRestoreFromTrash, useTrash,
} from '../queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const coffee: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 350, type: 'EXPENSE',
  categoryId: 'cat-dining', description: 'Coffee', date: '2026-09-29', createdAt: '',
};
const lunch: Transaction = { ...coffee, transactionId: 't2', description: 'Lunch' };

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
});

describe('useDeleteTransaction', () => {
  const key = queryKeys.transactions('2026-09');

  it('removes the row from the cache before the server answers', async () => {
    const pending = deferred<null>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(key, [coffee, lunch]);
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });

    act(() => { result.current.mutate({ transactionId: 't1', yearMonth: '2026-09' }); });

    await waitFor(() => expect(client.getQueryData<Transaction[]>(key)).toEqual([lunch]));
    pending.resolve(null);
  });

  it('puts the row back when the delete fails', async () => {
    request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') throw new Error('offline');
      return { transactions: [coffee, lunch] };
    });
    client.setQueryData(key, [coffee, lunch]);
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ transactionId: 't1', yearMonth: '2026-09' }).catch(() => undefined);
    });

    expect(client.getQueryData<Transaction[]>(key)?.map(t => t.transactionId).sort()).toEqual(['t1', 't2']);
  });

  it('refreshes the recently deleted list once settled', async () => {
    request.mockResolvedValue(null);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ transactionId: 't1', yearMonth: '2026-09' }); });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.trash });
  });
});

describe('useDeleteTarget', () => {
  const target: CategoryTarget = { categoryId: 'cat-food', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' };

  it('removes the target at once and restores it on failure', async () => {
    const pending = deferred<null>();
    request.mockImplementation((_endpoint: string, options?: RequestInit) => (
      options?.method === 'DELETE' ? pending.promise : Promise.resolve({ targets: [target] })
    ));
    client.setQueryData(queryKeys.targets, [target]);
    const { result } = renderHook(() => useDeleteTarget(), { wrapper });

    act(() => { result.current.mutate('cat-food'); });
    await waitFor(() => expect(client.getQueryData(queryKeys.targets)).toEqual([]));

    await act(async () => { pending.reject(new Error('offline')); });
    await waitFor(() => expect(client.getQueryData(queryKeys.targets)).toEqual([target]));
  });
});

describe('useDeleteRecurring', () => {
  it('removes the item from the cache at once', async () => {
    const item = { recurringId: 'r1' } as Recurring;
    request.mockReturnValue(new Promise(() => {}));
    client.setQueryData(queryKeys.recurring, [item]);
    const { result } = renderHook(() => useDeleteRecurring(), { wrapper });

    act(() => { result.current.mutate('r1'); });

    await waitFor(() => expect(client.getQueryData(queryKeys.recurring)).toEqual([]));
  });
});

describe('useDeleteAccount', () => {
  it('removes the account from the cache at once', async () => {
    const account = { accountId: 'acc-1' } as Account;
    request.mockReturnValue(new Promise(() => {}));
    client.setQueryData(queryKeys.accounts, [account]);
    const { result } = renderHook(() => useDeleteAccount(), { wrapper });

    act(() => { result.current.mutate('acc-1'); });

    await waitFor(() => expect(client.getQueryData(queryKeys.accounts)).toEqual([]));
  });
});

describe('useTrash', () => {
  it('loads the recently deleted list', async () => {
    request.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useTrash(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(request).toHaveBeenCalledWith('/api/trash');
  });
});

describe('useRestoreFromTrash', () => {
  it('refreshes the trash and the restored item\'s list', async () => {
    request.mockResolvedValue({});
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRestoreFromTrash(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ entityType: 'TRANSACTION', id: '2026-09#t1' }); });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.trash });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pots'] });
  });

  it('refreshes accounts after restoring an account', async () => {
    request.mockResolvedValue({});
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRestoreFromTrash(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ entityType: 'ACCOUNT', id: 'acc-1' }); });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.accounts });
  });
});

describe('access token hooks', () => {
  const record: AccessToken = {
    tokenId: 'tok1', name: 'Script', scope: 'read', createdAt: 1700000000, expiresAt: null, lastUsedAt: null, prefix: 'hw_abcd',
  };

  it('loads the token list', async () => {
    request.mockResolvedValue({ tokens: [record] });
    const { result } = renderHook(() => useAccessTokens(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([record]));
    expect(request).toHaveBeenCalledWith('/api/tokens');
  });

  it('invalidates the list after creating and keeps the secret out of the cache', async () => {
    const secret = 'hw_SECRET_VALUE_123';
    request.mockResolvedValue({ token: secret, record });
    client.setQueryData(queryKeys.accessTokens, []);
    const { result, unmount } = renderHook(() => useCreateAccessToken(), { wrapper });

    let created: { token: string; record: AccessToken } | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ name: 'Script', scope: 'read', expiryDays: null });
    });

    expect(created?.token).toBe(secret);
    expect(client.getQueryState(queryKeys.accessTokens)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(secret);
    unmount();
    await waitFor(() => expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(secret));
  });

  it('invalidates the list after revoking', async () => {
    request.mockResolvedValue({});
    client.setQueryData(queryKeys.accessTokens, [record]);
    const { result } = renderHook(() => useRevokeAccessToken(), { wrapper });
    await act(async () => { await result.current.mutateAsync('tok1'); });
    expect(request).toHaveBeenCalledWith('/api/tokens/tok1', { method: 'DELETE' });
    expect(client.getQueryState(queryKeys.accessTokens)?.isInvalidated).toBe(true);
  });
});
