import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BudgetVsActualList } from '../BudgetVsActualList';
import type { Category, CategorySpendTrend, CategoryTarget } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'a', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' },
  { categoryId: 'pot-a', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: 'tag', isDefault: true, createdAt: '' },
];

function target(categoryId: string, targetAmount: number): CategoryTarget {
  return { categoryId, targetAmount, period: 'MONTHLY', updatedAt: '' };
}

function trend(categoryId: string, months: number[], total = months.reduce((s, n) => s + n, 0)): CategorySpendTrend {
  return {
    categoryId,
    months: months.map((spent, i) => ({ yearMonth: `2026-0${i + 1}`, spent })),
    total,
    average: Math.round(total / months.length),
  };
}

function renderList(props: Partial<Parameters<typeof BudgetVsActualList>[0]> = {}) {
  return render(
    <MantineProvider>
      <BudgetVsActualList
        categories={categories}
        targets={[target('a', 10000)]}
        trends={[trend('a', [8000, 12000])]}
        yearMonth="2026-09"
        months={2}
        {...props}
      />
    </MantineProvider>,
  );
}

describe('BudgetVsActualList', () => {
  it('shows this month\'s spend against the target', () => {
    renderList();
    expect(screen.getByText('⚠ Groceries')).toBeInTheDocument();
    expect(screen.getByText('£120.00 / £100.00 · 120%')).toBeInTheDocument();
  });

  it('shows the window average as a caption', () => {
    renderList();
    expect(screen.getByText('Avg over 2 months: £100.00')).toBeInTheDocument();
  });

  it('flags when over target', () => {
    renderList();
    expect(screen.getByText('⚠ Groceries')).toBeInTheDocument();
  });

  it('ignores a target on a non-EXPENSE category', () => {
    renderList({ targets: [target('pot-a', 5000)], trends: [] });
    expect(screen.getByText(/Set a target/)).toBeInTheDocument();
  });

  it('treats a category with no trend entry as zero spend', () => {
    renderList({ trends: [] });
    expect(screen.getByText('£0.00 / £100.00 · 0%')).toBeInTheDocument();
  });

  it('shows an empty state with no targets', () => {
    renderList({ targets: [] });
    expect(screen.getByText(/Set a target/)).toBeInTheDocument();
  });
});
