import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { GroupBreakdownChart } from '../GroupBreakdownChart';
import type { GroupBreakdownRow } from '~/lib/insights';

const rows: GroupBreakdownRow[] = [
  { group: 'BILLS', label: 'Bills', current: 100000, previous: 90000 },
  { group: 'EVERYDAY', label: 'Everyday Spending', current: 5000, previous: 8000 },
];

function renderChart(data: GroupBreakdownRow[] = rows) {
  const onSelectGroup = vi.fn();
  render(<MantineProvider><GroupBreakdownChart rows={data} onSelectGroup={onSelectGroup} /></MantineProvider>);
  return onSelectGroup;
}

describe('GroupBreakdownChart', () => {
  it('lists every group with its current and previous figures', () => {
    renderChart();
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('£1,000.00')).toBeInTheDocument();
    expect(screen.getByText('£900.00')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
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
