import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { GroupBreakdownChart } from '../GroupBreakdownChart';
import type { GroupBreakdownRow } from '~/lib/insights';

const rows: GroupBreakdownRow[] = [
  { group: 'BILLS', label: 'Bills', current: 100000, previous: 90000 },
  { group: 'EVERYDAY', label: 'Everyday Spending', current: 5000, previous: 8000 },
];

function renderChart(data: GroupBreakdownRow[] = rows, labels: { currentLabel?: string; previousLabel?: string } = {}) {
  const onSelectGroup = vi.fn();
  render(<MantineProvider><GroupBreakdownChart rows={data} onSelectGroup={onSelectGroup} {...labels} /></MantineProvider>);
  return onSelectGroup;
}

describe('GroupBreakdownChart', () => {
  it('labels every figure with the period it belongs to', () => {
    renderChart(rows, { currentLabel: 'Apr–Sep 2026', previousLabel: 'Oct 2025–Mar 2026' });
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Apr–Sep 2026 £1,000.00 · Oct 2025–Mar 2026 £900.00')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
  });

  it('shows only this period when there is nothing to compare with', () => {
    renderChart(rows, {});
    expect(screen.getByText('This period £1,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/£900\.00/)).not.toBeInTheDocument();
  });

  it('says in one line which group was largest', () => {
    renderChart(rows, { currentLabel: 'Sep', previousLabel: 'Aug' });
    expect(screen.getByText(/Bills was the largest group at £1,000\.00 of £1,050\.00 spent, compared with Aug\./)).toBeInTheDocument();
  });

  it('offers the same numbers as a real table', async () => {
    renderChart(rows, { currentLabel: 'Sep', previousLabel: 'Aug' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Show as table' }));

    const table = screen.getByRole('table', { name: 'Spending by group' });
    expect(within(table).getByRole('columnheader', { name: 'Aug' })).toBeInTheDocument();
    expect(within(within(table).getByRole('rowheader', { name: 'Bills' }).closest('tr') as HTMLElement).getByText('£900.00')).toBeInTheDocument();
  });

  it('calls onSelectGroup when a group row is tapped', async () => {
    const onSelectGroup = renderChart();
    await userEvent.setup().click(screen.getByText('Bills'));
    expect(onSelectGroup).toHaveBeenCalledWith('BILLS');
  });

  it('shows a message instead of a chart when there are no rows', () => {
    renderChart([]);
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });
});
