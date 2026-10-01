import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router';
import { addDaysIso, todayIso } from '~/lib/months';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';
import type { Transaction } from '~/lib/types';

const recent = vi.hoisted(() => ({ value: undefined as Transaction[] | undefined }));

vi.mock('~/hooks/useRecentTransactions', () => ({ useRecentTransactions: () => recent.value }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ user: { sub: 'auth0|me' } }) }));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened }: { opened: boolean }) => (opened ? <div>Add sheet open</div> : null),
}));

import { WelcomeBackCard } from '../WelcomeBackCard';

function createdDaysAgo(days: number): Transaction {
  const createdAt = `${addDaysIso(todayIso(), -days)}T10:00:00.000Z`;
  return { transactionId: 't', yearMonth: createdAt.slice(0, 7), amount: 100, type: 'EXPENSE', categoryId: 'c', description: '', date: createdAt.slice(0, 10), createdAt };
}

function renderCard() {
  return render(<MantineProvider><Notifications /><MemoryRouter><WelcomeBackCard /></MemoryRouter></MantineProvider>);
}

// The card stays away on the 1st of a month, so pin "today" to a day that is not.
beforeEach(() => {
  notifications.clean();
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 28, 12));
  recent.value = [createdDaysAgo(10)];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WelcomeBackCard', () => {
  it('invites someone back after a few days away, without a count of what is missing', () => {
    renderCard();
    expect(screen.getByText(/^Welcome back\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catch up' })).toHaveAttribute('href', '/catch-up');
    expect(screen.queryByText(/\d+ (days|entries|missing)/i)).not.toBeInTheDocument();
  });

  it('stays away when the newest entry is recent', () => {
    recent.value = [createdDaysAgo(3)];
    renderCard();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });

  it('stays away for someone with no entries at all', () => {
    recent.value = [];
    renderCard();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });

  it('waits for the entries to load', () => {
    recent.value = undefined;
    renderCard();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });

  it('stays away on the 1st of the month, a fresh start', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 12));
    renderCard();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });

  it('hides for seven days on Not now', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    expect(readPreferences(window.localStorage).welcomeBackHiddenUntil).toBe('2026-10-05');
  });

  it('stays hidden until the day it was hidden to, then comes back', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ welcomeBackHiddenUntil: '2026-09-29' }));
    const { unmount } = renderCard();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    unmount();

    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ welcomeBackHiddenUntil: '2026-09-28' }));
    renderCard();
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  it('lets someone add one thing from today, the smallest way back', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Add something from today' }));

    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
  });

  it('starts fresh from today: the quiet days count as nothing to log, and the card steps back', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Start fresh from today' }));

    const days = readPreferences(window.localStorage).nothingToLog['auth0|me'];
    expect(days[0]).toBe('2026-09-19');
    expect(days.at(-1)).toBe('2026-09-27');
    expect(days).toHaveLength(9);
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    expect(readPreferences(window.localStorage).welcomeBackHiddenUntil).toBe('2026-10-05');
  });

  it('undoes starting fresh', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Start fresh from today' }));

    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(readPreferences(window.localStorage).nothingToLog['auth0|me'] ?? []).toEqual([]);
    expect(readPreferences(window.localStorage).welcomeBackHiddenUntil).toBe('');
    expect(await screen.findByText(/^Welcome back\./)).toBeInTheDocument();
  });
});
