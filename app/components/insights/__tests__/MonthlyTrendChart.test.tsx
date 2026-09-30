import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MonthlyTrendChart } from '../MonthlyTrendChart';
import type { MonthlyTrendRow } from '~/lib/insights';

const rows: MonthlyTrendRow[] = [
  { yearMonth: '2026-08', income: 200000, spent: 90000, saved: 5000 },
  { yearMonth: '2026-09', income: 210000, spent: 120000, saved: -2000 },
];

function renderChart(props: Partial<Parameters<typeof MonthlyTrendChart>[0]> = {}) {
  return render(<MantineProvider><MonthlyTrendChart rows={rows} {...props} /></MantineProvider>);
}

describe('MonthlyTrendChart', () => {
  it('renders a chart when there are rows', () => {
    const { container } = renderChart();
    expect(container.querySelector('.mantine-LineChart-root')).not.toBeNull();
  });

  it('shows a message instead of a chart when every month is empty', () => {
    render(<MantineProvider><MonthlyTrendChart rows={[{ yearMonth: '2026-09', income: 0, spent: 0, saved: 0 }]} /></MantineProvider>);
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });

  it('summarises the chart in words and says how the lines differ without colour', () => {
    renderChart();
    expect(screen.getByText(/Spending was highest in September 2026 at £1,200\.00\./)).toBeInTheDocument();
    expect(screen.getByText(/Income is the solid line, spent is dashed and saved is dotted\./)).toBeInTheDocument();
  });

  it('draws spent dashed and saved dotted, so series differ by more than hue', () => {
    const { container } = renderChart();
    const dashes = [...container.querySelectorAll('path.recharts-line-curve')].map(path => path.getAttribute('stroke-dasharray'));
    expect(dashes).toEqual([null, '6 4', '2 4']);
  });

  it('offers the figures as a real table, with negative saving shown with a minus', async () => {
    renderChart();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show as table' }));

    const table = screen.getByRole('table', { name: 'Income, spent and saved by month' });
    const september = within(table).getByRole('rowheader', { name: 'September 2026' }).closest('tr') as HTMLElement;
    expect(within(september).getByText('£1,200.00')).toBeInTheDocument();
    expect(within(september).getByText('−£20.00')).toBeInTheDocument();
  });

  it('adds a tracking column to the table only when a month was partly tracked or marked', async () => {
    const user = userEvent.setup();
    const { unmount } = renderChart();
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.queryByRole('columnheader', { name: 'Tracking' })).not.toBeInTheDocument();
    unmount();

    renderChart({ statuses: { '2026-08': 'partly', '2026-09': 'tracked' } });
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByRole('columnheader', { name: 'Tracking' })).toBeInTheDocument();
    expect(screen.getByText('Partly tracked')).toBeInTheDocument();
  });
});
