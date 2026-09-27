import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth0 = {
  isAuthenticated: false,
  isLoading: true,
  getAccessTokenSilently: vi.fn(async () => 'token'),
};

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));

import { onlineManager } from '@tanstack/react-query';
import { queryKeys, useCategories, useCreateTransaction, useTransactions } from '../queries';

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

  it('overlays a pending entry for the month onto the server rows', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(queryKeys.offlineQueue, {
      'pending-1': {
        id: 'pending-1',
        queued: true,
        userSub: 'u1',
        queuedAt: '2026-09-01T00:00:00.000Z',
        input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: 'coffee', date: '2026-09-05' },
      },
    });
    function localWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useTransactions('2026-09'), { wrapper: localWrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.some(t => t.transactionId === 'pending-1')).toBe(true);
  });

  it('does not duplicate a row once the server has it too (same transactionId)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      transactions: [{ transactionId: 'same-id', yearMonth: '2026-09', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2026-09-05', createdAt: '' }],
    }))));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(queryKeys.offlineQueue, {
      'same-id': {
        id: 'same-id',
        queued: true,
        userSub: 'u1',
        queuedAt: '2026-09-01T00:00:00.000Z',
        input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2026-09-05' },
      },
    });
    function localWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useTransactions('2026-09'), { wrapper: localWrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.filter(t => t.transactionId === 'same-id')).toHaveLength(1);
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

  it('clears the pending overlay entry once the create succeeds and the refetch lands', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url.startsWith('/api/transactions?')
        ? new Response(JSON.stringify({ transactions: [] }))
        : new Response(JSON.stringify({ transaction: { ...baseInput, transactionId: 'fixed-id-1', yearMonth: '2025-01', createdAt: '' } }))
    )));
    const { result } = renderCreateTransactionHook();
    queryClient.setQueryData(queryKeys.offlineQueue, { 'fixed-id-1': { id: 'fixed-id-1', input: baseInput, queuedAt: '', userSub: 'u1' } });
    const input = { ...baseInput, transactionId: 'fixed-id-1' };

    await act(async () => { await result.current.mutateAsync(input); });

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.offlineQueue)).toEqual({});
    });
  });

  it('does not clear the pending overlay entry when the create fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const { result } = renderCreateTransactionHook();
    queryClient.setQueryData(queryKeys.offlineQueue, { 'id-b': { id: 'id-b', input: baseInput, queuedAt: '', userSub: 'u1' } });

    await act(async () => {
      await result.current.mutateAsync({ ...baseInput, transactionId: 'id-b' }).catch(() => {});
    });

    expect(queryClient.getQueryData(queryKeys.offlineQueue)).toEqual({
      'id-b': { id: 'id-b', input: baseInput, queuedAt: '', userSub: 'u1' },
    });
  });

  it('does not pause while the browser reports itself offline (networkMode: always)', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    onlineManager.setOnline(false);
    try {
      const { result } = renderCreateTransactionHook();
      act(() => { result.current.mutate({ ...baseInput, transactionId: 'id-c' }); });
      // A paused mutation never calls its mutationFn at all; the default
      // 'online' networkMode would have left this pending forever instead.
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await waitFor(() => expect(result.current.isError).toBe(true));
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
