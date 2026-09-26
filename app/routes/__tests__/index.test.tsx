import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/recurring/DueRecurringCard', () => ({ DueRecurringCard: () => <div>Due card</div> }));
const data = vi.hoisted(() => ({ categories: [] as unknown[], targets: [] as unknown[], pots: [] as unknown[], potsCalls: [] as [string, boolean | undefined][] }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: data.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: data.targets, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: (asOf: string, enabled?: boolean) => {
    data.potsCalls.push([asOf, enabled]);
    return { data: data.pots, isLoading: false, error: null };
  },
  useTransactions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

import Home from '../_index';

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
    data.potsCalls = [];
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
