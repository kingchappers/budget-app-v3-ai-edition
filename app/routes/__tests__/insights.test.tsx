import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

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

function renderPage(url: string = '/insights') {
  return render(<MantineProvider><MemoryRouter initialEntries={[url]}><Insights /></MemoryRouter></MantineProvider>);
}

function renderInsightsUser() {
  renderPage();
  return userEvent.setup();
}

beforeEach(() => {
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

  it('starts from the month named in the link, so it matches the other pages', () => {
    renderPage('/insights?month=2026-06');
    expect(data.rangeCalls.at(-1)).toEqual(['2025-07', '2026-06']);
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
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-04', '2026-03']);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-10', '2026-09']);
  });

  it('disables paging forward past the current month', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('clamps the anchor to the current month when paging forward would move past it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    await user.click(screen.getByRole('radio', { name: '12M' }));
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2024-10', '2026-09']);
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('keeps the anchor month when the span changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-02', '2026-03']);
  });

  it('opens a group drill-down sheet listing its categories for the current period', async () => {
    data.categories = [{ categoryId: 'cat-mortgage', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: 'tag', isDefault: true, createdAt: '' }];
    data.transactions = [{ transactionId: 't1', yearMonth: '2026-09', amount: 100000, type: 'EXPENSE', categoryId: 'cat-mortgage', description: '', date: '2026-09-01', createdAt: '' }];
    const user = renderInsightsUser();
    await user.click(await screen.findByText('Bills'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Mortgage')).toBeInTheDocument();
  });

  it('shows the budgets and pots sections', () => {
    data.targets = [{ categoryId: 'cat-groceries', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' }];
    data.categories = [{ categoryId: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' }];
    data.pots = [{ categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 1000, thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [] }];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Budgets' })).toBeInTheDocument();
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
