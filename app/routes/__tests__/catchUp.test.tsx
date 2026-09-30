import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';
import type { Category, Transaction } from '~/lib/types';

const state = vi.hoisted(() => ({
  categories: [] as unknown[],
  transactions: [] as unknown[],
  loadError: false,
  createCategory: vi.fn(),
  save: vi.fn(),
  rangeCalls: [] as [string, string][],
}));

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ user: { sub: 'auth0|me' } }) }));
vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/hooks/useSaveWithUndo', () => ({ useSaveWithUndo: () => state.save }));
vi.mock('@mantine/dates', () => ({
  DateInput: ({ label, value, onChange, error }: { label: string; value: string | null; onChange: (v: string | null) => void; error?: string }) => (
    <label>
      {label}
      <input value={value ?? ''} onChange={event => onChange(event.currentTarget.value || null)} />
      {error && <span>{error}</span>}
    </label>
  ),
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: (props: {
    opened: boolean; forDate?: string | null; editing?: Transaction | null; dayMarkedEmpty?: boolean;
    onToggleNothingToLog?: () => void; onSaved?: (t: Transaction) => void; onUndone?: () => void; onClose: () => void;
  }) => {
    if (!props.opened) return null;
    if (props.editing) return <div>Editing {props.editing.description}</div>;
    return (
      <div>
        <div>Adding on {props.forDate}</div>
        <div>{props.dayMarkedEmpty ? 'marked empty' : 'not marked'}</div>
        <button onClick={props.onToggleNothingToLog}>toggle nothing to log</button>
        <button onClick={() => props.onSaved?.(created('new-1', 'Coffee', '2026-09-20T09:00:00.000Z'))}>save one</button>
        <button onClick={() => props.onSaved?.(created('new-2', 'Lunch', '2026-09-20T10:00:00.000Z'))}>save two</button>
        <button onClick={props.onUndone}>undo last</button>
      </div>
    );
  },
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: state.loadError ? new Error('boom') : null, refetch: vi.fn() }),
  useCreateCategory: () => ({ mutateAsync: state.createCategory }),
  useTransactionsRange: (from: string, to: string) => {
    state.rangeCalls.push([from, to]);
    return { data: state.transactions, isLoading: false, error: null, refetch: vi.fn() };
  },
}));

import CatchUp from '../catch-up';

function created(transactionId: string, description: string, createdAt: string): Transaction {
  return { transactionId, yearMonth: '2026-09', amount: 350, type: 'EXPENSE', categoryId: 'cat-food', description, date: '2026-09-20', createdAt };
}

function entry(date: string): Transaction {
  return { transactionId: `t-${date}-${Math.random()}`, yearMonth: date.slice(0, 7), amount: 100, type: 'EXPENSE', categoryId: 'cat-food', description: '', date, createdAt: '' };
}

const food: Category = { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '', group: 'EVERYDAY' };
const untracked: Category = { categoryId: 'cat-untracked', name: 'Untracked', type: 'EXPENSE', icon: 'x', isDefault: false, createdAt: '', group: 'EVERYDAY' };

function renderPage() {
  return render(<MantineProvider><CatchUp /></MantineProvider>);
}

// 28 September 2026 is a Monday.
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 28, 12));
  state.categories = [food];
  state.transactions = [];
  state.loadError = false;
  state.rangeCalls = [];
  state.createCategory.mockReset();
  state.createCategory.mockResolvedValue(untracked);
  state.save.mockReset();
  state.save.mockImplementation(async () => created('lump', 'Untracked spending', '2026-09-28T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function tile(name: RegExp | string): HTMLElement {
  return screen.getByRole('button', { name });
}

async function fillLumpSum(user: ReturnType<typeof userEvent.setup>, amount: string, from: string, to: string): Promise<void> {
  await user.type(screen.getByLabelText('Amount'), amount);
  if (from) await user.type(screen.getByLabelText('From'), from);
  if (to) await user.type(screen.getByLabelText('To'), to);
  await user.click(screen.getByRole('button', { name: 'Add lump sum' }));
}

describe('Catch up day strip', () => {
  it('shows the last 31 days, today first, each with a readable label', () => {
    renderPage();
    const strip = screen.getByRole('group', { name: 'Last 31 days' });
    const tiles = within(strip).getAllByRole('button');
    expect(tiles).toHaveLength(31);
    expect(tiles[0]).toHaveAccessibleName('Today, no entries');
    expect(tiles[1]).toHaveAccessibleName('Yesterday, no entries');
    expect(tiles[2]).toHaveAccessibleName('Sat 26 Sep, no entries');
    expect(tiles[30]).toHaveAccessibleName('Sat 29 Aug, no entries');
  });

  it('marks the days that have entries and counts them', () => {
    state.transactions = [entry('2026-09-25'), entry('2026-09-25'), entry('2026-09-27')];
    renderPage();
    expect(tile('Fri 25 Sep, 2 entries')).toBeInTheDocument();
    expect(tile('Yesterday, 1 entry')).toBeInTheDocument();
    expect(tile('Today, no entries')).toBeInTheDocument();
  });

  it('ignores entries older than the strip', () => {
    state.transactions = [entry('2026-07-01')];
    renderPage();
    expect(screen.getByText('0 of 31 days covered')).toBeInTheDocument();
  });

  it('counts days with entries as covered, as progress rather than a backlog', () => {
    state.transactions = [entry('2026-09-25'), entry('2026-09-27')];
    renderPage();
    expect(screen.getByText('2 of 31 days covered')).toBeInTheDocument();
  });

  it('loads enough months to cover 31 days, even across a month start', () => {
    vi.setSystemTime(new Date(2026, 2, 1, 12));
    renderPage();
    expect(state.rangeCalls.at(-1)).toEqual(['2026-01', '2026-03']);
  });

  it('opens the Add sheet on the tapped day', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(tile('Fri 25 Sep, no entries'));
    expect(screen.getByText('Adding on 2026-09-25')).toBeInTheDocument();
  });

  it('says it is a fresh start on the 1st of the month', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 12));
    renderPage();
    expect(screen.getByText(/a fresh start/i)).toBeInTheDocument();
  });

  it('does not say that on other days', () => {
    renderPage();
    expect(screen.queryByText(/a fresh start/i)).not.toBeInTheDocument();
  });

  it('shows a calm error with a retry when entries cannot be loaded', () => {
    state.loadError = true;
    renderPage();
    expect(screen.getByText('Nothing has been lost.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Nothing to log', () => {
  it('ticks the day and counts it as covered', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(tile('Fri 25 Sep, no entries'));
    expect(screen.getByText('not marked')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'toggle nothing to log' }));

    expect(tile('Fri 25 Sep, nothing to log')).toBeInTheDocument();
    expect(screen.getByText('1 of 31 days covered')).toBeInTheDocument();
    expect(screen.getByText('marked empty')).toBeInTheDocument();
  });

  it('is remembered for this user, and survives a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await user.click(tile('Fri 25 Sep, no entries'));
    await user.click(screen.getByRole('button', { name: 'toggle nothing to log' }));

    expect(readPreferences(window.localStorage).nothingToLog).toEqual({ 'auth0|me': ['2026-09-25'] });
    unmount();

    renderPage();
    expect(tile('Fri 25 Sep, nothing to log')).toBeInTheDocument();
  });

  it('can be cleared again', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ nothingToLog: { 'auth0|me': ['2026-09-25'] } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(tile('Fri 25 Sep, nothing to log'));
    await user.click(screen.getByRole('button', { name: 'toggle nothing to log' }));

    expect(tile('Fri 25 Sep, no entries')).toBeInTheDocument();
    expect(readPreferences(window.localStorage).nothingToLog['auth0|me']).toEqual([]);
  });

  it('is kept separately for each user', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ nothingToLog: { 'auth0|someone-else': ['2026-09-25'] } }));
    renderPage();
    expect(tile('Fri 25 Sep, no entries')).toBeInTheDocument();
  });

  it('shows a day with entries as having entries, even if it was also marked', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ nothingToLog: { 'auth0|me': ['2026-09-25'] } }));
    state.transactions = [entry('2026-09-25')];
    renderPage();
    expect(tile('Fri 25 Sep, 1 entry')).toBeInTheDocument();
    expect(screen.getByText('1 of 31 days covered')).toBeInTheDocument();
  });
});

describe('Add a lump sum as Untracked', () => {
  it('creates the Untracked category once, in the Everyday group, then the entry on the last day', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillLumpSum(user, '120', '2026-09-10', '2026-09-14');

    expect(state.createCategory).toHaveBeenCalledTimes(1);
    expect(state.createCategory).toHaveBeenCalledWith({ name: 'Untracked', type: 'EXPENSE', icon: 'tag', group: 'EVERYDAY' });
    expect(state.save).toHaveBeenCalledWith(
      { amount: 12000, type: 'EXPENSE', categoryId: 'cat-untracked', description: 'Untracked spending 10 Sep–14 Sep', date: '2026-09-14' },
      { categoryName: 'Untracked' },
    );
  });

  it('uses the category that is already there, whatever its capitalisation, without creating another', async () => {
    state.categories = [food, { ...untracked, name: 'untracked' }];
    const user = userEvent.setup();
    renderPage();

    await fillLumpSum(user, '50', '2026-09-10', '2026-09-10');

    expect(state.createCategory).not.toHaveBeenCalled();
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 'cat-untracked', description: 'Untracked spending 10 Sep' }),
      expect.anything(),
    );
  });

  it('marks every day in the range as covered once it has saved', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillLumpSum(user, '120', '2026-09-10', '2026-09-14');

    expect(screen.getByText('5 of 31 days covered')).toBeInTheDocument();
    expect(tile('Sat 12 Sep, nothing to log')).toBeInTheDocument();
  });

  it('does not mark the days covered when the save did not go through', async () => {
    state.save.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPage();

    await fillLumpSum(user, '120', '2026-09-10', '2026-09-14');

    expect(screen.getByText('0 of 31 days covered')).toBeInTheDocument();
  });

  it('clears the form after saving', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillLumpSum(user, '120', '2026-09-10', '2026-09-14');
    expect(screen.getByLabelText('Amount')).toHaveValue('');
    expect(screen.getByLabelText('From')).toHaveValue('');
  });

  it.each([
    ['an amount that is not a number', 'abc', '2026-09-10', '2026-09-14', /valid amount/i],
    ['no start day', '50', '', '2026-09-14', /first day/i],
    ['no end day', '50', '2026-09-10', '', /last day/i],
    ['an end in the future', '50', '2026-09-10', '2026-09-29', /future/i],
    ['a start after the end', '50', '2026-09-15', '2026-09-14', /on or before/i],
  ])('says what to fix for %s, and saves nothing', async (_name, amount, from, to, message) => {
    const user = userEvent.setup();
    renderPage();

    await fillLumpSum(user, amount, from, to);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(state.createCategory).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('says so, and keeps what was typed, when it could not be saved', async () => {
    state.createCategory.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderPage();

    await fillLumpSum(user, '120', '2026-09-10', '2026-09-14');

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Check your connection and try again.');
    expect(screen.getByLabelText('Amount')).toHaveValue('120');
  });
});

describe('Just added', () => {
  it('is not shown until something has been added in this visit', () => {
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Just added' })).not.toBeInTheDocument();
  });

  it('lists entries made in this visit, newest first by when they were created', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(tile('Fri 25 Sep, no entries'));
    await user.click(screen.getByRole('button', { name: 'save two' }));
    await user.click(screen.getByRole('button', { name: 'save one' }));

    const heading = screen.getByRole('heading', { name: 'Just added' });
    const rows = within(heading.parentElement as HTMLElement).getAllByRole('button', { name: /^Edit / });
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Edit Lunch', 'Edit Coffee']);
  });

  it('lets an entry be edited', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(tile('Fri 25 Sep, no entries'));
    await user.click(screen.getByRole('button', { name: 'save one' }));

    await user.click(screen.getByRole('button', { name: 'Edit Coffee' }));

    expect(screen.getByText('Editing Coffee')).toBeInTheDocument();
  });

  it('drops the newest entry when it is undone', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(tile('Fri 25 Sep, no entries'));
    await user.click(screen.getByRole('button', { name: 'save one' }));
    await user.click(screen.getByRole('button', { name: 'save two' }));

    await user.click(screen.getByRole('button', { name: 'undo last' }));

    expect(screen.queryByRole('button', { name: 'Edit Lunch' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Coffee' })).toBeInTheDocument();
  });

  it('includes the lump sum', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillLumpSum(user, '120', '2026-09-10', '2026-09-14');
    expect(screen.getByRole('button', { name: 'Edit Untracked spending' })).toBeInTheDocument();
  });
});
