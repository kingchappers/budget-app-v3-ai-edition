import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockCreate = { mutateAsync: vi.fn() };
const mockRemove = { mutate: vi.fn() };

vi.mock('~/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/queries')>();
  return {
    ...actual,
    useCategories: () => ({
      data: [{ categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' }],
    }),
    useCreateTransaction: () => mockCreate,
    useDeleteTransaction: () => mockRemove,
  };
});

import { useSaveWithUndo } from '../useSaveWithUndo';
import { queryKeys } from '~/lib/queries';
import { ApiError } from '~/lib/apiError';
import { dequeue, listQueue } from '~/lib/offlineQueue';
import type { Transaction } from '~/lib/types';

function renderSaveWithUndo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MantineProvider><Notifications />{children}</MantineProvider>
      </QueryClientProvider>
    );
  }
  const { result } = renderHook(() => useSaveWithUndo(), { wrapper });
  return { result, qc };
}

async function clearQueue(): Promise<void> {
  const entries = await listQueue();
  await Promise.all(entries.map(e => dequeue(e.id)));
}

const input = { amount: 480, type: 'EXPENSE' as const, categoryId: 'cat-dining', description: '', date: '2026-09-20' };
const created = { transactionId: 't-real', yearMonth: '2026-09' };

describe('useSaveWithUndo', () => {
  beforeEach(async () => {
    mockCreate.mutateAsync.mockReset();
    mockRemove.mutate.mockReset();
    await clearQueue();
  });

  afterEach(() => { notifications.clean(); });

  it('shows a Saved toast and resolves to the created transaction', async () => {
    mockCreate.mutateAsync.mockResolvedValue(created);
    const { result } = renderSaveWithUndo();

    let outcome: Transaction | null = null;
    await act(async () => { outcome = await result.current(input); });

    expect(outcome).toEqual(created);
    expect(mockCreate.mutateAsync).toHaveBeenCalledWith(expect.objectContaining(input));
    expect(await screen.findByText('Saved £4.80 · Dining')).toBeInTheDocument();
  });

  it('Undo deletes the created transaction from its own month', async () => {
    mockCreate.mutateAsync.mockResolvedValue(created);
    const { result } = renderSaveWithUndo();

    await act(async () => { await result.current(input); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockRemove.mutate).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-09' }));
  });

  it('resolves to null and offers Retry, which re-sends the same input', async () => {
    mockCreate.mutateAsync.mockRejectedValueOnce(new ApiError(400, 'Bad Request')).mockResolvedValue(created);
    const { result } = renderSaveWithUndo();

    let outcome: Transaction | null = created as Transaction;
    await act(async () => { outcome = await result.current(input); });
    expect(outcome).toBeNull();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));

    expect(mockCreate.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mockCreate.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining(input));
  });

  it('does not offer Retry when the user already pressed Undo', async () => {
    let rejectCreate!: (reason: unknown) => void;
    mockCreate.mutateAsync.mockReturnValue(new Promise((_resolve, reject) => { rejectCreate = reject; }));
    const { result } = renderSaveWithUndo();

    await act(async () => { void result.current(input); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));
    await act(async () => {
      rejectCreate(new ApiError(400, 'Bad Request'));
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(mockRemove.mutate).not.toHaveBeenCalled();
  });

  it('calls onUndo after issuing the delete when Undo is pressed', async () => {
    mockCreate.mutateAsync.mockResolvedValue(created);
    const order: string[] = [];
    mockRemove.mutate.mockImplementation(() => { order.push('remove'); });
    const onUndo = vi.fn(() => { order.push('undo'); });
    const { result } = renderSaveWithUndo();

    await act(async () => { await result.current(input, { onUndo }); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['remove', 'undo']);
  });

  it('does not call onUndo unless Undo is pressed', async () => {
    mockCreate.mutateAsync.mockResolvedValue(created);
    const onUndo = vi.fn();
    const { result } = renderSaveWithUndo();

    await act(async () => { await result.current(input, { onUndo }); });

    expect(onUndo).not.toHaveBeenCalled();
  });

  it('does not call onUndo when the create failed', async () => {
    mockCreate.mutateAsync.mockRejectedValue(new Error('boom'));
    const onUndo = vi.fn();
    const { result } = renderSaveWithUndo();

    await act(async () => { await result.current(input, { onUndo }); });

    expect(onUndo).not.toHaveBeenCalled();
  });

  it('queues the entry on a network failure instead of showing a failure toast', async () => {
    mockCreate.mutateAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderSaveWithUndo();
    await act(async () => {
      await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    });
    const entries = await listQueue();
    expect(entries).toHaveLength(1);
    expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
  });

  it('still shows the failure toast and does not queue on a real ApiError', async () => {
    mockCreate.mutateAsync.mockRejectedValueOnce(new ApiError(400, 'Bad Request'));
    const { result } = renderSaveWithUndo();
    await act(async () => {
      await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    });
    expect(await listQueue()).toHaveLength(0);
    expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
  });

  it('sends the same transactionId used for the optimistic row', async () => {
    mockCreate.mutateAsync.mockResolvedValueOnce({ transactionId: 'whatever', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    const { result } = renderSaveWithUndo();
    await act(async () => {
      await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    });
    expect(mockCreate.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ transactionId: expect.any(String) }));
  });

  it('Undo on a queued (unsent) entry removes it from the queue with no delete call', async () => {
    mockCreate.mutateAsync.mockImplementation(() => new Promise((_resolve, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 5)));
    const { result } = renderSaveWithUndo();
    act(() => { void result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' }); });
    fireEvent.click(await screen.findByText('Undo'));
    await waitFor(async () => expect(await listQueue()).toHaveLength(0));
    expect(mockRemove.mutate).not.toHaveBeenCalled();
  });

  // Review Focus: Undo fires before the create has resolved to either success or a
  // queued state. Neither branch may leave the entry stranded — not shown as saved,
  // and not left orphaned in the offline queue or its pending map.
  describe('Undo pressed before the create settles', () => {
    it('eventual network failure: the entry is queued then immediately discarded, never left pending', async () => {
      const uuidSpy = vi.spyOn(crypto, 'randomUUID');
      uuidSpy.mockReturnValueOnce('00000000-0000-0000-0000-000000000001');
      uuidSpy.mockReturnValueOnce('00000000-0000-0000-0000-000000000002');
      mockCreate.mutateAsync.mockImplementation(() => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new TypeError('Failed to fetch')), 5);
      }));
      const { result, qc } = renderSaveWithUndo();
      qc.setQueryData<Transaction[]>(queryKeys.transactions('2025-01'), [
        { transactionId: '00000000-0000-0000-0000-000000000002', yearMonth: '2025-01', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05', createdAt: '' },
      ]);

      act(() => { void result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' }); });
      fireEvent.click(await screen.findByText('Undo'));

      await waitFor(async () => expect(await listQueue()).toHaveLength(0));
      await waitFor(() => expect(qc.getQueryData(queryKeys.offlineQueue)).toEqual({}));
      const rows = qc.getQueryData<Transaction[]>(queryKeys.transactions('2025-01')) ?? [];
      expect(rows.some(t => t.transactionId === '00000000-0000-0000-0000-000000000002')).toBe(false);
      expect(mockRemove.mutate).not.toHaveBeenCalled();

      uuidSpy.mockRestore();
    });

    it('eventual success: a real delete is issued, and the entry is never treated as queued', async () => {
      let resolveCreate!: (value: unknown) => void;
      mockCreate.mutateAsync.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
      const { result, qc } = renderSaveWithUndo();

      act(() => { void result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' }); });
      fireEvent.click(await screen.findByText('Undo'));

      await act(async () => {
        resolveCreate({ transactionId: 't-race', yearMonth: '2025-01', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05', createdAt: '' });
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(mockRemove.mutate).toHaveBeenCalledWith({ transactionId: 't-race', yearMonth: '2025-01' }));
      expect(await listQueue()).toHaveLength(0);
      expect(qc.getQueryData(queryKeys.offlineQueue) ?? {}).toEqual({});
    });
  });
});
