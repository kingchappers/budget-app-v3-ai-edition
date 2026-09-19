import { StrictMode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, Transaction } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food & Groceries', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '' },
];

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 1000, type: 'EXPENSE',
    categoryId: 'cat-food', description: '', date: '2026-09-10', createdAt: '', ...over,
  };
}

const transactions: Transaction[] = [
  txn({ transactionId: 't1', description: 'Weekly Shop' }),
  txn({ transactionId: 't2', description: 'Petrol' }),
];

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({ TransactionSheet: () => null }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: categories }),
  useTransactions: () => ({ data: transactions, isLoading: false, error: null }),
  useDeleteTransaction: () => ({ mutate: vi.fn() }),
}));

import Transactions from '../transactions';

// The app runs under StrictMode (React Router's default client entry). In dev it
// re-runs state updaters during render, which is what exposed reading the event
// inside the search updater; without StrictMode this test passes on the buggy code.
function renderRoute() {
  return render(
    <StrictMode>
      <MantineProvider>
        <Transactions />
      </MantineProvider>
    </StrictMode>,
  );
}

describe('Transactions route search', () => {
  it('filters the list as the user types in the search box', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.type(screen.getByLabelText('Search transactions'), 'shop');

    expect(screen.getByLabelText('Search transactions')).toHaveValue('shop');
    expect(screen.getByText('Weekly Shop')).toBeInTheDocument();
    expect(screen.queryByText('Petrol')).not.toBeInTheDocument();
  });

  it('clears the search with the clear button', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.type(screen.getByLabelText('Search transactions'), 'shop');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.getByLabelText('Search transactions')).toHaveValue('');
    expect(screen.getByText('Petrol')).toBeInTheDocument();
  });
});
