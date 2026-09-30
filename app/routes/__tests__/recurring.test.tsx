import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, Recurring, Transaction } from '~/lib/types';

const mockDelete = vi.fn();
const mockRefetch = vi.fn();
const mockHandled = vi.fn();
let mockMonthTransactions: Record<string, { data?: Transaction[]; isLoading: boolean }>;
let mockQuery: { data?: Recurring[]; isLoading: boolean; error: Error | null };
let mockCategories: Category[] | undefined;
const mockUndoableDelete = vi.fn();

const categories: Category[] = [
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
  { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'home', isDefault: true, createdAt: '' },
];

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...over,
  };
}

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/recurring/RecurringForm', () => ({
  RecurringForm: ({ opened, editing }: { opened: boolean; editing?: { description: string } | null }) =>
    opened ? <div>{editing ? `Form editing ${editing.description}` : 'Form new'}</div> : null,
}));
vi.mock('~/lib/queries', () => ({
  useRecurring: () => ({ ...mockQuery, refetch: mockRefetch }),
  useCategories: () => ({ data: mockCategories }),
  useDeleteRecurring: () => ({ mutateAsync: mockDelete }),
  useSetRecurringHandled: () => ({ mutate: mockHandled }),
  useTransactions: (month: string) => mockMonthTransactions[month] ?? { data: [], isLoading: false },
}));
vi.mock('~/hooks/useUndoableDelete', () => ({ useUndoableDelete: () => mockUndoableDelete }));

import RecurringPage from '../recurring';

function renderPage() {
  return render(
    <MantineProvider>
      <RecurringPage />
    </MantineProvider>,
  );
}

describe('Recurring page', () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockRefetch.mockReset();
    mockQuery = { data: [], isLoading: false, error: null };
    mockCategories = categories;
    mockUndoableDelete.mockReset();
    mockHandled.mockReset();
    mockMonthTransactions = {};
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 12));
  });

  afterEach(() => { vi.useRealTimers(); });

  describe('a skipped bill', () => {
    it('shows that it was skipped this month, with Undo that restores the month before', async () => {
      mockQuery.data = [rec({ handledPeriod: '2026-10' })];
      renderPage();

      expect(screen.getByText('Skipped for October')).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Undo skip for Salary' }));

      expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-09' });
    });

    it('shows a skip made early for next month', () => {
      mockQuery.data = [rec({ handledPeriod: '2026-11' })];
      renderPage();
      expect(screen.getByText('Skipped for November')).toBeInTheDocument();
    });

    it('says nothing once the skipped month has ended', () => {
      mockQuery.data = [rec({ handledPeriod: '2026-09' })];
      renderPage();
      expect(screen.queryByText(/Skipped for/)).not.toBeInTheDocument();
    });

    it('says nothing when the bill was logged from the Due list that month', () => {
      mockQuery.data = [rec({ handledPeriod: '2026-10' })];
      mockMonthTransactions['2026-10'] = {
        data: [{
          transactionId: 't1', yearMonth: '2026-10', amount: 240000, type: 'INCOME', categoryId: 'cat-salary',
          description: 'Salary', date: '2026-10-28', createdAt: '', recurringId: 'r1',
        }],
        isLoading: false,
      };
      renderPage();
      expect(screen.queryByText(/Skipped for/)).not.toBeInTheDocument();
    });

    it('waits for the month\'s transactions before saying it was skipped', () => {
      mockQuery.data = [rec({ handledPeriod: '2026-10' })];
      mockMonthTransactions['2026-10'] = { data: undefined, isLoading: true };
      renderPage();
      expect(screen.queryByText(/Skipped for/)).not.toBeInTheDocument();
    });
  });

  it('lists templates by day of month with their schedule and signed amount', () => {
    mockQuery.data = [
      rec({ recurringId: 'a', description: 'Salary', dayOfMonth: 28, leadDays: 3 }),
      rec({ recurringId: 'b', description: 'Rent', type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, dayOfMonth: 1, leadDays: 1 }),
    ];
    renderPage();

    const schedules = screen.getAllByText(/Monthly on the/).map(node => node.textContent);
    expect(schedules).toEqual([
      'Monthly on the 1st · remind 1 day before',
      'Monthly on the 28th · remind 3 days before',
    ]);
    expect(screen.getByText('−£950.00')).toBeInTheDocument();
    expect(screen.getByText('+£2,400.00')).toBeInTheDocument();
  });

  it('says so when there is no early reminder', () => {
    mockQuery.data = [rec({ leadDays: 0 })];
    renderPage();
    expect(screen.getByText('Monthly on the 28th · no early reminder')).toBeInTheDocument();
  });

  it('flags a template whose category was deleted', () => {
    mockQuery.data = [rec({ categoryId: 'cat-gone', description: 'Old gym' })];
    renderPage();
    expect(screen.getByText('Old gym')).toBeInTheDocument();
    expect(screen.getByText('Category deleted')).toBeInTheDocument();
  });

  it('does not flag a missing category while categories are still loading', () => {
    mockCategories = undefined;
    mockQuery.data = [rec({ categoryId: 'cat-gone', description: 'Old gym' })];
    renderPage();
    expect(screen.getByText('Old gym')).toBeInTheDocument();
    expect(screen.queryByText('Category deleted')).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderPage();
    expect(screen.getByText(/no recurring items yet/i)).toBeInTheDocument();
  });

  it('opens the form for a new item', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /new/i }));
    expect(screen.getByText('Form new')).toBeInTheDocument();
  });

  it('opens the form to edit an item from its menu', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({})];
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(screen.getByText('Form editing Salary')).toBeInTheDocument();
  });

  async function chooseDelete(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
    await user.click(screen.getByRole('button', { name: `Actions for ${label}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  }

  it('deletes straight away with an undoable delete, without asking first', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    await chooseDelete(user, 'Salary');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockUndoableDelete).toHaveBeenCalledWith(expect.objectContaining({
      label: '£2,400.00 · Salary',
      name: 'Salary',
      ref: { entityType: 'RECURRING', id: 'r9' },
    }));
    await mockUndoableDelete.mock.calls[0][0].run();
    expect(mockDelete).toHaveBeenCalledWith('r9');
  });

  it('names the item after its category when there is no description', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9', description: '', categoryId: 'cat-housing', amount: 95000 })];
    renderPage();

    await chooseDelete(user, 'Housing');

    expect(mockUndoableDelete).toHaveBeenCalledWith(expect.objectContaining({ label: '£950.00 · Housing', name: 'Housing' }));
  });

  it('offers a retry when loading fails', async () => {
    mockQuery = { data: undefined, isLoading: false, error: new Error('boom') };
    renderPage();
    await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  describe('schedule wording', () => {
    it('describes a yearly bill in words', () => {
      mockQuery = { data: [rec({ type: 'EXPENSE', categoryId: 'cat-housing', description: 'Car insurance', frequency: 'YEARLY', anchorDate: '2027-03-14', dayOfMonth: 14, leadDays: 30 })], isLoading: false, error: null };
      renderPage();
      expect(screen.getByText('Every year on 14 March · remind 30 days before')).toBeInTheDocument();
    });

    it('still describes an older item with no frequency as monthly', () => {
      mockQuery = { data: [rec({})], isLoading: false, error: null };
      renderPage();
      expect(screen.getByText('Monthly on the 28th · remind 3 days before')).toBeInTheDocument();
    });
  });
});
