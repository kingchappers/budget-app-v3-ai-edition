import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueueBanner } from '../OfflineQueueBanner';
import { dequeue, enqueue, listQueue } from '~/lib/offlineQueue';

const mockCreateTransaction = vi.fn();
vi.mock('~/lib/queries', async () => {
  const actual = await vi.importActual('~/lib/queries');
  return { ...actual, useApi: () => ({ createTransaction: mockCreateTransaction }) };
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
  it('shows the count and re-inserts a hydrated entry as an optimistic row, then flushes it', async () => {
    await enqueue({ id: 'x', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    qc.setQueryData(['transactions', '2025-01'], []);
    let resolveCreate: (value: unknown) => void = () => {};
    mockCreateTransaction.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    renderBanner();

    expect(await screen.findByText('1 waiting to sync')).toBeInTheDocument();
    const rows = qc.getQueryData(['transactions', '2025-01']) as { transactionId: string }[];
    expect(rows.some(r => r.transactionId === 'x')).toBe(true);

    resolveCreate({ transactionId: 'x', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    await vi.waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument());
  });

  it('the Sync now button triggers a flush', async () => {
    await enqueue({ id: 'y', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    let resolveCreate: (value: unknown) => void = () => {};
    mockCreateTransaction.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    renderBanner();
    await screen.findByText('1 waiting to sync');
    fireEvent.click(screen.getByText('Sync now'));
    resolveCreate({ transactionId: 'y', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    await vi.waitFor(() => expect(mockCreateTransaction).toHaveBeenCalled());
  });
});
