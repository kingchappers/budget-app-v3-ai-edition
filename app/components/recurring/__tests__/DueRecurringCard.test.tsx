import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router';
import type { DueItem } from '~/lib/recurring';
import type { Recurring } from '~/lib/types';

const mockSave = vi.fn();
const mockHandled = vi.fn();
const mockRefetch = vi.fn();
let dueState: { items: DueItem[]; isLoading: boolean; error: Error | null; refetch: () => void };

vi.mock('~/hooks/useDueRecurring', () => ({ useDueRecurring: () => dueState }));
vi.mock('~/hooks/useSaveWithUndo', () => ({ useSaveWithUndo: () => mockSave }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
      { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'home', isDefault: true, createdAt: '' },
    ],
  }),
  useSetRecurringHandled: () => ({ mutate: mockHandled }),
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, template, templateDate, onSaved }: {
    opened: boolean;
    template?: { description: string; amount: number } | null;
    templateDate?: string;
    onSaved?: (created: unknown) => void;
  }) => (opened
    ? (
      <div>
        <span>{`Sheet ${template?.description} ${template?.amount} on ${templateDate}`}</span>
        <button onClick={() => onSaved?.({})}>simulate saved</button>
      </div>
    )
    : null),
}));

import { DueRecurringCard } from '../DueRecurringCard';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: '2026-08', createdAt: '', updatedAt: '', ...over,
  };
}

function item(over: Partial<DueItem> = {}, template: Partial<Recurring> = {}): DueItem {
  return {
    recurring: rec(template), period: '2026-09', dueDate: '2026-09-28', status: 'today', daysAway: 0, ...over,
  };
}

function renderCard() {
  return render(
    <MantineProvider>
      <Notifications />
      <MemoryRouter>
        <DueRecurringCard />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('DueRecurringCard', () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockSave.mockResolvedValue(null);
    mockHandled.mockReset();
    mockRefetch.mockReset();
    dueState = { items: [item()], isLoading: false, error: null, refetch: mockRefetch };
  });

  afterEach(() => { notifications.clean(); });

  it('lists each due item with its status, date and signed amount', () => {
    dueState.items = [
      item({ status: 'overdue', daysAway: -2, dueDate: '2026-09-26' }, { recurringId: 'a', description: 'Rent', type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000 }),
      item({ status: 'upcoming', daysAway: 2, dueDate: '2026-09-30' }, { recurringId: 'b' }),
    ];
    renderCard();

    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('2 days overdue · 26 Sep')).toBeInTheDocument();
    expect(screen.getByText('−£950.00')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
    expect(screen.getByText('Due in 2 days · 30 Sep')).toBeInTheDocument();
    expect(screen.getByText('+£2,400.00')).toBeInTheDocument();
  });

  it('renders nothing when nothing is due or while loading', () => {
    dueState = { items: [], isLoading: false, error: null, refetch: mockRefetch };
    const { container, unmount } = renderCard();
    expect(container.querySelector('.mantine-Card-root')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    dueState = { items: [item()], isLoading: true, error: null, refetch: mockRefetch };
    const loading = renderCard();
    expect(loading.container.querySelector('.mantine-Card-root')).toBeNull();
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
  });

  it('shows a compact error with a retry when the templates fail to load', async () => {
    dueState = { items: [], isLoading: false, error: new Error('boom'), refetch: mockRefetch };
    renderCard();
    await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('links to the Recurring page', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/recurring');
  });

  it('Add saves the template on its due date, through the undoable save', async () => {
    renderCard();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add Salary' }));

    expect(mockSave).toHaveBeenCalledWith({
      amount: 240000, type: 'INCOME', categoryId: 'cat-salary', description: 'Salary', date: '2026-09-28',
    });
    expect(mockHandled).not.toHaveBeenCalled();
  });

  it('Skip marks the period handled and its Undo restores the previous marker', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Skip' }));

    expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-09' });
    expect(await screen.findByText('Skipped Salary')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(mockHandled).toHaveBeenLastCalledWith({ recurringId: 'r1', period: '2026-08' });
  });

  it('Skip\'s Undo can restore an empty marker', async () => {
    const user = userEvent.setup();
    dueState.items = [item({}, { handledPeriod: null })];
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(mockHandled).toHaveBeenLastCalledWith({ recurringId: 'r1', period: null });
  });

  it('Edit opens the add sheet prefilled on the due date, and marks it handled once saved', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(screen.getByText('Sheet Salary 240000 on 2026-09-28')).toBeInTheDocument();
    expect(mockHandled).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'simulate saved' }));

    await waitFor(() => expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-09' }));
  });

  it('ignores a second Add while the first is still saving, then allows a retry once it settles', async () => {
    let settle!: (value: null) => void;
    mockSave.mockReturnValueOnce(new Promise<null>(resolve => { settle = resolve; }));
    mockSave.mockResolvedValue(null);
    const user = userEvent.setup();
    renderCard();
    const addButton = screen.getByRole('button', { name: 'Add Salary' });

    await user.dblClick(addButton);
    expect(mockSave).toHaveBeenCalledTimes(1);

    await act(async () => { settle(null); });
    await user.click(addButton);
    expect(mockSave).toHaveBeenCalledTimes(2);
  });
});
