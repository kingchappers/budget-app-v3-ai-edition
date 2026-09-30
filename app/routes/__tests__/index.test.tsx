import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/recurring/DueRecurringCard', () => ({ DueRecurringCard: () => <div>Due card</div> }));
vi.mock('~/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ pendingMap: {}, flushNow: vi.fn(), discard: vi.fn() }) }));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, editing }: { opened: boolean; editing?: { description: string } | null }) =>
    opened ? <div>{editing ? `Editing ${editing.description}` : 'Sheet open'}</div> : null,
}));
vi.mock('~/components/recurring/RecurringForm', () => ({ RecurringForm: () => null }));
const data = vi.hoisted(() => ({
  categories: [] as unknown[], targets: [] as unknown[], pots: [] as unknown[], transactions: [] as unknown[],
  potsCalls: [] as [string, boolean | undefined][],
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: data.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: data.targets, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: (asOf: string, enabled?: boolean) => {
    data.potsCalls.push([asOf, enabled]);
    return { data: data.pots, isLoading: false, error: null };
  },
  useTransactions: () => ({ data: data.transactions, isLoading: false, error: null, refetch: vi.fn() }),
  useDeleteTransaction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useRestoreFromTrash: () => ({ mutateAsync: vi.fn() }),
}));

import Home from '../_index';
import { currentYearMonth, formatMonthLabel, monthName, shiftMonth } from '~/lib/months';

const thisMonth = currentYearMonth();
const lastMonth = shiftMonth(thisMonth, -1);

const groceries = { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' };
const dining = { categoryId: 'd', name: 'Dining', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' };
const salary = { categoryId: 's', name: 'Salary', type: 'INCOME', icon: 'tag', isDefault: true, createdAt: '' };

function txn(over: Record<string, unknown>) {
  return {
    transactionId: 't1', yearMonth: thisMonth, amount: 1000, type: 'EXPENSE', categoryId: 'g',
    description: '', date: `${thisMonth}-01`, createdAt: '', ...over,
  };
}

function renderHome() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('Home', () => {
  beforeEach(() => {
    data.categories = [];
    data.targets = [];
    data.pots = [];
    data.transactions = [];
    data.potsCalls = [];
    window.localStorage.clear();
  });

  it('shows the Due card above the month header', () => {
    renderHome();
    const card = screen.getByText('Due card');
    const header = screen.getByRole('heading', { level: 3 });
    expect(card.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('always links to the Recurring page', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'Manage recurring' })).toHaveAttribute('href', '/recurring');
  });

  it('shows group sub-headings inside the spending section, in group order', () => {
    data.categories = [
      { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' },
      { categoryId: 'm', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: 'tag', isDefault: true, createdAt: '' },
    ];
    data.targets = [
      { categoryId: 'g', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' },
      { categoryId: 'm', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' },
    ];
    renderHome();
    const bills = screen.getByText('Bills');
    const everyday = screen.getByText('Everyday Spending');
    expect(bills.compareDocumentPosition(everyday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a Pots section with balances and a link to the Pots page', () => {
    data.categories = [
      { categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '' },
    ];
    data.pots = [{
      categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 12000,
      thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [],
    }];
    renderHome();
    expect(screen.getByRole('heading', { name: 'Pots' })).toBeInTheDocument();
    expect(screen.getByText('£120.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all pots' })).toHaveAttribute('href', '/pots');
  });

  it('does not show a Pots section when there are no pots', () => {
    renderHome();
    expect(screen.queryByRole('heading', { name: 'Pots' })).not.toBeInTheDocument();
  });

  describe('pots month bound', () => {
    beforeEach(() => {
      data.categories = [
        { categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '' },
      ];
      data.pots = [{
        categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 12000,
        thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [],
      }];
    });

    const lastCall = () => data.potsCalls[data.potsCalls.length - 1];

    it('enables the pots query at the current month', () => {
      renderHome();
      expect(lastCall()[1]).toBe(true);
      expect(screen.getByRole('heading', { name: 'Pots' })).toBeInTheDocument();
    });

    it('keeps pots enabled one month ahead', () => {
      renderHome();
      fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
      expect(lastCall()[1]).toBe(true);
      expect(screen.getByRole('heading', { name: 'Pots' })).toBeInTheDocument();
    });

    it('disables pots and hides the section two months ahead', () => {
      renderHome();
      fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
      fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
      expect(lastCall()[1]).toBe(false);
      expect(screen.queryByRole('heading', { name: 'Pots' })).not.toBeInTheDocument();
      expect(screen.queryByText('Could not load pots.')).not.toBeInTheDocument();
    });
  });
});

describe('Home left to spend', () => {
  beforeEach(() => {
    data.categories = [groceries, dining, salary];
    data.targets = [{ categoryId: 'g', targetAmount: 25000, period: 'MONTHLY', updatedAt: '' }];
    data.pots = [];
    data.potsCalls = [];
    data.transactions = [
      txn({ transactionId: 'a', amount: 18240, categoryId: 'g', description: 'Weekly Shop' }),
      txn({ transactionId: 'b', amount: 3000, categoryId: 'd', description: 'Pizza' }),
    ];
    window.localStorage.clear();
  });

  it('opens with how much is left and how many days remain', () => {
    renderHome();
    expect(screen.getByText(/^£67\.60 left to spend this month · \d+ days? to go$/)).toBeInTheDocument();
  });

  it('describes going over calmly', () => {
    data.transactions = [txn({ amount: 29000, categoryId: 'g' })];
    renderHome();
    expect(screen.getByText('£40.00 over so far. Nothing needs doing today.')).toBeInTheDocument();
  });

  it('describes a past month without a days count', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText(`£67.60 left at the end of ${monthName(lastMonth)}`)).toBeInTheDocument();
    expect(screen.queryByText(/days? to go/)).not.toBeInTheDocument();
  });

  it('shows everything spent, including spending without a target', () => {
    renderHome();
    expect(screen.getByText('Spent this month').parentElement).toHaveTextContent('£212.40');
  });

  it('leads each category row with what is left', () => {
    renderHome();
    expect(screen.getByText('£67.60 left')).toBeInTheDocument();
    expect(screen.getByText('£182.40 spent of £250.00')).toBeInTheDocument();
  });

  it('says how much a category is over', () => {
    data.transactions = [txn({ amount: 26200, categoryId: 'g' })];
    renderHome();
    expect(screen.getByText('£12.00 over')).toBeInTheDocument();
  });

  it('links each category to its transactions for the month', () => {
    renderHome();
    expect(screen.getByRole('link', { name: /Groceries/ }))
      .toHaveAttribute('href', `/transactions?month=${thisMonth}&category=g`);
  });

  it('links spending without a target to the filtered list', () => {
    renderHome();
    const link = screen.getByRole('link', { name: /Other spending \(no target\)/ });
    expect(link).toHaveTextContent('£30.00');
    expect(link).toHaveAttribute('href', `/transactions?month=${thisMonth}&spending=untargeted`);
  });

  it('opens Edit when a Recent row is tapped', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: 'Edit Weekly Shop' }));
    expect(screen.getByText('Editing Weekly Shop')).toBeInTheDocument();
  });

  it('offers the row menu, including Delete, on Recent rows', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: 'Actions for Pizza' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('names the month on labels when viewing another month', () => {
    data.transactions = [];
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    const name = monthName(lastMonth);
    expect(screen.getByText(`Income in ${name}`)).toBeInTheDocument();
    expect(screen.getByText(`Spent in ${name}`)).toBeInTheDocument();
    expect(screen.getByText(`Nothing logged in ${name}.`)).toBeInTheDocument();
  });
});

describe('Home without targets', () => {
  beforeEach(() => {
    data.categories = [groceries, salary];
    data.targets = [];
    data.pots = [];
    data.potsCalls = [];
    data.transactions = [txn({ amount: 4500, categoryId: 'g' })];
    window.localStorage.clear();
  });

  it('shows only what was spent', () => {
    renderHome();
    expect(screen.getByText('Spent this month').parentElement).toHaveTextContent('£45.00');
    expect(screen.queryByText(/left to spend|over so far/)).not.toBeInTheDocument();
    expect(screen.queryByText('Other spending (no target)')).not.toBeInTheDocument();
  });

  it('explains that targets are optional', () => {
    renderHome();
    expect(screen.getByText("Targets are optional. Set one to see what's left in a category.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set targets' })).toHaveAttribute('href', '/targets');
  });

  it('hides the targets card for good after "Just tracking for now"', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHome();
    await user.click(screen.getByRole('button', { name: 'Just tracking for now' }));
    expect(screen.queryByText(/Targets are optional/)).not.toBeInTheDocument();

    unmount();
    renderHome();
    expect(screen.queryByText(/Targets are optional/)).not.toBeInTheDocument();
    expect(screen.getByText('Spent this month')).toBeInTheDocument();
  });

  it('still shows the card when storage cannot be read', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHome();
    expect(screen.getByText(/Targets are optional/)).toBeInTheDocument();
    getItem.mockRestore();
    error.mockRestore();
  });
});

describe('Home page title', () => {
  it('names the month shown and follows month changes', async () => {
    renderHome();
    expect(document.title).toBe(`Home – ${formatMonthLabel(currentYearMonth())} – Budget`);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous month' }));

    expect(document.title).toBe(`Home – ${formatMonthLabel(shiftMonth(currentYearMonth(), -1))} – Budget`);
  });
});
