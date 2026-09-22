import { StrictMode, useEffect, useState } from 'react';
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
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, template }: { opened: boolean; template?: { description: string } | null }) =>
    opened ? <div>{template ? `Sheet template: ${template.description}` : 'Sheet open'}</div> : null,
}));
vi.mock('~/components/recurring/RecurringForm', () => ({
  RecurringForm: function MockRecurringForm({ opened, draft }: { opened: boolean; draft?: { description: string; dayOfMonth: number } | null }) {
    const [note, setNote] = useState('');
    useEffect(() => {
      if (opened) setNote(draft?.description ?? '');
    }, [opened, draft]);
    if (!opened) return null;
    return (
      <div>
        <div>{`Repeat draft: ${draft?.description} on day ${draft?.dayOfMonth}`}</div>
        <input aria-label="Repeat note" value={note} onChange={e => setNote(e.currentTarget.value)} />
      </div>
    );
  },
}));
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

describe('Transactions route duplicate', () => {
  it('opens the add sheet prefilled from a row via Duplicate', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    expect(screen.getByText('Sheet template: Weekly Shop')).toBeInTheDocument();
  });
});

describe('Transactions route repeat monthly', () => {
  it('opens the recurring form prefilled from a row, using the day of its date', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Repeat monthly' }));

    expect(screen.getByText('Repeat draft: Weekly Shop on day 10')).toBeInTheDocument();
  });

  it('keeps what the user typed in the form when the route re-renders', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Repeat monthly' }));
    await user.clear(screen.getByLabelText('Repeat note'));
    await user.type(screen.getByLabelText('Repeat note'), 'Rent');
    await user.type(screen.getByLabelText('Search transactions'), 'x');

    expect(screen.getByLabelText('Repeat note')).toHaveValue('Rent');
  });
});
