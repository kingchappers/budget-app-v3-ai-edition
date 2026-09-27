import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SummaryRow } from '../SummaryRow';
import type { SummaryTotals } from '~/lib/insights';

function totals(overrides: Partial<SummaryTotals> = {}): SummaryTotals {
  return { income: 0, spent: 0, saved: 0, net: 0, ...overrides };
}

function renderRow(current: SummaryTotals, previous: SummaryTotals) {
  return render(<MantineProvider><SummaryRow current={current} previous={previous} /></MantineProvider>);
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
    expect(screen.getByText('+£10.00 (+10%)')).toBeInTheDocument();
  });

  it('shows no change indicator when the previous period was zero', () => {
    renderRow(totals({ spent: 5000 }), totals({ spent: 0 }));
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('flags a spending increase as bad, since spending up is flagged', () => {
    renderRow(totals({ spent: 11000 }), totals({ spent: 10000 }));
    expect(screen.getByText('+£10.00 (+10%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'bad');
  });

  it('flags an income increase as good', () => {
    renderRow(totals({ income: 11000 }), totals({ income: 10000 }));
    expect(screen.getByText('+£10.00 (+10%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
  });

  it('flags a spending decrease as good', () => {
    renderRow(totals({ spent: 9000 }), totals({ spent: 10000 }));
    expect(screen.getByText('−£10.00 (−10%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
  });

  it('flags net going up as good even when the previous period was negative', () => {
    renderRow(totals({ net: 5000 }), totals({ net: -10000 }));
    expect(screen.getByText('+£150.00 (+150%)').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
  });
});
