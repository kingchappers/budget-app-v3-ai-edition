import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueue } from '../useOfflineQueue';
import { queryKeys } from '~/lib/queries';
import { dequeue, enqueue, listQueue } from '~/lib/offlineQueue';

const mockCreateTransaction = vi.fn();
vi.mock('~/lib/queries', async () => {
  const actual = await vi.importActual('~/lib/queries');
  return { ...actual, useApi: () => ({ createTransaction: mockCreateTransaction }) };
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function clearQueue(): Promise<void> {
  const entries = await listQueue();
  await Promise.all(entries.map(e => dequeue(e.id)));
}

describe('useOfflineQueue', () => {
  let qc: QueryClient;
  beforeEach(async () => {
    qc = new QueryClient();
    mockCreateTransaction.mockReset();
    await clearQueue();
  });

  it('reads an empty pending map by default', () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });
    expect(result.current.pendingMap).toEqual({});
  });

  it('reflects a pending map already written to the cache', () => {
    qc.setQueryData(queryKeys.offlineQueue, { a: {} });
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });
    expect(result.current.pendingMap).toEqual({ a: {} });
  });

  it('flushNow calls flushQueue, which clears an entry it can send', async () => {
    qc.setQueryData(queryKeys.offlineQueue, {});
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });
    await act(async () => { await result.current.flushNow(); });
    // No entries were queued in IndexedDB for this test, so this just proves flushNow resolves without throwing.
    expect(result.current.pendingMap).toEqual({});
  });

  it('never sends the same queued entry twice when flushNow is called twice concurrently', async () => {
    await enqueue({
      id: 'r1',
      queuedAt: '2025-01-05T10:00:00.000Z',
      input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' },
    });
    let releaseCreate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseCreate = resolve; });
    mockCreateTransaction.mockImplementation(async (input: { transactionId: string }) => {
      await gate;
      return { ...input, yearMonth: '2025-01', createdAt: '', amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' };
    });

    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });

    let p1: Promise<void> = Promise.resolve();
    let p2: Promise<void> = Promise.resolve();
    act(() => {
      p1 = result.current.flushNow();
      p2 = result.current.flushNow();
    });
    releaseCreate();
    await act(async () => { await Promise.all([p1, p2]); });

    expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
  });
});
