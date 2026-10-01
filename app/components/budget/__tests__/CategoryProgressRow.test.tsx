import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { theme } from '~/root';
import { CategoryProgressRow } from '../CategoryProgressRow';
import type { CategoryProgress } from '~/lib/summary';

function progress(over: Partial<CategoryProgress> = {}): CategoryProgress {
  return {
    categoryId: 'g', name: 'Groceries', icon: 'tag', spent: 18240, target: 25000, rawTarget: 25000,
    period: 'MONTHLY', percent: 73, isOver: false, ...over,
  };
}

function renderRow(p: CategoryProgress, pace?: number | null) {
  return render(
    <MantineProvider theme={theme}>
      <MemoryRouter>
        <CategoryProgressRow progress={p} to="/transactions" pace={pace} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('CategoryProgressRow wording', () => {
  it('leads with what is left, and shows spent against target underneath', () => {
    renderRow(progress());
    expect(screen.getByText('£67.60 left')).toBeInTheDocument();
    expect(screen.getByText('£182.40 spent of £250.00')).toBeInTheDocument();
  });

  it('says "£0.00 left" when exactly on target, not over', () => {
    renderRow(progress({ spent: 25000, percent: 100, isOver: false }));
    expect(screen.getByText('£0.00 left')).toBeInTheDocument();
    expect(screen.queryByText(/over/)).not.toBeInTheDocument();
  });

  it('states the amount over instead of a percentage above 100', () => {
    renderRow(progress({ spent: 26200, percent: 105, isOver: true }));
    expect(screen.getByText('£12.00 over')).toBeInTheDocument();
    expect(screen.queryByText(/105|%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

  it('uses the attention colour, never the danger colour, when over', () => {
    renderRow(progress({ spent: 26200, percent: 105, isOver: true }));
    expect(screen.getByText('£12.00 over')).toHaveStyle({ color: 'var(--mantine-color-attention-text)' });
    const row = screen.getByText('Groceries').closest('.mantine-Stack-root') as HTMLElement;
    expect(row.innerHTML).toContain('--mantine-color-attention-filled'); // the bar
    expect(row.innerHTML).not.toMatch(/danger/);
  });

  it('keeps the bar full but not beyond when over', () => {
    renderRow(progress({ spent: 30000, percent: 120, isOver: true }));
    expect(screen.getByRole('progressbar', { name: 'Groceries progress' })).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('CategoryProgressRow pace', () => {
  it('marks how far through the month today is, and says so to screen readers', () => {
    renderRow(progress(), 40);
    expect(screen.getByTestId('pace-marker')).toHaveStyle({ left: '40%' });
    expect(screen.getByText('Today is 40% through the month.')).toBeInTheDocument();
  });

  it('shows no marker for a month that is not the current one', () => {
    renderRow(progress(), null);
    expect(screen.queryByTestId('pace-marker')).not.toBeInTheDocument();
    expect(screen.queryByText(/through the month/)).not.toBeInTheDocument();
  });

  it('does not add a verdict word such as "on track"', () => {
    renderRow(progress(), 40);
    expect(screen.queryByText(/on track|ahead|behind/i)).not.toBeInTheDocument();
  });
});

describe('CategoryProgressRow weekly targets', () => {
  const weekly = progress({
    period: 'WEEKLY', rawTarget: 2000, target: 8667, spent: 15000, percent: 173, isOver: true,
    week: { spent: 1200, target: 2000 },
  });

  it('compares this week\'s spending with the weekly amount', () => {
    renderRow(weekly);
    expect(screen.getByText('£8.00 left this week')).toBeInTheDocument();
    expect(screen.getByText('£12.00 of £20.00 this week · about £86.67 a month')).toBeInTheDocument();
  });

  it('is not judged by the month: heavy spending earlier in the month does not make it "over"', () => {
    renderRow(weekly);
    expect(screen.queryByText(/over/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Groceries progress' })).toHaveAttribute('aria-valuenow', '60');
  });

  it('says how much a week is over', () => {
    renderRow({ ...weekly, week: { spent: 2500, target: 2000 } });
    expect(screen.getByText('£5.00 over this week')).toBeInTheDocument();
  });

  it('has no month pace marker, because its bar measures the week', () => {
    renderRow(weekly, 40);
    expect(screen.queryByTestId('pace-marker')).not.toBeInTheDocument();
  });
});
