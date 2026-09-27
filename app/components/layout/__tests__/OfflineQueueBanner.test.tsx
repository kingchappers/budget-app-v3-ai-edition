import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueueBanner } from '../OfflineQueueBanner';
import { dequeue, enqueue, listQueue } from '~/lib/offlineQueue';
import { clearPendingEntriesForLogout } from '~/lib/pendingEntries';
import { __resetInFlightFlushForTests } from '~/hooks/useOfflineQueue';

const auth0 = vi.hoisted(() => ({ isAuthenticated: true, user: { sub: 'user-1' } }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));

const mockCreateTransaction = vi.fn();
// A stable object, not a new literal per call: useOfflineQueue's flushNow is
// memoized on [api, qc, userSub], and a fresh `api` reference every render
// (as the real useApi's useMemo never produces) would defeat that and cause
// dependent effects to re-fire every render.
const mockApi = { createTransaction: mockCreateTransaction };
vi.mock('~/lib/queries', async () => {
  const actual = await vi.importActual('~/lib/queries');
  return { ...actual, useApi: () => mockApi };
});

async function clearQueue(): Promise<void> {
  const entries = await listQueue();
  await Promise.all(entries.map(e => dequeue(e.id)));
}

describe('OfflineQueueBanner', () => {
  let qc: QueryClient;
  beforeEach(async () => {
    qc = new QueryClient();
    mockCreateTransaction.mockReset();
    auth0.isAuthenticated = true;
    auth0.user = { sub: 'user-1' };
    // hydrateOnce guards itself at module level (per user sub) so it survives
    // DefaultLayout remounting on navigation; tests need it reset between
    // runs, which clearPendingEntriesForLogout already does as a side effect.
    clearPendingEntriesForLogout(qc);
    __resetInFlightFlushForTests();
    await clearQueue();
  });

  function renderBanner() {
    return render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <OfflineQueueBanner />
        </QueryClientProvider>
      </MantineProvider>,
    );
  }

  it('renders nothing when the queue is empty', () => {
    renderBanner();
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
  });

  // The automatic launch flush can resolve within the same microtask flush as the
  // hydration seed, which can make the "1 waiting to sync" state too transient for
  // React Testing Library to observe. Gating the mocked API call on a promise we
  // resolve ourselves keeps the assertions deterministic instead of racing timing.
  it('shows the count for a hydrated entry, then flushes it', async () => {
    await enqueue({ id: 'x', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    let resolveCreate: (value: unknown) => void = () => {};
    mockCreateTransaction.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    renderBanner();

    expect(await screen.findByText('1 waiting to sync')).toBeInTheDocument();

    resolveCreate({ transactionId: 'x', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    await vi.waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('the Sync now button triggers a flush', async () => {
    await enqueue({ id: 'y', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    let resolveCreate: (value: unknown) => void = () => {};
    mockCreateTransaction.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    renderBanner();
    await screen.findByText('1 waiting to sync');
    fireEvent.click(screen.getByText('Sync now'));
    resolveCreate({ transactionId: 'y', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    await vi.waitFor(() => expect(mockCreateTransaction).toHaveBeenCalled());
  });

  it('does not show or flush another user\'s queued entries', async () => {
    await enqueue({ id: 'z', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'someone-else', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    renderBanner();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  it('clears the reactive pending state on sign-out without touching the durable queue', async () => {
    await enqueue({ id: 'w', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    mockCreateTransaction.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderBanner();
    await screen.findByText('1 waiting to sync');

    auth0.isAuthenticated = false;
    rerender(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <OfflineQueueBanner />
        </QueryClientProvider>
      </MantineProvider>,
    );

    await vi.waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument(), { timeout: 3000 });
    const remaining = await listQueue();
    expect(remaining.some(e => e.id === 'w')).toBe(true);
  });
});
