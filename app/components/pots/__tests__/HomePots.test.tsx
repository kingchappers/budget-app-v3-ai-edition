import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { HomePots } from '../HomePots';
import type { Category, PotSummary } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'a', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '' },
  { categoryId: 'b', name: 'Gifts', type: 'POT', group: 'SINKING_FUNDS', icon: '🎁', isDefault: true, createdAt: '' },
  { categoryId: 'c', name: 'Insurance', type: 'POT', group: 'SINKING_FUNDS', icon: '📄', isDefault: true, createdAt: '' },
];

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function renderPots(pots: PotSummary[]) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <HomePots pots={pots} categories={categories} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('HomePots', () => {
  it('lists pots that have a balance, a goal or a monthly amount', () => {
    renderPots([
      pot('a', { balance: 25000 }),
      pot('b', { goalAmount: 10000 }),
      pot('c'),
    ]);
    expect(screen.getByText('✈️ Holidays')).toBeInTheDocument();
    expect(screen.getByText('🎁 Gifts')).toBeInTheDocument();
    expect(screen.queryByText('📄 Insurance')).not.toBeInTheDocument();
  });

  it('shows the balance and goal progress', () => {
    renderPots([pot('a', { balance: 80000, goalAmount: 300000 })]);
    expect(screen.getByText('£800.00')).toBeInTheDocument();
    expect(screen.getByText('£800.00 of £3,000.00')).toBeInTheDocument();
  });

  it('shows a negative balance with a minus sign', () => {
    renderPots([pot('a', { balance: -2500 })]);
    expect(screen.getByText('−£25.00')).toBeInTheDocument();
  });

  it('links to the Pots page', () => {
    renderPots([pot('a', { balance: 100 })]);
    expect(screen.getByRole('link', { name: 'See all pots' })).toHaveAttribute('href', '/pots');
  });

  it('renders nothing when no pot qualifies', () => {
    renderPots([pot('c')]);
    expect(screen.queryByText('Pots')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See all pots' })).not.toBeInTheDocument();
  });
});
