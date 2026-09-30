import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import type { Category } from '~/lib/types';
import type { TrashEntry } from '~/lib/trash';

const state = vi.hoisted(() => ({
  trash: { data: [] as TrashEntry[] | undefined, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  restore: vi.fn(),
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const categories: Category[] = [
  { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-food', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
];

vi.mock('~/lib/queries', () => ({
  useTrash: () => state.trash,
  useCategories: () => ({ data: categories }),
  useRestoreFromTrash: () => ({ mutateAsync: state.restore }),
}));

import Deleted from '../deleted';
import { ApiError } from '~/lib/apiError';
import { expectReadable } from '~/test-utils/readableText';

function entry(over: Partial<TrashEntry>): TrashEntry {
  return {
    entityType: 'TRANSACTION', id: '2026-09#t1', deletedAt: '2026-09-29T11:00:00.000Z', expiresAt: 0,
    item: { amount: 350, description: 'Coffee', categoryId: 'cat-dining' },
    ...over,
  };
}

function renderPage() {
  render(<MantineProvider><Notifications /><Deleted /></MantineProvider>);
}

beforeEach(() => {
  state.trash = { data: [], isLoading: false, error: null, refetch: vi.fn() };
  state.restore.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Unmount first: clearing while <Notifications /> is mounted starts exit timers
  // that can fire after the test environment is torn down.
  cleanup();
  notifications.clean();
  vi.restoreAllMocks();
});

describe('Recently deleted page', () => {
  it('explains how long items are kept', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Recently deleted' })).toBeInTheDocument();
    expect(screen.getByText('Deleted items are kept for 30 days, then removed for good.')).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderPage();
    expect(screen.getByText('Nothing deleted in the last 30 days.')).toBeInTheDocument();
  });

  it('lists items grouped by type, with what each was and when it was deleted', () => {
    state.trash.data = [
      entry({ entityType: 'ACCOUNT', id: 'acc-1', item: { name: 'Lloyds', balances: [{ date: '2026-09-01', pence: 1 }] } }),
      entry({}),
      entry({ entityType: 'TARGET', id: 'cat-food', item: { categoryId: 'cat-food', targetAmount: 30000 } }),
    ];
    renderPage();

    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(headings).toEqual(['Transactions', 'Targets', 'Accounts']);
    expect(screen.getByText('£3.50 · Coffee')).toBeInTheDocument();
    expect(screen.getByText('£300.00 target · Groceries')).toBeInTheDocument();
    expect(screen.getByText('Lloyds and its 1 balance entry')).toBeInTheDocument();
    expect(screen.getAllByText(/^Deleted 29 Sept?, \d{2}:\d{2}$/)).toHaveLength(3);
    screen.getAllByText(/^Deleted 29 Sept?, \d{2}:\d{2}$/).forEach(expectReadable);
    expect(screen.queryByText('Nothing deleted in the last 30 days.')).not.toBeInTheDocument();
  });

  it('restores an item and says so', async () => {
    state.trash.data = [entry({})];
    state.restore.mockResolvedValue(undefined);
    renderPage();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore £3.50 · Coffee' }));

    expect(state.restore).toHaveBeenCalledWith({ entityType: 'TRANSACTION', id: '2026-09#t1' });
    expect(await screen.findByText('Restored £3.50 · Coffee')).toBeInTheDocument();
  });

  it('explains a failed restore without losing the item', async () => {
    state.trash.data = [entry({})];
    state.restore.mockRejectedValue(new Error('offline'));
    renderPage();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore £3.50 · Coffee' }));

    expect(await screen.findByText("Couldn't restore £3.50 · Coffee. It's still here, so you can try again.")).toBeInTheDocument();
  });

  it('explains when the original is already in place', async () => {
    state.trash.data = [entry({})];
    state.restore.mockRejectedValue(new ApiError(409, 'Conflict'));
    renderPage();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore £3.50 · Coffee' }));

    await waitFor(() => expect(screen.getByText("£3.50 · Coffee is already in place, so it wasn't restored.")).toBeInTheDocument());
  });

  it('offers a retry when loading fails', async () => {
    state.trash = { data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() };
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.trash.refetch).toHaveBeenCalled();
  });
});
