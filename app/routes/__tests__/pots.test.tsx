import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, PotSummary } from '~/lib/types';

const state = vi.hoisted(() => ({
  categories: [] as unknown[],
  pots: [] as unknown[],
  potsError: false,
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, preset }: { opened: boolean; preset?: { type: string; categoryId: string } | null }) =>
    (opened ? <div>Add sheet: {preset?.type} {preset?.categoryId}</div> : null),
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: () => ({
    data: state.potsError ? undefined : state.pots,
    isLoading: false,
    error: state.potsError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
}));

import Pots from '../pots';

function cat(categoryId: string, name: string, group: Category['group'], icon = 'tag'): Category {
  return { categoryId, name, type: 'POT', group, icon, isDefault: true, createdAt: '' };
}

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function renderPage() {
  return render(<MantineProvider><Pots /></MantineProvider>);
}

beforeEach(() => {
  state.potsError = false;
  state.categories = [
    cat('cat-holidays', 'Holidays', 'SINKING_FUNDS', '✈️'),
    cat('cat-emergency-fund', 'Emergency fund', 'SAVING_INVESTMENT', '😌'),
  ];
  state.pots = [
    pot('cat-holidays', { balance: 25000, thisMonth: { setAside: 5000, autoAdded: 0, takeOut: 0, spent: 1000 } }),
    pot('cat-emergency-fund', { balance: 80000, goalAmount: 300000, monthlyAmount: 5000, autoAmountNow: 5000 }),
  ];
});

describe('Pots page', () => {
  it('groups pots under Sinking Funds and Saving & Investment in group order', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(headings).toEqual(['Sinking Funds', 'Saving & Investment']);
  });

  it('shows the emoji label, balance and this month for a pot', () => {
    renderPage();
    expect(screen.getByText('✈️ Holidays')).toBeInTheDocument();
    expect(screen.getByText('£250.00')).toBeInTheDocument();
    expect(screen.getByText('+£50.00 set aside · −£10.00 spent')).toBeInTheDocument();
  });

  it('shows goal progress and the auto-contribute badge', () => {
    renderPage();
    expect(screen.getByText('£800.00 of £3,000.00')).toBeInTheDocument();
    expect(screen.getByText('Auto £50.00/mo')).toBeInTheDocument();
  });

  it('flags a balance below zero', () => {
    state.pots = [pot('cat-holidays', { balance: -3000 }), pot('cat-emergency-fund')];
    renderPage();
    expect(screen.getByText('Below zero')).toBeInTheDocument();
    expect(screen.getByText('−£30.00')).toBeInTheDocument();
  });

  it('opens the Add sheet on Set aside with the pot preselected', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set aside to Holidays' }));
    expect(screen.getByText('Add sheet: SET_ASIDE cat-holidays')).toBeInTheDocument();
  });

  it('shows an empty state when there are no pots', () => {
    state.categories = [];
    state.pots = [];
    renderPage();
    expect(screen.getByText(/No pots yet/)).toBeInTheDocument();
  });

  it('shows an error with a retry when the pots fail to load', () => {
    state.potsError = true;
    renderPage();
    expect(screen.getByText('Could not load pots')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
