import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '~/root';
import { SummaryRow } from '../SummaryRow';
import type { SummaryTotals } from '~/lib/insights';

function totals(overrides: Partial<SummaryTotals> = {}): SummaryTotals {
  return { income: 0, spent: 0, saved: 0, net: 0, ...overrides };
}

function renderRow(current: SummaryTotals, previous: SummaryTotals | null, previousLabel?: string) {
  return render(<MantineProvider theme={theme}><SummaryRow current={current} previous={previous} previousLabel={previousLabel} /></MantineProvider>);
}

describe('SummaryRow', () => {
  it('shows the four current totals', () => {
    renderRow(totals({ income: 250000, spent: 90000, saved: 5000, net: 160000 }), totals());
    expect(screen.getByText('£2,500.00')).toBeInTheDocument();
    expect(screen.getByText('£900.00')).toBeInTheDocument();
    expect(screen.getByText('£50.00')).toBeInTheDocument();
    expect(screen.getByText('£1,600.00')).toBeInTheDocument();
  });

  it('shows the pence and percentage change against the previous period', () => {
    renderRow(totals({ spent: 11000 }), totals({ spent: 10000 }));
    expect(screen.getByText('£10.00 more (10%)')).toBeInTheDocument();
  });

  it('shows no change indicator when the previous period was zero', () => {
    renderRow(totals({ spent: 5000 }), totals({ spent: 0 }));
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('flags a spending increase as bad, since spending up is flagged', () => {
    renderRow(totals({ spent: 11000 }), totals({ spent: 10000 }));
    expect(screen.getByText('£10.00 more (10%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'bad');
  });

  it('flags an income increase as good', () => {
    renderRow(totals({ income: 11000 }), totals({ income: 10000 }));
    expect(screen.getByText('£10.00 more (10%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
  });

  it('flags a spending decrease as good', () => {
    renderRow(totals({ spent: 9000 }), totals({ spent: 10000 }));
    expect(screen.getByText('£10.00 less (10%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
  });

  it('flags net going up as good even when the previous period was negative', () => {
    renderRow(totals({ net: 5000 }), totals({ net: -10000 }));
    expect(screen.getByText('£150.00 more (150%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
  });

  it('says more or less in words, so colour is never the only signal', () => {
    renderRow(totals({ spent: 11000, income: 9000 }), totals({ spent: 10000, income: 10000 }));
    expect(screen.getByText('£10.00 more (10%)')).toBeInTheDocument();
    expect(screen.getByText('£10.00 less (10%)')).toBeInTheDocument();
  });

  it('uses the calm attention colour for a rise in spending and the positive colour for a rise in income, never danger', () => {
    renderRow(totals({ spent: 11000, income: 11000 }), totals({ spent: 10000, income: 10000 }));
    const [incomeChange, spentChange] = screen.getAllByText('£10.00 more (10%)');
    expect(spentChange).toHaveStyle({ color: 'var(--mantine-color-attention-text)' });
    expect(incomeChange).toHaveStyle({ color: 'var(--mantine-color-success-text)' });
  });

  it('names the period each previous figure belongs to', () => {
    renderRow(totals({ spent: 11000 }), totals({ spent: 10000 }), '1–15 Aug');
    expect(screen.getByText('1–15 Aug £100.00')).toBeInTheDocument();
  });

  it('shows no comparison, and says so, when the period cannot be compared fairly', () => {
    renderRow(totals({ spent: 11000 }), null);
    expect(screen.getByText('£110.00')).toBeInTheDocument();
    expect(screen.getAllByText('Not compared')).toHaveLength(4);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
