import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ChartData } from '../ChartData';

function renderChart() {
  return render(
    <MantineProvider>
      <ChartData summary="Spending peaked in March." caption="Spending by month" columns={['Month', 'Spent']} rows={[['March', '£10.00'], ['April', '£5.00']]}>
        <div>the chart</div>
      </ChartData>
    </MantineProvider>,
  );
}

describe('ChartData', () => {
  it('shows the chart and a one-line summary, with the table hidden', () => {
    renderChart();
    expect(screen.getByText('the chart')).toBeInTheDocument();
    expect(screen.getByText('Spending peaked in March.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('toggles a real table with headers, a caption and row headers', async () => {
    const user = userEvent.setup();
    renderChart();
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(screen.getByRole('table', { name: 'Spending by month' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Spent' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'April' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide table' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide table' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('can be used from the keyboard', async () => {
    const user = userEvent.setup();
    renderChart();
    screen.getByRole('button', { name: 'Show as table' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
