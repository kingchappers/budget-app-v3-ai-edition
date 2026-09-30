import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Category, Transaction } from '~/lib/types';

const server = vi.hoisted(() => ({
  transactions: [] as Transaction[],
  trashed: [] as Transaction[],
  failDelete: false,
  request: vi.fn(),
}));

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request: server.request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true, user: { sub: 'user-1' } }) }));
vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({ TransactionSheet: () => null }));
vi.mock('~/components/recurring/RecurringForm', () => ({ RecurringForm: () => null }));
vi.mock('~/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ pendingMap: {}, flushNow: vi.fn(), discard: vi.fn() }) }));
vi.mock('~/lib/months', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/months')>()),
  currentYearMonth: () => '2026-09',
}));

import Transactions from '../transactions';

const categories: Category[] = [
  { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
];

const coffee: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 350, type: 'EXPENSE',
  categoryId: 'cat-dining', description: 'Coffee', date: '2026-09-29', createdAt: '',
};
const lunch: Transaction = { ...coffee, transactionId: 't2', description: 'Lunch', amount: 800 };

async function handle(endpoint: string, options: RequestInit = {}): Promise<unknown> {
  if (endpoint === '/api/categories') return { categories };
  if (endpoint.startsWith('/api/transactions?')) return { transactions: [...server.transactions] };
  if (options.method === 'DELETE' && endpoint.startsWith('/api/transactions/')) {
    if (server.failDelete) throw new Error('Network error');
    const id = decodeURIComponent(endpoint.split('/').pop() ?? '');
    server.trashed.push(...server.transactions.filter(t => t.transactionId === id));
    server.transactions = server.transactions.filter(t => t.transactionId !== id);
    return null;
  }
  if (endpoint === '/api/trash/restore') {
    const { id } = JSON.parse(String(options.body)) as { id: string };
    const restored = server.trashed.find(t => `${t.yearMonth}#${t.transactionId}` === id);
    if (restored) server.transactions.push(restored);
    return {};
  }
  throw new Error(`Unexpected request ${endpoint}`);
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <Notifications />
        <Transactions />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

async function deleteRow(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(await screen.findByRole('button', { name: `Actions for ${label}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
}

beforeEach(() => {
  server.transactions = [coffee, lunch];
  server.trashed = [];
  server.failDelete = false;
  server.request.mockReset();
  server.request.mockImplementation(handle);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Unmount first: clearing while <Notifications /> is mounted starts exit timers
  // that can fire after the test environment is torn down.
  cleanup();
  notifications.clean();
  vi.restoreAllMocks();
});

describe('Transactions route delete', () => {
  it('hides the row at once and says what was deleted, with Undo', async () => {
    const user = userEvent.setup();
    renderRoute();

    await deleteRow(user, 'Coffee');

    await waitFor(() => expect(screen.queryByText('Coffee')).not.toBeInTheDocument());
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(await screen.findByText('Deleted £3.50 · Coffee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('brings the row back when Undo is pressed', async () => {
    const user = userEvent.setup();
    renderRoute();

    await deleteRow(user, 'Coffee');
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Coffee')).toBeInTheDocument();
    expect(server.request).toHaveBeenCalledWith('/api/trash/restore', expect.objectContaining({
      body: JSON.stringify({ entityType: 'TRANSACTION', id: '2026-09#t1' }),
    }));
  });

  it('puts the row back and says so when the delete fails', async () => {
    const user = userEvent.setup();
    server.failDelete = true;
    renderRoute();

    await deleteRow(user, 'Coffee');

    expect(await screen.findByText("Couldn't delete Coffee. It's still here.")).toBeInTheDocument();
    expect(screen.getByText('Coffee')).toBeInTheDocument();
  });
});
