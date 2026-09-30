import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';

const data = vi.hoisted(() => ({
  categories: [] as unknown[],
  targets: [] as unknown[],
  transactions: [] as unknown[],
  pots: [] as unknown[],
  accounts: [] as unknown[],
  rangeCalls: [] as [string, string][],
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: data.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: data.targets, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: () => ({ data: data.pots, isLoading: false, error: null, refetch: vi.fn() }),
  useAccounts: () => ({ data: data.accounts, isLoading: false, error: null, refetch: vi.fn() }),
  useTransactionsRange: (from: string, to: string) => {
    data.rangeCalls.push([from, to]);
    return { data: data.transactions, isLoading: false, error: null, refetch: vi.fn() };
  },
}));

import Insights from '../insights';

function renderPage() {
  return render(<MantineProvider><Insights /></MantineProvider>);
}

function renderInsightsUser() {
  renderPage();
  return userEvent.setup();
}

beforeEach(() => {
  window.localStorage.clear();
  data.categories = [];
  data.targets = [];
  data.transactions = [];
  data.pots = [];
  data.accounts = [];
  data.rangeCalls = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-15T12:00:00'));
});

describe('Insights page', () => {
  it('defaults to a 6-month span ending at the current month', () => {
    renderPage();
    expect(data.rangeCalls.at(-1)).toEqual(['2025-10', '2026-09']);
  });

  it('narrows to the current month when "This month" is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-08', '2026-09']);
  });

  it('pages back by a whole span and keeps the span length when returning', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Earlier:/ }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-04', '2026-03']);
    await user.click(screen.getByRole('button', { name: /^Later:/ }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-10', '2026-09']);
  });

  it('disables paging forward past the current month', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^Later:/ })).toBeDisabled();
  });

  it('clamps the anchor to the current month when paging forward would move past it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Earlier:/ }));
    await user.click(screen.getByRole('radio', { name: '12M' }));
    await user.click(screen.getByRole('button', { name: /^Later:/ }));
    expect(data.rangeCalls.at(-1)).toEqual(['2024-10', '2026-09']);
    expect(screen.getByRole('button', { name: /^Later:/ })).toBeDisabled();
  });

  it('keeps the anchor month when the span changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Earlier:/ }));
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-02', '2026-03']);
  });

  it('opens a group drill-down sheet listing its categories for the current period', async () => {
    data.categories = [{ categoryId: 'cat-mortgage', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: 'tag', isDefault: true, createdAt: '' }];
    data.transactions = [{ transactionId: 't1', yearMonth: '2026-09', amount: 100000, type: 'EXPENSE', categoryId: 'cat-mortgage', description: '', date: '2026-09-01', createdAt: '' }];
    const user = renderInsightsUser();
    await user.click(screen.getByRole('button', { name: 'Spending by group' }));
    await user.click(await screen.findByText('Bills'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Mortgage')).toBeInTheDocument();
  });

  it('shows the targets and pots sections', () => {
    data.targets = [{ categoryId: 'cat-groceries', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' }];
    data.categories = [{ categoryId: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' }];
    data.pots = [{ categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 1000, thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [] }];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pots' })).toBeInTheDocument();
  });

  it('shows the Net worth section', () => {
    data.accounts = [{ accountId: 'a', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [{ date: '2026-09-01', pence: 100000 }], createdAt: '' }];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Net worth' })).toBeInTheDocument();
  });
});

describe('Insights page title', () => {
  it('names the period shown and follows changes to it', async () => {
    const user = renderInsightsUser();
    expect(document.title).toBe('Insights – April 2026 – September 2026 – Budget');

    await user.click(screen.getByRole('radio', { name: 'This month' }));

    expect(document.title).toBe('Insights – September 2026 – Budget');
  });
});

const groceries = { categoryId: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' };

function entries(yearMonth: string, days: number, amount: number, categoryId = 'cat-groceries'): unknown[] {
  return Array.from({ length: days }, (_, index) => {
    const date = `${yearMonth}-${String(index + 1).padStart(2, '0')}`;
    return { transactionId: `${date}-${categoryId}`, yearMonth, amount, type: 'EXPENSE', categoryId, description: '', date, createdAt: '' };
  });
}

async function chooseThisMonth(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('radio', { name: 'This month' }));
}

describe('Insights page paging labels', () => {
  it('says where each arrow goes', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Earlier: Oct 2025–Mar 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later: Apr–Sep 2026' })).toBeInTheDocument();
  });

  it('follows the span length', async () => {
    const user = renderInsightsUser();
    await user.click(screen.getByRole('radio', { name: '3M' }));
    expect(screen.getByRole('button', { name: 'Earlier: Apr–Jun 2026' })).toBeInTheDocument();
  });
});

describe('Insights page sections', () => {
  it('starts with every detailed section closed', () => {
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 100)];
    renderPage();

    for (const name of ['How much was tracked', 'Spending by group', 'Monthly trend', 'Biggest movers', 'Targets', 'Pots', 'Net worth']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByText('Nothing to show for this period.')).not.toBeInTheDocument();
  });

  it('remembers which sections were left open', async () => {
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 100)];
    const user = renderInsightsUser();
    await user.click(screen.getByRole('button', { name: 'Monthly trend' }));
    expect(readPreferences(window.localStorage).insightsOpenSections).toEqual(['trend']);
  });

  it('opens a remembered section straight away', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ insightsOpenSections: ['movers'] }));
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 100)];
    renderPage();
    expect(screen.getByRole('button', { name: 'Biggest movers' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Insights page comparisons', () => {
  it('compares this month so far with the same days of last month, and says so', async () => {
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 300)];
    const user = renderInsightsUser();
    await chooseThisMonth(user);

    expect(screen.getByText(/Comparing 1–15 Sep with 1–15 Aug\./)).toBeInTheDocument();
    expect(screen.getByText('£45.00')).toBeInTheDocument();
    expect(screen.getByText('1–15 Aug £15.00')).toBeInTheDocument();
    expect(screen.getByText('+£30.00 (+200%)')).toBeInTheDocument();
  });

  it('writes the findings as plain sentences at the top', async () => {
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 300)];
    const user = renderInsightsUser();
    await chooseThisMonth(user);

    const list = screen.getByRole('list', { name: 'What stood out' });
    expect(within(list).getByText('You spent £30.00 more overall in 1–15 Sep than in 1–15 Aug.')).toBeInTheDocument();
    expect(within(list).getByText('You spent £30.00 more on Groceries in 1–15 Sep than in 1–15 Aug.')).toBeInTheDocument();
  });

  it('never compares a month with hardly anything logged, and says why', async () => {
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 1, 300)];
    const user = renderInsightsUser();
    await chooseThisMonth(user);

    expect(screen.getByText('There is nothing to compare yet.')).toBeInTheDocument();
    expect(screen.getAllByText('September is partly tracked, so it is left out of comparisons.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not compared')).toHaveLength(4);
    expect(screen.queryByText(/%\)/)).not.toBeInTheDocument();
  });

  it('does not colour a month with nothing logged as a good month', async () => {
    data.categories = [groceries];
    data.transactions = [];
    const user = renderInsightsUser();
    await chooseThisMonth(user);

    expect(screen.queryByText(/less overall/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-tone]')).toBeNull();
  });

  it('lets a month be marked as not tracked, and leaves it out of the comparison', async () => {
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 300)];
    const user = renderInsightsUser();
    await chooseThisMonth(user);
    expect(screen.getByText(/Comparing 1–15 Sep with 1–15 Aug\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'How much was tracked' }));
    await user.click(screen.getByRole('button', { name: 'Mark August 2026 as not tracked' }));

    expect(readPreferences(window.localStorage).notTrackedMonths).toEqual(['2026-08']);
    expect(screen.queryByText(/Comparing 1–15 Sep/)).not.toBeInTheDocument();
    expect(screen.getAllByText('August is marked as not tracked, so it is left out of comparisons.').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Include August 2026 again' }));
    expect(readPreferences(window.localStorage).notTrackedMonths).toEqual([]);
    expect(screen.getByText(/Comparing 1–15 Sep with 1–15 Aug\./)).toBeInTheDocument();
  });

  it('labels the movers with what they are measured against', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ insightsOpenSections: ['movers'] }));
    data.categories = [groceries];
    data.transactions = [...entries('2026-08', 31, 100), ...entries('2026-09', 15, 300)];
    const user = renderInsightsUser();
    await chooseThisMonth(user);
    expect(screen.getByText('Spending up compared with 1–15 Aug')).toBeInTheDocument();
  });

  it('leaves unfinished and partly tracked months out of the target counts', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ insightsOpenSections: ['targets'] }));
    data.categories = [groceries];
    data.targets = [{ categoryId: 'cat-groceries', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' }];
    data.transactions = [...entries('2026-07', 20, 100), ...entries('2026-08', 2, 99999), ...entries('2026-09', 15, 100)];
    const user = renderInsightsUser();
    await user.click(screen.getByRole('radio', { name: '3M' }));

    // Only July counts: August is barely logged and September is not finished.
    expect(screen.getByText('Groceries: within target in 1 of 1 month')).toBeInTheDocument();
  });
});

describe('Insights milestones', () => {
  const holidays = { categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: 'tag', isDefault: true, createdAt: '' };
  const reachedPot = { categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: 100000, autoAmountNow: 0, balance: 100000, thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [] };

  it('are off by default', () => {
    data.categories = [holidays];
    data.pots = [reachedPot];
    renderPage();
    expect(screen.queryByRole('button', { name: 'Milestones' })).not.toBeInTheDocument();
    expect(screen.queryByText(/goal reached/i)).not.toBeInTheDocument();
  });

  it('show outcomes only, once switched on', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ showMilestones: true }));
    data.categories = [holidays];
    data.pots = [reachedPot];
    const user = renderInsightsUser();
    await user.click(screen.getByRole('button', { name: 'Milestones' }));
    expect(screen.getByText('Holidays: goal reached.')).toBeInTheDocument();
  });
});
