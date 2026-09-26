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
  it('adds a temporary row to the date\'s month while the request is in flight', async () => {
    const pending = deferred<{ transaction: Transaction }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(july, [existing]);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(client.getQueryData<Transaction[]>(july)).toHaveLength(2));
    const rows = client.getQueryData<Transaction[]>(july)!;
    expect(rows[1]).toMatchObject({ amount: 480, categoryId: 'cat-dining', yearMonth: '2026-07' });
    expect(rows[1].transactionId).toMatch(/^temp-/);

    pending.resolve({ transaction: { ...existing, transactionId: 'real' } });
  });

  it('writes a backdated entry to its own month, not the current one', async () => {
    const pending = deferred<{ transaction: Transaction }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(june, []);
    client.setQueryData(july, [existing]);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate({ ...input, date: '2026-06-30' }); });

    await waitFor(() => expect(client.getQueryData<Transaction[]>(june)).toHaveLength(1));
    expect(client.getQueryData<Transaction[]>(july)).toEqual([existing]);

    pending.resolve({ transaction: { ...existing, transactionId: 'real' } });
  });

  it('removes only the temporary row when the request fails', async () => {
    request.mockRejectedValue(new Error('boom'));
    client.setQueryData(july, [existing]);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Transaction[]>(july)).toEqual([existing]);
  });

  it('does not write a partial cache when the month is not loaded', async () => {
    const pending = deferred<{ transaction: Transaction }>();
    request.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(client.getQueryData(july)).toBeUndefined();

    pending.resolve({ transaction: { ...existing, transactionId: 'real' } });
  });

  it('invalidates the date\'s month once the request settles', async () => {
    request.mockResolvedValue({ transaction: { ...existing, transactionId: 'real' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: july }));
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
