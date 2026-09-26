import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { Category } from '~/lib/types';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const categories: Category[] = [
  { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: '🛒', isDefault: true, createdAt: '' },
  { categoryId: 'm', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: '🏠', isDefault: true, createdAt: '' },
  { categoryId: 'w', name: 'Emergency fund', type: 'POT', group: 'SAVING_INVESTMENT', icon: '😌', isDefault: true, createdAt: '' },
  { categoryId: 's', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
];

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useSetTarget: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTarget: () => ({ mutate: vi.fn() }),
}));

import Targets from '../targets';

describe('Targets page', () => {
  it('has one section per group in order and no Income section', () => {
    render(<MantineProvider><Targets /></MantineProvider>);
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(screen.queryByText('😌 Emergency fund')).not.toBeInTheDocument();
    expect(headings).toEqual(['Bills', 'Everyday Spending']);
  });

  it('shows the emoji before the category name', () => {
    render(<MantineProvider><Targets /></MantineProvider>);
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
  });
});
