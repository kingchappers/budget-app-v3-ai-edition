import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MonthHeader } from '../MonthHeader';
import { currentYearMonth, formatMonthLabel, shiftMonth } from '~/lib/months';

function renderHeader(yearMonth: string) {
  const onChange = vi.fn();
  render(<MantineProvider><MonthHeader yearMonth={yearMonth} onChange={onChange} pageTitle="Budget" /></MantineProvider>);
  return { onChange, user: userEvent.setup() };
}

describe('MonthHeader', () => {
  it('names the month and steps to the previous and next', async () => {
    const month = currentYearMonth();
    const { onChange, user } = renderHeader(month);
    expect(screen.getByRole('heading', { name: formatMonthLabel(month) })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(onChange).toHaveBeenNthCalledWith(1, shiftMonth(month, -1));
    expect(onChange).toHaveBeenNthCalledWith(2, shiftMonth(month, 1));
  });

  it('has no way-back button while viewing the current month', () => {
    renderHeader(currentYearMonth());
    expect(screen.queryByRole('button', { name: 'Back to this month' })).not.toBeInTheDocument();
  });

  it('offers a clear way back to this month from any other month', async () => {
    const { onChange, user } = renderHeader(shiftMonth(currentYearMonth(), -3));
    await user.click(screen.getByRole('button', { name: 'Back to this month' }));
    expect(onChange).toHaveBeenCalledWith(currentYearMonth());
  });

  it('offers it for a future month too', () => {
    renderHeader(shiftMonth(currentYearMonth(), 2));
    expect(screen.getByRole('button', { name: 'Back to this month' })).toBeInTheDocument();
  });
});
