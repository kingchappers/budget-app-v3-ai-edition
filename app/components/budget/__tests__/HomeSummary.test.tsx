import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { HomeSummary } from '../HomeSummary';
import { currentYearMonth } from '~/lib/months';
import type { MonthSummary } from '~/lib/summary';

function summary(overrides: Partial<MonthSummary> = {}): MonthSummary {
  return {
    spending: [{ categoryId: 'g', name: 'Groceries', target: 40000, spent: 10000, period: 'MONTHLY', rawTarget: 40000 }] as MonthSummary['spending'],
    incomeTotal: 260000, recent: [], budgetedTotal: 40000, spentInBudgeted: 10000, spentTotal: 95000, spentUnbudgeted: 85000, leftToSpend: 30000,
    ...overrides,
  };
}

function renderSummary(value: MonthSummary) {
  return render(<MantineProvider><HomeSummary summary={value} yearMonth={currentYearMonth()} /></MantineProvider>);
}

describe('HomeSummary', () => {
  it('calls the figure what is left in your budgets, not what you can spend', () => {
    renderSummary(summary());
    expect(screen.getByText(/^£300\.00 left in your budgets this month/)).toBeInTheDocument();
    expect(screen.queryByText(/left to spend/)).not.toBeInTheDocument();
  });

  it('says what the figure leaves out', () => {
    renderSummary(summary());
    expect(screen.getByText('This counts only categories with a budget. £850.00 of other spending is not included.')).toBeInTheDocument();
  });

  it('still says what it counts when nothing else was spent', () => {
    renderSummary(summary({ spentUnbudgeted: 0, spentTotal: 10000 }));
    expect(screen.getByText('This counts only categories with a budget.')).toBeInTheDocument();
  });
});
