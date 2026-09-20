import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Recurring } from '../types';

const request = vi.fn();
let authenticated = true;

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: authenticated }) }));

import {
  queryKeys, useCreateRecurring, useDeleteRecurring, useRecurring, useSetRecurringHandled, useUpdateRecurring,
} from '../queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const template: Recurring = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 3, handledPeriod: '2026-08', createdAt: 'c', updatedAt: 'u',
};
const input = { type: 'INCOME' as const, categoryId: 'cat-salary', amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3 };

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
  authenticated = true;
});

describe('useRecurring', () => {
  it('fetches the templates once authenticated', async () => {
    request.mockResolvedValue({ recurring: [template] });
    const { result } = renderHook(() => useRecurring(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([template]);
    expect(request).toHaveBeenCalledWith('/api/recurring');
  });

  it('stays idle until Auth0 has restored the session', async () => {
    authenticated = false;
    const { result } = renderHook(() => useRecurring(), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(request).not.toHaveBeenCalled();
  });
});

describe('recurring mutations', () => {
  it('create refreshes the list', async () => {
    request.mockResolvedValue({ recurring: template });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateRecurring(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
    expect(request).toHaveBeenCalledWith('/api/recurring', { method: 'POST', body: JSON.stringify(input) });
  });

  it('update refreshes the list', async () => {
    request.mockResolvedValue({ recurring: template });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateRecurring(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', input }); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'PUT', body: JSON.stringify(input) });
  });

  it('delete refreshes the list', async () => {
    request.mockResolvedValue(null);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteRecurring(), { wrapper });

    act(() => { result.current.mutate('r1'); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'DELETE' });
  });
});

describe('useSetRecurringHandled', () => {
  it('updates the cached template immediately, before the server answers', async () => {
    const pending = deferred<{ recurring: Recurring }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: '2026-09' }); });

    await waitFor(() => expect(client.getQueryData<Recurring[]>(queryKeys.recurring)?.[0].handledPeriod).toBe('2026-09'));
    pending.resolve({ recurring: { ...template, handledPeriod: '2026-09' } });
  });

  it('can clear the marker with null', async () => {
    const pending = deferred<{ recurring: Recurring }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: null }); });

    await waitFor(() => expect(client.getQueryData<Recurring[]>(queryKeys.recurring)?.[0].handledPeriod).toBeNull());
    pending.resolve({ recurring: { ...template, handledPeriod: null } });
  });

  it('puts the previous marker back when the request fails', async () => {
    request.mockRejectedValue(new Error('boom'));
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: '2026-09' }); });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Recurring[]>(queryKeys.recurring)?.[0].handledPeriod).toBe('2026-08');
  });

  it('refreshes the list once it settles', async () => {
    request.mockResolvedValue({ recurring: { ...template, handledPeriod: '2026-09' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: '2026-09' }); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
  });
});
