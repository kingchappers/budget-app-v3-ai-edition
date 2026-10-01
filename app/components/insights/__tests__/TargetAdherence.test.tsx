import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TargetAdherence } from '../TargetAdherence';
import type { TargetAdherenceRow } from '~/lib/insights';

function row(name: string, monthsOverTarget: number, monthsInSpan: number): TargetAdherenceRow {
  return { categoryId: name, name, monthsOverTarget, monthsWithin: monthsInSpan - monthsOverTarget, monthsInSpan };
}

function renderRows(rows: TargetAdherenceRow[]) {
  return render(<MantineProvider><TargetAdherence rows={rows} /></MantineProvider>);
}

describe('TargetAdherence', () => {
  it('leads with what went well, then the areas to look at', () => {
    renderRows([row('Dining', 4, 6), row('Groceries', 1, 6)]);

    const headings = screen.getAllByText(/^(Went well|Went over budget)$/).map(heading => heading.textContent);
    expect(headings).toEqual(['Went well', 'Went over budget']);
    expect(screen.getByText('Groceries: within budget in 5 of 6 months')).toBeInTheDocument();
    expect(screen.getByText('Dining: within budget in 2 of 6 months')).toBeInTheDocument();
  });

  it('lists the most-over category first under areas to look at, in neutral words', () => {
    renderRows([row('Groceries', 1, 6), row('Dining', 4, 6)]);
    const items = screen.getAllByRole('listitem').map(item => item.textContent);
    const toLookAt = items.filter(text => text?.includes('over budget'));
    expect(toLookAt).toEqual(['Dining: over budget in 4 of 6 months', 'Groceries: over budget in 1 of 6 months']);
  });

  it('has no areas to look at when every category stayed within target', () => {
    renderRows([row('Groceries', 0, 3)]);
    expect(screen.getByText('Groceries: within budget in 3 of 3 months')).toBeInTheDocument();
    expect(screen.queryByText('Went over budget')).not.toBeInTheDocument();
  });

  it('does not open with a category that was never within target', () => {
    renderRows([row('Dining', 3, 3)]);
    expect(screen.queryByText('Went well')).not.toBeInTheDocument();
    expect(screen.getByText('Went over budget')).toBeInTheDocument();
  });

  it('says there is nothing to count yet when no month was finished and tracked', () => {
    renderRows([row('Groceries', 0, 0)]);
    expect(screen.getByText(/no finished, tracked months/i)).toBeInTheDocument();
  });

  it('shows a message when no category has a target', () => {
    renderRows([]);
    expect(screen.getByText(/no budgets set/i)).toBeInTheDocument();
  });

  it('uses the singular for one month', () => {
    renderRows([row('Groceries', 0, 1)]);
    expect(screen.getByText('Groceries: within budget in 1 of 1 month')).toBeInTheDocument();
  });
});
