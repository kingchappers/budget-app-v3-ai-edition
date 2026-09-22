import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIso, yesterdayIso } from '~/lib/months';
import type { Transaction } from '~/lib/types';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockUseTransactions = vi.hoisted(() => vi.fn());
let mockTransactions: Transaction[] = [];

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-food', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
    ],
    isLoading: false,
  }),
  useTransactions: mockUseTransactions,
  useCreateTransaction: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteTransaction: () => ({ mutate: mockRemove }),
}));

import { TransactionSheet, type TransactionSheetProps } from '../TransactionSheet';

function renderSheet(props: Partial<TransactionSheetProps> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (extra: Partial<TransactionSheetProps>) => (
    <QueryClientProvider client={client}>
      <MantineProvider>
        <Notifications />
        <TransactionSheet opened onClose={onClose} yearMonth="2026-07" {...props} {...extra} />
      </MantineProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(tree({}));
  return { onClose, setProps: (extra: Partial<TransactionSheetProps>) => rerender(tree(extra)) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function chipNames(): (string | undefined)[] {
  const group = screen.getByRole('radiogroup', { name: 'Category' });
  return within(group).getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0]?.textContent ?? undefined);
}

const editing: Transaction = {
  transactionId: 't1', yearMonth: '2026-07', amount: 480, type: 'EXPENSE', categoryId: 'cat-dining',
  description: 'Lunch', date: '2026-07-03', createdAt: '',
};

function pastTxn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 'p1', yearMonth: '2026-07', amount: 100, type: 'EXPENSE', categoryId: 'cat-dining',
    description: '', date: '2026-07-01', createdAt: '', ...over,
  };
}

describe('TransactionSheet', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ transactionId: 't-real', yearMonth: '2026-07' });
    mockUpdate.mockReset();
    mockRemove.mockReset();
    mockTransactions = [];
    mockUseTransactions.mockReset();
    mockUseTransactions.mockImplementation(() => ({ data: mockTransactions }));
  });

  afterEach(() => { notifications.clean(); });

  it('only enables the ranking query while the sheet is open', () => {
    const { setProps } = renderSheet({ opened: false });
    const currentMonth = mockUseTransactions.mock.calls[0][0];
    expect(mockUseTransactions.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);

    mockUseTransactions.mockClear();
    setProps({ opened: true });
    expect(mockUseTransactions).toHaveBeenCalledWith(currentMonth, true);
  });

  it('shows a validation message for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), 'abc');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects more than two decimal places', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.805');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a category before submitting', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/choose a category/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('submits a valid transaction as integer pence', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 480, type: 'EXPENSE', categoryId: 'cat-dining' }),
    );
  });

  it('lists the most-used categories first', () => {
    mockTransactions = [
      { ...editing, transactionId: 'a', categoryId: 'cat-food' },
      { ...editing, transactionId: 'b', categoryId: 'cat-food' },
      { ...editing, transactionId: 'c', categoryId: 'cat-dining' },
    ];
    renderSheet();
    expect(chipNames()).toEqual(['Groceries', 'Dining']);
  });

  it('only offers categories that match the chosen type', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    expect(chipNames()).toEqual(['Salary']);
  });

  it('defaults the date to today and lets you pick yesterday', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: yesterdayIso() }));
  });

  it('saves with today\'s date when no date is chosen', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: todayIso() }));
  });

  it('hides the note until asked for', async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
  });

  it('shows every field when editing', () => {
    renderSheet({ editing });
    expect(screen.getByLabelText(/note/i)).toHaveValue('Lunch');
    expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Yesterday' })).not.toBeInTheDocument();
  });

  it('prefills from a template, dated today', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing });

    expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    expect(screen.getByLabelText(/note/i)).toHaveValue('Lunch');
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 480, categoryId: 'cat-dining', description: 'Lunch', date: todayIso() }),
    );
  });

  it('keeps the note collapsed for a template with no note', () => {
    renderSheet({ template: { ...editing, description: '' } });
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });

  it('prefers the transaction being edited over a template', () => {
    renderSheet({ editing, template: { ...editing, amount: 999 } });
    expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
  });

  it('closes immediately without waiting for the create to finish', async () => {
    const user = userEvent.setup();
    mockCreate.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores a second Save click while the sheet is closing', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    const save = screen.getByRole('button', { name: /^save$/i });

    fireEvent.click(save);
    fireEvent.click(save);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('accepts the next entry after Save & add another', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /save & add another/i }));

    await user.type(screen.getByLabelText(/amount/i), '2.00');
    await user.click(screen.getByRole('radio', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: /save & add another/i }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('keeps the sheet open on Save & add another, clearing amount, note and category', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.click(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.type(screen.getByLabelText(/amount/i), '10');
    await user.click(screen.getByRole('radio', { name: 'Salary' }));
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'March');

    await user.click(screen.getByRole('button', { name: /save & add another/i }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/amount/i)).toHaveValue('');
    expect(screen.getByLabelText(/amount/i)).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yesterday' })).toBeChecked();
  });

  it('clears the quick add line and its error on Save & add another', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
    expect(screen.getByText("Couldn't find an amount")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));

    await user.click(screen.getByRole('button', { name: /save & add another/i }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Quick add')).toHaveValue('');
    expect(screen.queryByText("Couldn't find an amount")).not.toBeInTheDocument();
  });

  it('runs Save & add another when Enter is pressed while adding', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.type(screen.getByLabelText(/amount/i), '4.80{Enter}');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 480, categoryId: 'cat-dining' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers Undo that deletes the created transaction', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/saved £4\.80 · dining/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
  });

  it('defers Undo until the create has finished', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ transactionId: string; yearMonth: string }>();
    mockCreate.mockReturnValue(pending.promise);
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(mockRemove).not.toHaveBeenCalled();

    pending.resolve({ transactionId: 'late-id', yearMonth: '2026-07' });
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 'late-id', yearMonth: '2026-07' }));
  });

  it('shows a Retry toast when the create fails and re-sends the same input', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new Error('boom'));
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenLastCalledWith(mockCreate.mock.calls[0][0]);
  });

  it('stays silent when the create fails after the user pressed Undo', async () => {
    const user = userEvent.setup();
    const pending = deferred<never>();
    mockCreate.mockReturnValue(pending.promise.then(() => { throw new Error('boom'); }));
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    pending.resolve(undefined as never);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't save/i)).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('awaits the update in edit mode and shows an inline error on failure', async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new Error('boom'));
    const { onClose } = renderSheet({ editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /save & add another/i })).not.toBeInTheDocument();
  });

  it('closes after a successful edit', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({});
    const { onClose } = renderSheet({ editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders as a centred modal on wide screens', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: true })) as typeof window.matchMedia;
    try {
      renderSheet();
      expect(document.querySelector('.mantine-Modal-root')).not.toBeNull();
      expect(document.querySelector('.mantine-Drawer-root')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('renders as a bottom drawer on narrow screens', () => {
    renderSheet();
    expect(document.querySelector('.mantine-Drawer-root')).not.toBeNull();
    expect(document.querySelector('.mantine-Modal-root')).toBeNull();
  });

  it('selects the remembered category when a known note is fully typed', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');

    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    expect(screen.getByText("Suggested from your earlier 'starbucks'")).toBeInTheDocument();
  });

  it('announces the remembered category suggestion as a status message', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');

    expect(screen.getByText("Suggested from your earlier 'starbucks'")).toHaveAttribute('role', 'status');
  });

  it('does not select a category for a partial note', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starb');

    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('never overwrites a category the user picked', async () => {
    const user = userEvent.setup();
    mockTransactions = [
      pastTxn({ transactionId: 'a', description: 'Starbucks', categoryId: 'cat-dining' }),
      pastTxn({ transactionId: 'b', description: 'Tesco', categoryId: 'cat-food' }),
    ];
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
  });

  it('clears a remembered category when the note stops matching', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

    await user.type(screen.getByLabelText(/note/i), 'x');

    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('drops the hint once the user picks a category', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    await user.click(screen.getByRole('radio', { name: 'Groceries' }));

    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });

  it('re-runs the lookup when the type changes', async () => {
    const user = userEvent.setup();
    mockTransactions = [
      pastTxn({ transactionId: 'a', description: 'Refund', categoryId: 'cat-dining' }),
      pastTxn({ transactionId: 'b', description: 'Refund', categoryId: 'cat-salary', type: 'INCOME', date: '2026-07-02' }),
    ];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'refund');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.getByRole('radio', { name: 'Salary' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Spend' }));
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('clears the category on a type change when the note has no match there', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    await user.click(screen.getByRole('radio', { name: 'Income' }));

    expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('never recalls a category while editing', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet({ editing: { ...editing, categoryId: 'cat-food', description: 'Lunch' } });

    const note = screen.getByLabelText(/note/i);
    await user.clear(note);
    await user.type(note, 'starbucks');

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('keeps a duplicated category when the note is changed', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet({ template: { ...editing, categoryId: 'cat-food', description: 'Tesco' } });

    const note = screen.getByLabelText(/note/i);
    await user.clear(note);
    await user.type(note, 'starbucks');

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });

  it('fills the form from the quick add line without saving', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByLabelText(/amount/i)).toHaveValue('3.50');
    expect(screen.getByLabelText(/note/i)).toHaveValue('coffee');
    expect(screen.getByLabelText('Quick add')).toHaveValue('');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.queryByText(/enter a valid amount/i)).not.toBeInTheDocument();
  });

  it('recalls the category and switches to income for a + line', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'salary', categoryId: 'cat-salary', type: 'INCOME' })];
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), '+2400 salary{Enter}');

    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Salary' })).toBeChecked();
    expect(screen.getByLabelText(/amount/i)).toHaveValue('2400.00');
    expect(screen.getByText("Suggested from your earlier 'salary'")).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('focuses Save & add another when a category was recalled', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('button', { name: /save & add another/i })).toHaveFocus();
  });

  it('focuses the category chips when no category was recalled', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'flat white 3.50{Enter}');

    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(within(group).getAllByRole('radio')[0]).toHaveFocus();
  });

  it('focuses the first chip of the new type when the line flips the type', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), '+2400 bonus{Enter}');

    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked();
    expect(within(group).getAllByRole('radio')[0]).toHaveFocus();
  });

  it('shows the parser message and keeps the text when the line is invalid', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');

    expect(await screen.findByText("Couldn't find an amount")).toBeInTheDocument();
    expect(screen.getByLabelText('Quick add')).toHaveValue('coffee');
    expect(screen.getByLabelText(/amount/i)).toHaveValue('');
  });

  it('clears the parser message on the next keystroke', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
    await screen.findByText("Couldn't find an amount");
    await user.type(screen.getByLabelText('Quick add'), ' 3');

    expect(screen.queryByText("Couldn't find an amount")).not.toBeInTheDocument();
  });

  it('sets the type from the line even if another type was selected', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('radio', { name: 'Spend' })).toBeChecked();
  });

  it('keeps the chosen date when filling from the line', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('radio', { name: 'Yesterday' })).toBeChecked();
  });

  it('replaces a category the user had already picked', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Groceries' }));
    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('does not show the quick add line when editing', () => {
    renderSheet({ editing });
    expect(screen.queryByLabelText('Quick add')).not.toBeInTheDocument();
  });

  it('shows an example under the quick add field, even beside an error', async () => {
    const user = userEvent.setup();
    renderSheet();
    const example = 'e.g. coffee 3.50 · 3.50 coffee · +2400 salary (income)';

    expect(screen.getByText(example)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
    expect(await screen.findByText("Couldn't find an amount")).toBeInTheDocument();
    expect(screen.getByText(example)).toBeInTheDocument();
  });

  it('uses the template date instead of today when one is given', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing, templateDate: '2099-01-15' });

    expect(screen.getByRole('radio', { name: 'Other…' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: '2099-01-15' }));
  });

  it('selects Today when the template date is today', () => {
    renderSheet({ template: editing, templateDate: todayIso() });
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();
  });

  it('reports the created transaction through onSaved after a successful create', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderSheet({ template: editing, onSaved });

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
  });

  it('does not call onSaved when the create fails', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();
    renderSheet({ template: editing, onSaved });

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(onSaved).not.toHaveBeenCalled();
  });
});
