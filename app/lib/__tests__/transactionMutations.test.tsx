import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Transaction } from '../types';

const request = vi.fn();

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true }) }));

import { queryKeys, useCreateTransaction, useDeleteTransaction } from '../queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const input = {
  amount: 480,
  type: 'EXPENSE' as const,
  categoryId: 'cat-dining',
  description: '',
  date: '2026-07-10',
  transactionId: 'client-1',
};

const existing: Transaction = {
  transactionId: 't1', yearMonth: '2026-07', amount: 100, type: 'EXPENSE',
  categoryId: 'cat-food', description: '', date: '2026-07-01', createdAt: '',
};

const july = queryKeys.transactions('2026-07');
const june = queryKeys.transactions('2026-06');

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
});

describe('useCreateTransaction', () => {
  // The optimistic row and its ApiError-vs-network-failure handling are no
  // longer this mutation's own job (there is no onMutate/onError here any
  // more) — that responsibility moved to useSaveWithUndo's pending-entry
  // map and the useTransactions overlay, covered in useSaveWithUndo.test.tsx
  // and queries.test.tsx. This file now only covers the plain mutation.

  it('sends the request to the date\'s own month, not the current one', async () => {
    request.mockResolvedValue({ transaction: { ...existing, transactionId: 'real', yearMonth: '2026-06', date: '2026-06-30' } });
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ ...input, date: '2026-06-30' }); });

    expect(request).toHaveBeenCalledWith('/api/transactions', expect.objectContaining({ body: expect.stringContaining('2026-06-30') }));
  });

  it('invalidates the date\'s month once the request settles', async () => {
    request.mockResolvedValue({ transaction: { ...existing, transactionId: 'real' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: july }));
  });

  it('does not pause while offline (networkMode: always)', async () => {
    const { onlineManager } = await import('@tanstack/react-query');
    request.mockRejectedValue(new TypeError('Failed to fetch'));
    onlineManager.setOnline(false);
    try {
      const { result } = renderHook(() => useCreateTransaction(), { wrapper });
      act(() => { result.current.mutate(input); });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(request).toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('useDeleteTransaction', () => {
  it('deletes from the supplied month and invalidates that month', async () => {
    request.mockResolvedValue(null);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });

    act(() => { result.current.mutate({ transactionId: 'abc', yearMonth: '2026-06' }); });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('/api/transactions/2026-06/abc', { method: 'DELETE' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: june });
  });
});

describe('pots invalidation', () => {
  const potsKey = queryKeys.pots('2026-07');

  it('invalidates pots when a transaction is created', async () => {
    request.mockResolvedValue({ transaction: { ...existing, transactionId: 'real' } });
    client.setQueryData(potsKey, []);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(client.getQueryState(potsKey)?.isInvalidated).toBe(true);
  });

  it('invalidates pots when a transaction is deleted', async () => {
    request.mockResolvedValue(undefined);
    client.setQueryData(potsKey, []);
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ transactionId: 't1', yearMonth: '2026-07' }); });
    expect(client.getQueryState(potsKey)?.isInvalidated).toBe(true);
  });
});
