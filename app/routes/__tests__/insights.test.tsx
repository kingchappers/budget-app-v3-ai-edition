import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const state = vi.hoisted(() => ({
  categories: [] as unknown[],
  targets: [] as unknown[],
  insights: undefined as unknown,
  insightsError: false,
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: state.targets, isLoading: false, error: null, refetch: vi.fn() }),
  useInsights: () => ({
    data: state.insightsError ? undefined : state.insights,
    isLoading: false,
    error: state.insightsError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
}));

import Insights from '../insights';
import type { Category, CategoryTarget, Insights as InsightsData } from '~/lib/types';

function cat(categoryId: string, name: string): Category {
  return { categoryId, name, type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' };
}

function renderPage() {
  return render(<MantineProvider><Insights /></MantineProvider>);
}

beforeEach(() => {
  state.insightsError = false;
  state.categories = [cat('cat-groceries', 'Groceries')];
  state.targets = [{ categoryId: 'cat-groceries', targetAmount: 10000, period: 'MONTHLY', updatedAt: '' } satisfies CategoryTarget];
  state.insights = {
    months: ['2026-08', '2026-09'],
    categories: [{ categoryId: 'cat-groceries', months: [{ yearMonth: '2026-08', spent: 5000 }, { yearMonth: '2026-09', spent: 8000 }], total: 13000, average: 6500 }],
    topNotes: [{ note: 'Tesco', count: 2, total: 6000 }],
  } satisfies InsightsData;
});

describe('Insights page', () => {
  it('renders all three sections', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Category trends' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Budget vs actual' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top merchants and notes' })).toBeInTheDocument();
    expect(screen.getByText('Tesco')).toBeInTheDocument();
  });

  it('shows an error with a retry when insights fail to load', () => {
    state.insightsError = true;
    renderPage();
    expect(screen.getByText('Could not load insights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
