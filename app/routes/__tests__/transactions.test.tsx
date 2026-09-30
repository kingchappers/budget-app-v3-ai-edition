import { StrictMode, useEffect, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import type { Category, Transaction } from '~/lib/types';
import { currentYearMonth, formatMonthLabel, shiftMonth } from '~/lib/months';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food & Groceries', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '', group: 'EVERYDAY' },
  { categoryId: 'cat-mortgage', name: 'Mortgage', type: 'EXPENSE', icon: 'home', isDefault: true, createdAt: '', group: 'BILLS' },
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
  txn({ transactionId: 't3', description: 'Mortgage payment', categoryId: 'cat-mortgage' }),
];
const data = vi.hoisted(() => ({ monthsRequested: [] as string[], targetsLoading: false }));

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
  useTransactions: (yearMonth: string) => {
    data.monthsRequested.push(yearMonth);
    return { data: transactions, isLoading: false, error: null };
  },
  useTargets: () => ({ isLoading: data.targetsLoading, data: data.targetsLoading ? undefined : [{ categoryId: 'cat-mortgage', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' }] }),
  useDeleteTransaction: () => ({ mutate: vi.fn() }),
}));
vi.mock('~/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ pendingMap: {}, flushNow: vi.fn(), discard: vi.fn() }) }));

import Transactions from '../transactions';

// The app runs under StrictMode (React Router's default client entry). In dev it
// re-runs state updaters during render, which is what exposed reading the event
// inside the search updater; without StrictMode this test passes on the buggy code.
function renderRoute(url = '/transactions') {
  return render(
    <StrictMode>
      <MantineProvider>
        <MemoryRouter initialEntries={[url]}>
          <Transactions />
        </MemoryRouter>
      </MantineProvider>
    </StrictMode>,
  );
}

describe('Transactions route category filter', () => {
  it('groups the category filter options by category group', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('textbox', { name: 'Filter by category' }));

    expect(await screen.findByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
  });
});

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

describe('Transactions route query parameters', () => {
  it('opens on the month and category given in the link', () => {
    renderRoute('/transactions?month=2026-08&category=cat-mortgage');

    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(data.monthsRequested.at(-1)).toBe('2026-08');
    expect(screen.getByRole('textbox', { name: 'Filter by category' })).toHaveValue('Mortgage');
    expect(screen.getByText('Mortgage payment')).toBeInTheDocument();
    expect(screen.queryByText('Weekly Shop')).not.toBeInTheDocument();
  });

  it('shows only spending without a target for spending=untargeted', () => {
    renderRoute('/transactions?month=2026-08&spending=untargeted');

    expect(screen.getByRole('textbox', { name: 'Filter by category' })).toHaveValue('Other spending (no target)');
    expect(screen.getByText('Weekly Shop')).toBeInTheDocument();
    expect(screen.queryByText('Mortgage payment')).not.toBeInTheDocument();
  });

  it('waits for targets before listing untargeted spending', () => {
    data.targetsLoading = true;
    renderRoute('/transactions?spending=untargeted');
    expect(screen.queryByText('Mortgage payment')).not.toBeInTheDocument();
    data.targetsLoading = false;
  });

  it('ignores a month that is not valid', () => {
    renderRoute('/transactions?month=nonsense');
    expect(data.monthsRequested.at(-1)).toMatch(/^\d{4}-\d{2}$/);
    expect(data.monthsRequested.at(-1)).not.toBe('nonsense');
  });
});

describe('Transactions route count line', () => {
  it('names the month being viewed', () => {
    renderRoute('/transactions?month=2020-08&category=cat-mortgage');
    expect(screen.getByText('1 transaction in August 2020')).toBeInTheDocument();
  });

  it('says "this month" for the current month', () => {
    renderRoute();
    expect(screen.getByText('3 transactions this month')).toBeInTheDocument();
  });
});

describe('Transactions page title', () => {
  it('names the month shown and follows month changes', async () => {
    renderRoute();
    expect(document.title).toBe(`Transactions – ${formatMonthLabel(currentYearMonth())} – Budget`);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Next month' }));

    expect(document.title).toBe(`Transactions – ${formatMonthLabel(shiftMonth(currentYearMonth(), 1))} – Budget`);
  });
});
