import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PotSummary } from '../types';

const request = vi.fn();

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true }) }));

import { queryKeys, usePots, useSavePot } from '../queries';

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
