import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';

const mockCreate = vi.fn();
const mockRemove = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [{ categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' }],
  }),
  useCreateTransaction: () => ({ mutateAsync: mockCreate }),
  useDeleteTransaction: () => ({ mutate: mockRemove }),
}));

import { useSaveWithUndo } from '../useSaveWithUndo';
import type { Transaction } from '~/lib/types';

function wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider><Notifications />{children}</MantineProvider>;
}

const input = { amount: 480, type: 'EXPENSE' as const, categoryId: 'cat-dining', description: '', date: '2026-09-20' };
const created = { transactionId: 't-real', yearMonth: '2026-09' };

describe('useSaveWithUndo', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockRemove.mockReset();
  });

  afterEach(() => { notifications.clean(); });

  it('shows a Saved toast and resolves to the created transaction', async () => {
    mockCreate.mockResolvedValue(created);
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    let outcome: Transaction | null = null;
    await act(async () => { outcome = await result.current(input); });

    expect(outcome).toEqual(created);
    expect(mockCreate).toHaveBeenCalledWith(input);
    expect(await screen.findByText('Saved £4.80 · Dining')).toBeInTheDocument();
  });

  it('Undo deletes the created transaction from its own month', async () => {
    mockCreate.mockResolvedValue(created);
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-09' }));
  });

  it('resolves to null and offers Retry, which re-sends the same input', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(created);
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    let outcome: Transaction | null = created as Transaction;
    await act(async () => { outcome = await result.current(input); });
    expect(outcome).toBeNull();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenLastCalledWith(input);
  });

  it('does not offer Retry when the user already pressed Undo', async () => {
    let rejectCreate!: (reason: unknown) => void;
    mockCreate.mockReturnValue(new Promise((_resolve, reject) => { rejectCreate = reject; }));
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { void result.current(input); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));
    await act(async () => {
      rejectCreate(new Error('boom'));
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('calls onUndo after issuing the delete when Undo is pressed', async () => {
    mockCreate.mockResolvedValue(created);
    const order: string[] = [];
    mockRemove.mockImplementation(() => { order.push('remove'); });
    const onUndo = vi.fn(() => { order.push('undo'); });
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input, { onUndo }); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['remove', 'undo']);
  });

  it('does not call onUndo unless Undo is pressed', async () => {
    mockCreate.mockResolvedValue(created);
    const onUndo = vi.fn();
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input, { onUndo }); });

    expect(onUndo).not.toHaveBeenCalled();
  });

  it('does not call onUndo when the create failed', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const onUndo = vi.fn();
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input, { onUndo }); });

    expect(onUndo).not.toHaveBeenCalled();
  });
});
