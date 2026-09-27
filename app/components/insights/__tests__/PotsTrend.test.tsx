import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PotsTrend } from '../PotsTrend';
import type { PotSummary } from '~/lib/types';

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

describe('PotsTrend', () => {
  it('shows the total reserved and one chart per pot with history', () => {
    render(<MantineProvider><PotsTrend pots={[
      pot('cat-holidays', { balance: 25000, months: [{ yearMonth: '2026-09', opening: 0, setAside: 25000, autoAdded: 0, takeOut: 0, spent: 0, closing: 25000 }] }),
      pot('cat-empty', { balance: 0, months: [] }),
    ]} /></MantineProvider>);
    expect(screen.getByText('£250.00')).toBeInTheDocument();
    expect(screen.queryAllByRole('img', { hidden: true }).length + document.querySelectorAll('.mantine-LineChart-root').length).toBeGreaterThan(0);
  });

  it('shows a message when there are no pots with any history', () => {
    render(<MantineProvider><PotsTrend pots={[pot('cat-empty')]} /></MantineProvider>);
    expect(screen.getByText(/no pot activity/i)).toBeInTheDocument();
  });
});
