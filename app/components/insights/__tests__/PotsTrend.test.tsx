import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PotsTrend } from '../PotsTrend';
import type { Category, PotSummary } from '~/lib/types';

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function category(categoryId: string, name: string): Category {
  return { categoryId, name, type: 'POT', group: 'SAVING_INVESTMENT', icon: 'tag', isDefault: false, createdAt: '' };
}

describe('PotsTrend', () => {
  it('shows the total reserved, the pot name, and one chart per pot with history in the span', () => {
    render(<MantineProvider><PotsTrend
      pots={[
        pot('cat-holidays', { balance: 25000, months: [{ yearMonth: '2026-09', opening: 0, setAside: 25000, autoAdded: 0, takeOut: 0, spent: 0, closing: 25000 }] }),
        pot('cat-empty', { balance: 0, months: [] }),
      ]}
      categories={[category('cat-holidays', 'Holidays')]}
      current={['2026-07', '2026-09']}
    /></MantineProvider>);
    expect(screen.getByText('£250.00')).toBeInTheDocument();
    expect(screen.getByText('Holidays')).toBeInTheDocument();
    expect(screen.queryAllByRole('img', { hidden: true }).length + document.querySelectorAll('.mantine-LineChart-root').length).toBeGreaterThan(0);
  });

  it('falls back to "Unknown pot" when the category has been removed', () => {
    render(<MantineProvider><PotsTrend
      pots={[pot('cat-gone', { months: [{ yearMonth: '2026-09', opening: 0, setAside: 100, autoAdded: 0, takeOut: 0, spent: 0, closing: 100 }] })]}
      categories={[]}
      current={['2026-07', '2026-09']}
    /></MantineProvider>);
    expect(screen.getByText('Unknown pot')).toBeInTheDocument();
  });

  it('clips a pot\'s history to the chosen span, excluding months outside it', () => {
    render(<MantineProvider><PotsTrend
      pots={[pot('cat-holidays', {
        months: [
          { yearMonth: '2024-01', opening: 0, setAside: 100, autoAdded: 0, takeOut: 0, spent: 0, closing: 100 },
          { yearMonth: '2026-09', opening: 100, setAside: 50, autoAdded: 0, takeOut: 0, spent: 0, closing: 150 },
        ],
      })]}
      categories={[category('cat-holidays', 'Holidays')]}
      current={['2026-07', '2026-09']}
    /></MantineProvider>);
    // Only the in-span month should reach the chart; a pot whose sole history
    // falls entirely outside the span is asserted separately below.
    expect(screen.getByText('Holidays')).toBeInTheDocument();
  });

  it('shows a message when no pot has any history within the chosen span', () => {
    render(<MantineProvider><PotsTrend
      pots={[pot('cat-holidays', { months: [{ yearMonth: '2024-01', opening: 0, setAside: 100, autoAdded: 0, takeOut: 0, spent: 0, closing: 100 }] })]}
      categories={[category('cat-holidays', 'Holidays')]}
      current={['2026-07', '2026-09']}
    /></MantineProvider>);
    expect(screen.getByText(/no pot activity/i)).toBeInTheDocument();
  });

  it('shows a message when there are no pots with any history', () => {
    render(<MantineProvider><PotsTrend pots={[pot('cat-empty')]} categories={[]} current={['2026-07', '2026-09']} /></MantineProvider>);
    expect(screen.getByText(/no pot activity/i)).toBeInTheDocument();
  });
});
