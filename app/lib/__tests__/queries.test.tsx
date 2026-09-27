import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth0 = {
  isAuthenticated: false,
  isLoading: true,
  getAccessTokenSilently: vi.fn(async () => 'token'),
};

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));

import { ApiError } from '~/lib/apiError';
import { queryKeys, useCategories, useCreateTransaction, useTransactions } from '../queries';
import type { Transaction } from '../types';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCategories', () => {
  beforeEach(() => {
    auth0.isAuthenticated = false;
    auth0.isLoading = true;
    auth0.getAccessTokenSilently.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ categories: [] }))));
  });

  it('stays idle while Auth0 is still restoring the session', async () => {
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches once the user is authenticated', async () => {
    auth0.isAuthenticated = true;
    auth0.isLoading = false;

    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/categories', expect.anything());
  });
});

describe('useTransactions', () => {
  beforeEach(() => {
    auth0.isAuthenticated = true;
    auth0.isLoading = false;
    auth0.getAccessTokenSilently.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ transactions: [] }))));
  });

  it('does not fetch while the caller disables it, even when authenticated', async () => {
    const { result } = renderHook(() => useTransactions('2026-09', false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches by default once authenticated', async () => {
    const { result } = renderHook(() => useTransactions('2026-09'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/transactions?year=2026&month=9', expect.anything());
  });
});

describe('useCreateTransaction', () => {
  let queryClient: QueryClient;

  function renderCreateTransactionHook() {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function localWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return renderHook(() => useCreateTransaction(), { wrapper: localWrapper });
  }

  const baseInput = {
    amount: 500,
    type: 'EXPENSE' as const,
    categoryId: 'cat-1',
    description: '',
    date: '2025-01-05',
  };

  beforeEach(() => {
    auth0.isAuthenticated = true;
    auth0.isLoading = false;
    auth0.getAccessTokenSilently.mockClear();
  });

  it('uses input.transactionId as the optimistic row id, not a generated temp id', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderCreateTransactionHook();
    queryClient.setQueryData(queryKeys.transactions('2025-01'), []);
    const input = { ...baseInput, description: 'coffee', transactionId: 'fixed-id-1' };

    act(() => { result.current.mutate(input); });

    await waitFor(() => {
      const rows = queryClient.getQueryData(queryKeys.transactions('2025-01')) as Transaction[] | undefined;
      expect(rows?.some(r => r.transactionId === 'fixed-id-1')).toBe(true);
    });
  });

  it('replaces rather than duplicates a row that already has this transactionId', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderCreateTransactionHook();
    queryClient.setQueryData(queryKeys.transactions('2025-01'), [
      { transactionId: 'fixed-id-1', amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: 'old', date: '2025-01-05', yearMonth: '2025-01', createdAt: '' },
    ]);
    const input = { ...baseInput, description: 'new', transactionId: 'fixed-id-1' };

    act(() => { result.current.mutate(input); });

    await waitFor(() => {
      const rows = queryClient.getQueryData(queryKeys.transactions('2025-01')) as Transaction[];
      expect(rows).toHaveLength(1);
      expect(rows[0].description).toBe('new');
    });
  });

  it('rolls back the optimistic row on an ApiError but not on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 400, statusText: 'Bad Request' }))));
    const { result: apiErrorHook } = renderCreateTransactionHook();
    const apiErrorClient = queryClient;
    apiErrorClient.setQueryData(queryKeys.transactions('2025-01'), []);

    await act(async () => {
      await apiErrorHook.current.mutateAsync({ ...baseInput, transactionId: 'id-a' }).catch(() => {});
    });

    expect((apiErrorClient.getQueryData(queryKeys.transactions('2025-01')) as Transaction[] ?? []).some(r => r.transactionId === 'id-a')).toBe(false);

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const { result: networkErrorHook } = renderCreateTransactionHook();
    const networkErrorClient = queryClient;
    networkErrorClient.setQueryData(queryKeys.transactions('2025-01'), []);

    await act(async () => {
      await networkErrorHook.current.mutateAsync({ ...baseInput, transactionId: 'id-b' }).catch(() => {});
    });

    expect((networkErrorClient.getQueryData(queryKeys.transactions('2025-01')) as Transaction[] ?? []).some(r => r.transactionId === 'id-b')).toBe(true);
  });

  it('throws a dev-time invariant when input.transactionId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderCreateTransactionHook();

    await act(async () => {
      await result.current.mutateAsync(baseInput).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/transactionId/);
  });
});
