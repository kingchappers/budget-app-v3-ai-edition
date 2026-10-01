import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, useLocation } from 'react-router';
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
vi.mock('~/components/pots/PotHistorySheet', () => ({
  PotHistorySheet: ({ pot, suggestedMonthly, onClose }: { pot: { categoryId: string } | null; suggestedMonthly?: number; onClose: () => void }) =>
    (pot ? <div>History: {pot.categoryId} {suggestedMonthly ?? 'no suggestion'}<button onClick={onClose}>close pot</button></div> : null),
}));
vi.mock('~/lib/queries', () => ({
  useSavePot: () => ({ mutate: vi.fn(), isPending: false }),
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: () => ({
    data: state.potsError ? undefined : state.pots,
    isLoading: false,
    error: state.potsError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
}));

import Pots from '../pots';
import { expectNoViolations, expectSoundHeadings } from '~/test-utils/accessibility';

function cat(categoryId: string, name: string, group: Category['group'], icon = 'tag'): Category {
  return { categoryId, name, type: 'POT', group, icon, isDefault: true, createdAt: '' };
}

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function CurrentSearch() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(url = '/pots') {
  return render(<MantineProvider><MemoryRouter initialEntries={[url]}><Pots /><CurrentSearch /></MemoryRouter></MantineProvider>);
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
  it('groups pots under Saving for known costs and Saving & Investment in group order', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(headings).toEqual(['Saving for known costs', 'Saving & Investment']);
  });

  it('shows the emoji label, balance and this month for a pot', () => {
    renderPage();
    expect(screen.getByText('✈️ Holidays')).toBeInTheDocument();
    expect(screen.getByText('£250.00')).toBeInTheDocument();
    expect(screen.getByText('+£50.00 added to pot · −£10.00 spent')).toBeInTheDocument();
  });

  it('shows goal progress and the auto-contribute badge', () => {
    renderPage();
    expect(screen.getByText('£800.00 of £3,000.00')).toBeInTheDocument();
    expect(screen.getByText('Auto £50.00 a month')).toBeInTheDocument();
  });

  it('flags a balance below zero', () => {
    state.pots = [pot('cat-holidays', { balance: -3000 }), pot('cat-emergency-fund')];
    renderPage();
    expect(screen.getByText('Below zero')).toBeInTheDocument();
    expect(screen.getByText('−£30.00')).toBeInTheDocument();
  });

  it('opens the Add sheet on Add to pot with the pot preselected', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add to Holidays pot' }));
    expect(screen.getByText('Add sheet: SET_ASIDE cat-holidays')).toBeInTheDocument();
  });

  it('opens the history sheet for the tapped pot', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /Open Holidays history/ }));
    expect(screen.getByText('History: cat-holidays no suggestion')).toBeInTheDocument();
  });

  it('exposes the balance, the below-zero warning and the progress inside the history button', () => {
    state.pots = [pot('cat-holidays', { balance: -3000, goalAmount: 100000, autoAmountNow: 5000 }), pot('cat-emergency-fund')];
    renderPage();
    const open = screen.getByRole('button', { name: /Open Holidays history/ });
    expect(open).toHaveAccessibleName(/−£30\.00/);
    expect(open).toHaveAccessibleName(/Below zero/);
    expect(open).toHaveAccessibleName(/of £1,000\.00/);
    expect(open).not.toHaveAttribute('aria-label');
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
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your pots");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  describe('opened from a recurring bill', () => {
    beforeEach(() => {
      state.categories = [cat('holidays', 'Holidays', 'SINKING_FUNDS')];
      state.pots = [pot('holidays')];
    });

    it('opens that pot with the suggested monthly amount', () => {
      renderPage('/pots?pot=holidays&monthly=3000');
      expect(screen.getByText('History: holidays 3000')).toBeInTheDocument();
    });

    it('ignores a monthly amount that is not a whole number of pence', () => {
      renderPage('/pots?pot=holidays&monthly=abc');
      expect(screen.getByText('History: holidays no suggestion')).toBeInTheDocument();
    });

    it('keeps the Plan tab in the address when the pot is closed, and drops only what opened it', async () => {
      renderPage('/plan?tab=pots&pot=holidays&monthly=3000');
      await userEvent.setup().click(screen.getByRole('button', { name: 'close pot' }));
      expect(screen.getByTestId('search').textContent).toBe('?tab=pots');
    });

    it('opens nothing for a pot that does not exist', () => {
      renderPage('/pots?pot=gone&monthly=3000');
      expect(screen.queryByText(/History:/)).not.toBeInTheDocument();
    });
  });
});

describe('Accessibility', () => {
  it('has one h1 and no skipped heading levels', () => {
    renderPage();
    expectSoundHeadings(document.body);
  });

  it('has no unlabelled controls, empty buttons or empty headings', async () => {
    renderPage();
    await expectNoViolations(document.body);
  });
});
