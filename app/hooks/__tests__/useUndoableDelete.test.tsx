import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';

const mockRestore = { mutateAsync: vi.fn() };

vi.mock('~/lib/queries', () => ({
  useRestoreFromTrash: () => mockRestore,
}));

import { useUndoableDelete } from '../useUndoableDelete';
import { ApiError } from '~/lib/apiError';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderUndoableDelete() {
  function wrapper({ children }: { children: React.ReactNode }) {
    return <MantineProvider><Notifications />{children}</MantineProvider>;
  }
  return renderHook(() => useUndoableDelete(), { wrapper }).result;
}

const ref = { entityType: 'TRANSACTION' as const, id: '2026-09#t1' };

describe('useUndoableDelete', () => {
  beforeEach(() => {
    mockRestore.mutateAsync.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Unmount first: clearing while <Notifications /> is mounted starts exit timers
    // that can fire after the test environment is torn down.
    cleanup();
    notifications.clean();
    vi.restoreAllMocks();
  });

  it('says what was deleted and offers Undo straight away', async () => {
    const result = renderUndoableDelete();
    const run = vi.fn(() => new Promise<void>(() => {}));

    act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run }); });

    expect(run).toHaveBeenCalledOnce();
    expect(await screen.findByText('Deleted £3.50 · Coffee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('restores the item on Undo once the delete has gone through', async () => {
    const user = userEvent.setup();
    const result = renderUndoableDelete();
    const pending = deferred<void>();
    mockRestore.mutateAsync.mockResolvedValue(undefined);

    act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => pending.promise }); });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(mockRestore.mutateAsync).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); });

    await waitFor(() => expect(mockRestore.mutateAsync).toHaveBeenCalledWith(ref));
    expect(await screen.findByText('Restored £3.50 · Coffee')).toBeInTheDocument();
  });

  it('says the item is still there when the delete fails', async () => {
    const result = renderUndoableDelete();

    act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => Promise.reject(new Error('offline')) }); });

    expect(await screen.findByText("Couldn't delete Coffee. It's still here.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Deleted £3.50 · Coffee')).not.toBeInTheDocument());
    expect(console.error).toHaveBeenCalledWith('Delete failed', expect.objectContaining({ entityType: 'TRANSACTION' }));
  });

  it('does not try to restore after Undo when the delete failed', async () => {
    const user = userEvent.setup();
    const result = renderUndoableDelete();
    const pending = deferred<void>();

    act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => pending.promise }); });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await act(async () => { pending.reject(new Error('offline')); });

    expect(await screen.findByText("Couldn't delete Coffee. It's still here.")).toBeInTheDocument();
    expect(mockRestore.mutateAsync).not.toHaveBeenCalled();
  });

  it('points to Recently deleted when the restore fails', async () => {
    const user = userEvent.setup();
    const result = renderUndoableDelete();
    mockRestore.mutateAsync.mockRejectedValue(new Error('offline'));

    act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => Promise.resolve() }); });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByText("Couldn't restore Coffee. It's in Recently deleted.")).toBeInTheDocument();
  });

  it('explains when the item is already back in place', async () => {
    const user = userEvent.setup();
    const result = renderUndoableDelete();
    mockRestore.mutateAsync.mockRejectedValue(new ApiError(409, 'Conflict'));

    act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => Promise.resolve() }); });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByText("Coffee is already in place, so it wasn't restored.")).toBeInTheDocument();
  });

  describe('how long the Deleted message stays (Settings)', () => {
    afterEach(() => { window.localStorage.removeItem('budget.preferences'); });

    function autoCloseOfDeletedMessage(): unknown {
      const show = vi.spyOn(notifications, 'show');
      const result = renderUndoableDelete();
      act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => new Promise<void>(() => {}) }); });
      return show.mock.calls.map(call => call[0]).find(options => String(options.id).startsWith('deleted-'))?.autoClose;
    }

    it('stays until closed by default, with a close button to close it with', async () => {
      expect(autoCloseOfDeletedMessage()).toBe(false);
      expect(await screen.findByRole('button', { name: 'Close notification' })).toBeInTheDocument();
    });

    it.each([['30s', 30000], ['10s', 10000]])('goes after %s if asked', (undoDuration, milliseconds) => {
      window.localStorage.setItem('budget.preferences', JSON.stringify({ undoDuration }));
      expect(autoCloseOfDeletedMessage()).toBe(milliseconds);
    });

    it('keeps the Restored confirmation for as long as the person chose, like the Deleted message', async () => {
      const show = vi.spyOn(notifications, 'show');
      mockRestore.mutateAsync.mockResolvedValue({});
      const user = userEvent.setup();
      const result = renderUndoableDelete();
      act(() => { result.current({ label: '£3.50 · Coffee', name: 'Coffee', ref, run: () => Promise.resolve() }); });
      await user.click(await screen.findByRole('button', { name: 'Undo' }));

      await waitFor(() => expect(show.mock.calls.some(call => call[0].message === 'Restored £3.50 · Coffee')).toBe(true));
      expect(show.mock.calls.find(call => call[0].message === 'Restored £3.50 · Coffee')?.[0].autoClose).toBe(false);
    });
  });
});
