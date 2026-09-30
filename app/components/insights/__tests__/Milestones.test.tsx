import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Milestones } from '../Milestones';

function renderMilestones(props: Parameters<typeof Milestones>[0]) {
  return render(<MantineProvider><Milestones {...props} /></MantineProvider>);
}

describe('Milestones', () => {
  it('acknowledges outcomes in plain text', () => {
    renderMilestones({
      pots: [{ categoryId: 'holidays', name: 'Holiday pot' }],
      months: [{ yearMonth: '2026-09', targeted: 100000, spent: 94000 }],
    });
    expect(screen.getByText('Holiday pot: goal reached.')).toBeInTheDocument();
    expect(screen.getByText('September finished £60.00 under target.')).toBeInTheDocument();
  });

  it('says a month finished on target when it did exactly', () => {
    renderMilestones({ pots: [], months: [{ yearMonth: '2026-09', targeted: 100000, spent: 100000 }] });
    expect(screen.getByText('September finished on target.')).toBeInTheDocument();
  });

  it('says nothing about a month that finished over target', () => {
    renderMilestones({ pots: [], months: [{ yearMonth: '2026-09', targeted: 100000, spent: 120000 }] });
    expect(screen.queryByText(/september/i)).not.toBeInTheDocument();
    expect(screen.getByText('Nothing to note for this period.')).toBeInTheDocument();
  });

  it('never counts consistency: no streaks, runs or "in a row"', () => {
    renderMilestones({
      pots: [{ categoryId: 'holidays', name: 'Holiday pot' }],
      months: [
        { yearMonth: '2026-07', targeted: 100, spent: 50 },
        { yearMonth: '2026-08', targeted: 100, spent: 60 },
        { yearMonth: '2026-09', targeted: 100, spent: 70 },
      ],
    });
    const text = screen.getByRole('list', { name: 'Milestones' }).textContent ?? '';
    expect(text).not.toMatch(/streak|in a row|consecutive|keep it up|days/i);
  });
});
