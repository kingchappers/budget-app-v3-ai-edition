import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth0 = {
  isAuthenticated: false,
  isLoading: true,
  getAccessTokenSilently: vi.fn(async () => 'token'),
};

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));

import { useCategories, useTransactions } from '../queries';

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
