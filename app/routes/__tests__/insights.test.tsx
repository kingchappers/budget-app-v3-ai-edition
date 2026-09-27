import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

const data = vi.hoisted(() => ({
  categories: [] as unknown[],
  targets: [] as unknown[],
  transactions: [] as unknown[],
  pots: [] as unknown[],
  rangeCalls: [] as [string, string][],
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: data.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: data.targets, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: () => ({ data: data.pots, isLoading: false, error: null, refetch: vi.fn() }),
  useTransactionsRange: (from: string, to: string) => {
    data.rangeCalls.push([from, to]);
    return { data: data.transactions, isLoading: false, error: null, refetch: vi.fn() };
  },
}));

import Insights from '../insights';

function renderPage() {
  return render(<MantineProvider><Insights /></MantineProvider>);
}

beforeEach(() => {
  data.categories = [];
  data.targets = [];
  data.transactions = [];
  data.pots = [];
  data.rangeCalls = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-15T12:00:00'));
});

describe('Insights page', () => {
  it('defaults to a 6-month span ending at the current month', () => {
    renderPage();
    expect(data.rangeCalls.at(-1)).toEqual(['2025-10', '2026-09']);
  });

  it('narrows to the current month when "This month" is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-08', '2026-09']);
  });

  it('pages back by a whole span and keeps the span length when returning', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-04', '2026-03']);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-10', '2026-09']);
  });

  it('disables paging forward past the current month', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('keeps the anchor month when the span changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-02', '2026-03']);
  });
});
