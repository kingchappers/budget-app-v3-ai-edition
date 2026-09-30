import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ user: { sub: 'user-1' } }) }));

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
import * as offlineQueueModule from '~/lib/offlineQueue';
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

  it('shows Saving… until the server confirms, then Saved', async () => {
    let resolveCreate!: (value: unknown) => void;
    mockCreate.mutateAsync.mockReturnValue(new Promise(resolve => { resolveCreate = resolve; }));
    const { result } = renderSaveWithUndo();

    act(() => { void result.current(input); });
    expect(await screen.findByText('Saving £4.80 · Dining…')).toBeInTheDocument();
    expect(screen.queryByText('Saved £4.80 · Dining')).not.toBeInTheDocument();

    await act(async () => { resolveCreate(created); });
    expect(await screen.findByText('Saved £4.80 · Dining')).toBeInTheDocument();
    expect(screen.queryByText('Saving £4.80 · Dining…')).not.toBeInTheDocument();
  });

  it('keeps the Saved notification open, with a Close button, until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockCreate.mutateAsync.mockResolvedValue(created);
      const { result } = renderSaveWithUndo();
      await act(async () => { await result.current(input); });

      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByText('Saved £4.80 · Dining')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
      await waitFor(() => expect(screen.queryByText('Saved £4.80 · Dining')).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the previous save notification when a new save starts', async () => {
    mockCreate.mutateAsync.mockResolvedValue(created);
    const { result } = renderSaveWithUndo();

    await act(async () => { await result.current(input); });
    await act(async () => { await result.current({ ...input, amount: 1250 }); });

    expect(await screen.findByText('Saved £12.50 · Dining')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Saved £4.80 · Dining')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
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

  it('keeps the Saved toast open (relabelled) once queued, instead of closing it within milliseconds', async () => {
    mockCreate.mutateAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderSaveWithUndo();
    await act(async () => {
      await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    });
    expect(await screen.findByText(/Saved offline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
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

  it('passes a recurringId through to the create call and the offline queue unchanged', async () => {
    const recurringId = '3f2b8c1e-9a4d-4e7f-b1c2-0d9e8f7a6b5c';
    mockCreate.mutateAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result, qc } = renderSaveWithUndo();
    await act(async () => {
      await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05', recurringId });
    });
    expect(mockCreate.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ recurringId }));
    const [queued] = await listQueue();
    expect(queued.input.recurringId).toBe(recurringId);
    const pending = qc.getQueryData<Record<string, { input: { recurringId?: string } }>>(queryKeys.offlineQueue) ?? {};
    expect(Object.values(pending).map(entry => entry.input.recurringId)).toEqual([recurringId]);
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
    it('eventual network failure: the entry never reaches the queue at all, once already undone', async () => {
      const uuidSpy = vi.spyOn(crypto, 'randomUUID');
      uuidSpy.mockReturnValueOnce('00000000-0000-0000-0000-000000000001');
      uuidSpy.mockReturnValueOnce('00000000-0000-0000-0000-000000000002');
      const enqueueSpy = vi.spyOn(offlineQueueModule, 'enqueue');
      // A manually-controlled rejection, not a wall-clock setTimeout: a fixed
      // delay races against however long `findByText('Undo')` and the click
      // actually take under CPU load, which a busy full-suite run can lose.
      let rejectCreate!: (reason: unknown) => void;
      mockCreate.mutateAsync.mockImplementation(() => new Promise((_resolve, reject) => { rejectCreate = reject; }));
      const { result, qc } = renderSaveWithUndo();

      act(() => { void result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' }); });
      fireEvent.click(await screen.findByText('Undo'));
      await act(async () => {
        rejectCreate(new TypeError('Failed to fetch'));
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(qc.getQueryData(queryKeys.offlineQueue)).toEqual({}));
      expect(await listQueue()).toHaveLength(0);
      // The old code enqueued the entry unconditionally and only discarded it
      // right after — a real gap a concurrent flush could win. It's never
      // enqueued at all now, since `undone` is checked first.
      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(mockRemove.mutate).not.toHaveBeenCalled();

      uuidSpy.mockRestore();
      enqueueSpy.mockRestore();
    });

    it('eventual success: a real delete is issued, and the entry is never treated as queued', async () => {
      let resolveCreate!: (value: unknown) => void;
      mockCreate.mutateAsync.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
      const { result } = renderSaveWithUndo();

      act(() => { void result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' }); });
      fireEvent.click(await screen.findByText('Undo'));

      await act(async () => {
        resolveCreate({ transactionId: 't-race', yearMonth: '2025-01', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05', createdAt: '' });
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Clearing the pending overlay row on a genuine online success is
      // useCreateTransaction's own job (covered in queries.test.tsx) — this
      // hook's own responsibility, exercised here, is issuing the real
      // delete and never treating an eventual success as a queued entry.
      await waitFor(() => expect(mockRemove.mutate).toHaveBeenCalledWith({ transactionId: 't-race', yearMonth: '2025-01' }));
      expect(await listQueue()).toHaveLength(0);
    });
  });
});
