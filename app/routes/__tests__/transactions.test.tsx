import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
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
const data = vi.hoisted(() => ({
  monthsRequested: [] as string[],
  targetsLoading: false,
  // What the two-year search returns, and how it was asked for.
  range: [] as Transaction[],
  rangeCalls: [] as { from: string; to: string; enabled: boolean }[],
}));

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
  useTransactionsRange: (from: string, to: string, enabled: boolean = true) => {
    data.rangeCalls.push({ from, to, enabled });
    return { data: enabled ? data.range : undefined, isLoading: false, error: null };
  },
  useTargets: () => ({ isLoading: data.targetsLoading, data: data.targetsLoading ? undefined : [{ categoryId: 'cat-mortgage', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' }] }),
  useDeleteTransaction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useRestoreFromTrash: () => ({ mutateAsync: vi.fn() }),
}));
const queue = vi.hoisted(() => ({ pendingMap: {} as Record<string, unknown>, flushNow: vi.fn() }));
vi.mock('~/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ pendingMap: queue.pendingMap, flushNow: queue.flushNow, discard: vi.fn() }),
}));

import Transactions from '../transactions';
import { expectNoViolations, expectSoundHeadings } from '~/test-utils/accessibility';

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
  beforeEach(() => {
    data.range = [];
    data.rangeCalls = [];
  });

  it('filters the list as the user types in the search box', async () => {
    data.range = transactions;
    const user = userEvent.setup();
    renderRoute();

    await user.type(screen.getByLabelText('Search transactions'), 'shop');

    expect(screen.getByLabelText('Search transactions')).toHaveValue('shop');
    expect(screen.getByText('Weekly Shop')).toBeInTheDocument();
    expect(screen.queryByText('Petrol')).not.toBeInTheDocument();
  });

  it('clears the search with the clear button', async () => {
    data.range = transactions;
    const user = userEvent.setup();
    renderRoute();

    await user.type(screen.getByLabelText('Search transactions'), 'shop');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.getByLabelText('Search transactions')).toHaveValue('');
    expect(screen.getByText('Petrol')).toBeInTheDocument();
  });

  it('does not fetch two years of transactions until someone searches', async () => {
    const user = userEvent.setup();
    renderRoute();
    expect(data.rangeCalls.every(call => call.enabled === false)).toBe(true);

    await user.type(screen.getByLabelText('Search transactions'), 's');
    expect(data.rangeCalls.some(call => call.enabled)).toBe(true);
  });

  it('searches the last 24 months, ending this month, whichever month is on screen', async () => {
    const user = userEvent.setup();
    renderRoute('/transactions?month=2020-08');
    await user.type(screen.getByLabelText('Search transactions'), 's');

    const call = data.rangeCalls.filter(c => c.enabled).at(-1);
    expect(call?.to).toBe(currentYearMonth());
    expect(call?.from).toBe(shiftMonth(currentYearMonth(), -23));
  });

  it('finds matches from other months and groups them under month headings, newest first', async () => {
    data.range = [
      txn({ transactionId: 'a', description: 'Coffee beans', date: '2026-09-10', yearMonth: '2026-09' }),
      txn({ transactionId: 'b', description: 'Coffee machine', date: '2026-06-02', yearMonth: '2026-06' }),
      txn({ transactionId: 'c', description: 'Coffee filters', date: '2026-09-25', yearMonth: '2026-09' }),
    ];
    const user = userEvent.setup();
    renderRoute();
    await user.type(screen.getByLabelText('Search transactions'), 'coffee');

    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(headings).toEqual(['September 2026', 'June 2026']);
    expect(screen.getByText('3 transactions found')).toBeInTheDocument();
    const order = screen.getAllByText(/^Coffee /).map(node => node.textContent);
    expect(order).toEqual(['Coffee filters', 'Coffee beans', 'Coffee machine']);
  });

  it('says it is searching the last two years and hides the month stepper while it does', async () => {
    const user = userEvent.setup();
    renderRoute();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search transactions'), 'x');

    expect(screen.getByText(/Searching the last 2 years/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument();
  });

  it('still applies the category and type filters to search results', async () => {
    data.range = [
      txn({ transactionId: 'a', description: 'Rent shop', categoryId: 'cat-food' }),
      txn({ transactionId: 'b', description: 'Rent payment', categoryId: 'cat-mortgage' }),
    ];
    const user = userEvent.setup();
    renderRoute('/transactions?category=cat-mortgage');
    await user.type(screen.getByLabelText('Search transactions'), 'rent');

    expect(screen.getByText('Rent payment')).toBeInTheDocument();
    expect(screen.queryByText('Rent shop')).not.toBeInTheDocument();
  });

  it('returns to the month view when the search is cleared', async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.type(screen.getByLabelText('Search transactions'), 'x');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.queryByText(/Searching the last 2 years/)).not.toBeInTheDocument();
  });
});

describe('Transactions route day headings', () => {
  it('names days in words, not as ISO dates', () => {
    renderRoute();
    expect(screen.queryByText('2026-09-10')).not.toBeInTheDocument();
    expect(screen.getAllByText(/^(Today|Yesterday|(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2})/).length).toBeGreaterThan(0);
  });
});

describe('Transactions route duplicate', () => {
  it('opens the add sheet prefilled from a row via Duplicate', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: 'Duplicate Weekly Shop' }));

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

  it('shows only spending without a budget for spending=untargeted', () => {
    renderRoute('/transactions?month=2026-08&spending=untargeted');

    expect(screen.getByRole('textbox', { name: 'Filter by category' })).toHaveValue('Other spending (no budget)');
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

describe('Transactions route sync status', () => {
  afterEach(() => {
    queue.pendingMap = {};
    queue.flushNow.mockReset();
  });

  it('shows a sync error on the row and Retry flushes the offline queue', async () => {
    queue.pendingMap = {
      t2: { id: 't2', input: {}, queuedAt: '', userSub: 'u', queued: true, lastError: 'categoryId must be an existing category' },
    };
    const user = userEvent.setup();
    renderRoute();

    expect(screen.getByText('Not synced. Tap to retry.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry syncing Petrol' }));
    expect(queue.flushNow).toHaveBeenCalledTimes(1);
  });

  it('labels a row whose save is still in flight as Saving', () => {
    queue.pendingMap = { t1: { id: 't1', input: {}, queuedAt: '', userSub: 'u', queued: false } };
    renderRoute();
    expect(screen.getByText('Saving')).toBeInTheDocument();
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

describe('Accessibility', () => {
  it('has one h1 and no skipped heading levels', () => {
    renderRoute();
    expectSoundHeadings(document.body);
  });

  it('has no unlabelled controls, empty buttons or empty headings', async () => {
    renderRoute();
    await expectNoViolations(document.body);
  });
});
