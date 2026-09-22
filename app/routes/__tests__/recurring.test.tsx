import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, Recurring } from '~/lib/types';

const mockDelete = vi.fn();
const mockRefetch = vi.fn();
let mockQuery: { data?: Recurring[]; isLoading: boolean; error: Error | null };
let mockCategories: Category[] | undefined;
let mockDeleteError: Error | null;

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
  useDeleteRecurring: () => ({ mutate: mockDelete, error: mockDeleteError }),
}));

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
    mockDeleteError = null;
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

  it('deletes an item from its menu', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('r9');
  });

  it('shows why a delete failed', () => {
    mockQuery.data = [rec({})];
    mockDeleteError = new Error('nope');
    renderPage();
    expect(screen.getByText('Could not delete the recurring item')).toBeInTheDocument();
    expect(screen.getByText('nope')).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    mockQuery = { data: undefined, isLoading: false, error: new Error('boom') };
    renderPage();
    await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
