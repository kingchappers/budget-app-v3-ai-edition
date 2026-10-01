import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { TrackingStatus } from '~/lib/insights';
import { TrackingList, type TrackedMonth } from '../TrackingList';

function month(yearMonth: string, status: TrackingStatus, daysWithEntries: number, daysCounted = 30): TrackedMonth {
  return { coverage: { yearMonth, daysWithEntries, daysCounted, share: daysWithEntries / daysCounted }, status };
}

function renderList(months: TrackedMonth[]) {
  const onMark = vi.fn();
  const onInclude = vi.fn();
  render(<MantineProvider><TrackingList months={months} onMark={onMark} onInclude={onInclude} /></MantineProvider>);
  return { onMark, onInclude };
}

describe('TrackingList', () => {
  it('says how much of each month was logged, in words', () => {
    renderList([month('2026-07', 'tracked', 18), month('2026-08', 'partly', 3), month('2026-06', 'marked', 10)]);
    expect(screen.getByText('Tracked (entries on 18 of 30 days)')).toBeInTheDocument();
    expect(screen.getByText('Partly tracked (entries on 3 of 30 days)')).toBeInTheDocument();
    expect(screen.getByText('Marked as not tracked (entries on 10 of 30 days)')).toBeInTheDocument();
  });

  it('lets a month be marked as not tracked', async () => {
    const { onMark } = renderList([month('2026-07', 'tracked', 18)]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mark July 2026 as not tracked' }));
    expect(onMark).toHaveBeenCalledWith('2026-07');
  });

  it('lets a marked month be included again', async () => {
    const { onInclude } = renderList([month('2026-06', 'marked', 10)]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Include June 2026 again' }));
    expect(onInclude).toHaveBeenCalledWith('2026-06');
  });

  it('explains the rule being applied', () => {
    renderList([month('2026-07', 'tracked', 18)]);
    expect(screen.getByText(/fewer than a quarter of their days are left out/i)).toBeInTheDocument();
  });

  it('uses the singular for a single day so far', () => {
    renderList([month('2026-09', 'tracked', 1, 1)]);
    expect(screen.getByText('Tracked (entries on 1 of 1 day)')).toBeInTheDocument();
  });
});
