import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CategoryTrendList } from '../CategoryTrendList';
import type { Category, CategorySpendTrend } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'a', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: '🛒', isDefault: true, createdAt: '' },
  { categoryId: 'b', name: 'Transport', type: 'EXPENSE', group: 'EVERYDAY', icon: '🚗', isDefault: true, createdAt: '' },
];

function trend(categoryId: string, spent: number[], total = spent.reduce((s, n) => s + n, 0)): CategorySpendTrend {
  return {
    categoryId,
    months: spent.map((amount, i) => ({ yearMonth: `2026-0${i + 1}`, spent: amount })),
    total,
    average: Math.round(total / spent.length),
  };
}

function renderList(trends: CategorySpendTrend[]) {
  return render(
    <MantineProvider>
      <CategoryTrendList trends={trends} categories={categories} />
    </MantineProvider>,
  );
}

describe('CategoryTrendList', () => {
  it('shows categories with spend, each with a total and a sparkline', () => {
    renderList([trend('a', [1000, 2000])]);
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
    expect(screen.getByText('£30.00')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Groceries spending trend' })).toBeInTheDocument();
  });

  it('excludes categories with no spend in the window', () => {
    renderList([trend('a', [1000]), trend('b', [0, 0])]);
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
    expect(screen.queryByText('🚗 Transport')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing has been spent', () => {
    renderList([trend('a', [0, 0])]);
    expect(screen.getByText(/No spending yet/)).toBeInTheDocument();
  });
});
