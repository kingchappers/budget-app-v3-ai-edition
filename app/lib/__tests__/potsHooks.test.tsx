import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PotSummary } from '../types';

const request = vi.fn();

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true }) }));

import { queryKeys, useArchivePot, usePots, useSavePot, useUnarchivePot } from '../queries';

const pot: PotSummary = {
  categoryId: 'cat-holidays', monthlyAmount: 5000, goalAmount: null, autoAmountNow: 0, balance: 1000,
  thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [],
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
});

describe('usePots', () => {
  it('fetches the pots for the given month', async () => {
    request.mockResolvedValue({ pots: [pot] });
    const { result } = renderHook(() => usePots('2026-09'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([pot]));
    expect(request).toHaveBeenCalledWith('/api/pots?asOf=2026-09');
  });

  it('does not fetch when disabled', () => {
    renderHook(() => usePots('2026-09', false), { wrapper });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('useSavePot', () => {
  const input = { monthlyAmount: 5000, goalAmount: null, autoContribute: true, month: '2026-09' };

  it('PUTs the settings and invalidates every cached pots query', async () => {
    request.mockResolvedValue({ settings: {} });
    client.setQueryData(queryKeys.pots('2026-09'), [pot]);
    client.setQueryData(queryKeys.pots('2026-08'), [pot]);
    const { result } = renderHook(() => useSavePot(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ categoryId: 'cat-holidays', input }); });

    expect(request).toHaveBeenCalledWith('/api/pots/cat-holidays', { method: 'PUT', body: JSON.stringify(input) });
    expect(client.getQueryState(queryKeys.pots('2026-09'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.pots('2026-08'))?.isInvalidated).toBe(true);
  });
});

describe('useArchivePot', () => {
  it('POSTs the month and refreshes pots, categories, recurring and trash', async () => {
    request.mockResolvedValue({ settings: {}, cancelledRecurring: 2 });
    client.setQueryData(queryKeys.pots('2026-09'), [pot]);
    client.setQueryData(queryKeys.categories, []);
    client.setQueryData(queryKeys.recurring, []);
    client.setQueryData(queryKeys.trash, []);
    const { result } = renderHook(() => useArchivePot(), { wrapper });

    let cancelled = 0;
    await act(async () => {
      cancelled = (await result.current.mutateAsync({ categoryId: 'cat-holidays', month: '2026-09' })).cancelledRecurring;
    });

    expect(cancelled).toBe(2);
    expect(request).toHaveBeenCalledWith('/api/pots/cat-holidays/archive', { method: 'POST', body: JSON.stringify({ month: '2026-09' }) });
    for (const key of [queryKeys.pots('2026-09'), queryKeys.categories, queryKeys.recurring, queryKeys.trash]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});

describe('useUnarchivePot', () => {
  it('POSTs to unarchive and refreshes pots and categories', async () => {
    request.mockResolvedValue({ settings: {} });
    client.setQueryData(queryKeys.pots('2026-09'), [pot]);
    client.setQueryData(queryKeys.categories, []);
    const { result } = renderHook(() => useUnarchivePot(), { wrapper });

    await act(async () => { await result.current.mutateAsync('cat-holidays'); });

    expect(request).toHaveBeenCalledWith('/api/pots/cat-holidays/unarchive', { method: 'POST' });
    expect(client.getQueryState(queryKeys.pots('2026-09'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.categories)?.isInvalidated).toBe(true);
  });
});
