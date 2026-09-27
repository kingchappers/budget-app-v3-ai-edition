import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MonthlyTrendChart } from '../MonthlyTrendChart';
import type { MonthlyTrendRow } from '~/lib/insights';

describe('MonthlyTrendChart', () => {
  it('renders a chart when there are rows', () => {
    const rows: MonthlyTrendRow[] = [{ yearMonth: '2026-09', income: 200000, spent: 90000, saved: 5000 }];
    const { container } = render(<MantineProvider><MonthlyTrendChart rows={rows} /></MantineProvider>);
    expect(container.querySelector('.mantine-LineChart-root')).not.toBeNull();
  });

  it('shows a message instead of a chart when every month is empty', () => {
    const rows: MonthlyTrendRow[] = [{ yearMonth: '2026-09', income: 0, spent: 0, saved: 0 }];
    render(<MantineProvider><MonthlyTrendChart rows={rows} /></MantineProvider>);
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });
});
