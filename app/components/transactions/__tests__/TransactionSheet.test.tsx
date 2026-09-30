import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIso, yesterdayIso } from '~/lib/months';
import { PREFERENCES_KEY } from '~/lib/preferences';
import type { Transaction } from '~/lib/types';
import { ApiError } from '~/lib/apiError';
import { EMPTY_DRAFT, clearTransactionDraft, saveTransactionDraft } from '~/lib/transactionDraft';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockUseRange = vi.hoisted(() => vi.fn());
// undefined means "still loading".
let mockTransactions: Transaction[] | undefined = [];
let mockPotCategories: unknown[] = [];
let mockCategoriesLoaded = true;

vi.mock('~/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/queries')>();
  return {
    ...actual,
    useCategories: () => ({
      data: mockCategoriesLoaded ? [
        { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
        { categoryId: 'cat-food', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
        { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
        ...mockPotCategories,
      ] : [],
      isLoading: false,
    }),
    useTransactionsRange: mockUseRange,
    useCreateTransaction: () => ({ mutateAsync: mockCreate, isPending: false }),
    useUpdateTransaction: () => ({ mutateAsync: mockUpdate, isPending: false }),
    useDeleteTransaction: () => ({ mutate: mockRemove }),
  };
});

import { TransactionSheet, type TransactionSheetProps } from '../TransactionSheet';

type User = ReturnType<typeof userEvent.setup>;

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

// By default a Save closes the sheet and the tip is out of the way; tests that
// care about the first-time question or the tip say so.
function seedPreferences(patch: Record<string, unknown> = {}): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ keepSheetOpen: 'no', quickAddTipDismissed: true, ...patch }));
}

function storedPreferences(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Record<string, unknown>;
}

// The type, date and note are values in one line ("Spend · Today · No note");
// tapping a value opens its control.
async function pickType(user: User, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^type:/i }));
  await user.click(screen.getByRole('radio', { name: label }));
}

async function pickDate(user: User, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^date:/i }));
  await user.click(screen.getByRole('radio', { name: label }));
}

async function openNote(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: /^note:/i }));
  return screen.getByLabelText('Note (optional)');
}

function noteInput(): HTMLElement {
  return screen.getByLabelText('Note (optional)');
}

async function fillAndSave(user: User, amount = '4.80', category = 'Dining'): Promise<void> {
  await user.type(screen.getByLabelText(/amount/i), amount);
  await user.click(screen.getByRole('radio', { name: category }));
  await user.click(screen.getByRole('button', { name: /^save$/i }));
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
    mockPotCategories = [];
    mockCategoriesLoaded = true;
    mockUseRange.mockReset();
    mockUseRange.mockImplementation(() => ({ data: mockTransactions }));
    clearTransactionDraft();
    seedPreferences();
  });

  afterEach(() => {
    cleanup();
    notifications.clean();
    localStorage.removeItem(PREFERENCES_KEY);
  });

  it('only loads recent history while the sheet is open', () => {
    const { setProps } = renderSheet({ opened: false });
    expect(mockUseRange.mock.calls.every(([, , enabled]) => enabled === false)).toBe(true);

    mockUseRange.mockClear();
    setProps({ opened: true });
    expect(mockUseRange.mock.calls.some(([, , enabled]) => enabled === true)).toBe(true);
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
    await fillAndSave(user);
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

  it('puts pinned categories first, ahead of more-used ones', () => {
    seedPreferences({ pinnedCategoryIds: ['cat-dining'] });
    mockTransactions = [
      { ...editing, transactionId: 'a', categoryId: 'cat-food' },
      { ...editing, transactionId: 'b', categoryId: 'cat-food' },
    ];
    renderSheet();
    expect(chipNames()).toEqual(['Dining', 'Groceries']);
  });

  it('only offers categories that match the chosen type', async () => {
    const user = userEvent.setup();
    renderSheet();
    await pickType(user, 'Income');
    expect(chipNames()).toEqual(['Salary']);
  });

  it('shows the type, date and note as one line of values', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Type: Spend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Date: Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Note: No note' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Yesterday' })).not.toBeInTheDocument();
  });

  it('keeps the category and says so when the type no longer fits it', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Dining' }));

    await pickType(user, 'Income');
    expect(screen.getByText("Dining isn't an income category. Choose another.")).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();

    await pickType(user, 'Spend');
    expect(screen.queryByText(/isn't an income category/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('defaults the date to today and lets you pick yesterday', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await pickDate(user, 'Yesterday');
    expect(screen.getByRole('button', { name: 'Date: Yesterday' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: yesterdayIso() }));
  });

  it('saves with today\'s date when no date is chosen', async () => {
    const user = userEvent.setup();
    renderSheet();
    await fillAndSave(user);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: todayIso() }));
  });

  it('hides the note until asked for', async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByLabelText('Note (optional)')).not.toBeInTheDocument();
    await openNote(user);
    expect(noteInput()).toBeInTheDocument();
  });

  it('shows the note in the line once one has been typed', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(await openNote(user), 'Coffee');
    expect(screen.getByRole('button', { name: 'Note: Coffee' })).toBeInTheDocument();
  });

  it('shows every field when editing', () => {
    renderSheet({ editing });
    expect(noteInput()).toHaveValue('Lunch');
    expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^note:/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Yesterday' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Type it instead' })).not.toBeInTheDocument();
  });

  it('prefills from a template, dated today', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing });

    expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    expect(noteInput()).toHaveValue('Lunch');
    expect(screen.getByRole('button', { name: 'Date: Today' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 480, categoryId: 'cat-dining', description: 'Lunch', date: todayIso() }),
    );
  });

  it('keeps the note collapsed for a template with no note', () => {
    renderSheet({ template: { ...editing, description: '' } });
    expect(screen.queryByLabelText('Note (optional)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Note: No note' })).toBeInTheDocument();
  });

  it('prefers the transaction being edited over a template', () => {
    renderSheet({ editing, template: { ...editing, amount: 999 } });
    expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
  });

  it('closes immediately without waiting for the create to finish', async () => {
    const user = userEvent.setup();
    mockCreate.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderSheet();
    await fillAndSave(user);
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

  describe('after saving', () => {
    it('asks the first time whether to keep the sheet open, without closing it', async () => {
      seedPreferences({ keepSheetOpen: 'ask' });
      const user = userEvent.setup();
      const { onClose } = renderSheet();
      await fillAndSave(user);

      expect(await screen.findByText('Keep this open for the next entry?')).toBeInTheDocument();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes and remembers the answer when told no', async () => {
      seedPreferences({ keepSheetOpen: 'ask' });
      const user = userEvent.setup();
      const { onClose } = renderSheet();
      await fillAndSave(user);

      await user.click(await screen.findByRole('button', { name: 'No, just close' }));

      expect(onClose).toHaveBeenCalled();
      expect(storedPreferences().keepSheetOpen).toBe('no');
    });

    it('stays open, empty and ready for the next entry when told yes', async () => {
      seedPreferences({ keepSheetOpen: 'ask' });
      const user = userEvent.setup();
      const { onClose } = renderSheet();
      await pickType(user, 'Income');
      await pickDate(user, 'Yesterday');
      await user.type(screen.getByLabelText(/amount/i), '10');
      await user.click(screen.getByRole('radio', { name: 'Salary' }));
      await user.type(await openNote(user), 'March');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await user.click(await screen.findByRole('button', { name: 'Yes, keep it open' }));

      expect(onClose).not.toHaveBeenCalled();
      expect(storedPreferences().keepSheetOpen).toBe('yes');
      expect(screen.getByLabelText(/amount/i)).toHaveValue('');
      expect(screen.getByLabelText(/amount/i)).toHaveFocus();
      expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();
      expect(screen.queryByLabelText('Note (optional)')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Type: Income' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Date: Yesterday' })).toBeInTheDocument();
    });

    it('does not ask again once answered', async () => {
      seedPreferences({ keepSheetOpen: 'yes' });
      const user = userEvent.setup();
      const { onClose } = renderSheet();
      await fillAndSave(user);

      expect(screen.queryByText('Keep this open for the next entry?')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/amount/i)).toHaveValue('');
    });

    it('accepts the next entry after keeping the sheet open', async () => {
      seedPreferences({ keepSheetOpen: 'yes' });
      const user = userEvent.setup();
      renderSheet();
      await fillAndSave(user);
      await fillAndSave(user, '2.00', 'Groceries');

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('saves and stays open when Enter is pressed and the preference is to keep it open', async () => {
      seedPreferences({ keepSheetOpen: 'yes' });
      const user = userEvent.setup();
      const { onClose } = renderSheet();
      await user.click(screen.getByRole('radio', { name: 'Dining' }));
      await user.type(screen.getByLabelText(/amount/i), '4.80{Enter}');

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 480, categoryId: 'cat-dining' }));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('offers Undo last save inside the sheet, and undoing removes the transaction', async () => {
      seedPreferences({ keepSheetOpen: 'yes' });
      const user = userEvent.setup();
      renderSheet();
      await fillAndSave(user);

      await user.click(await screen.findByRole('button', { name: /undo last save/i }));

      await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /undo last save/i })).not.toBeInTheDocument());
    });

    it('names what was saved on the in-sheet Undo', async () => {
      seedPreferences({ keepSheetOpen: 'yes' });
      const user = userEvent.setup();
      renderSheet();
      await fillAndSave(user);

      expect(await screen.findByRole('button', { name: 'Undo last save (£4.80 · Dining)' })).toBeInTheDocument();
    });

    it('offers Undo on the keep-open question too', async () => {
      seedPreferences({ keepSheetOpen: 'ask' });
      const user = userEvent.setup();
      renderSheet();
      await fillAndSave(user);

      await user.click(await screen.findByRole('button', { name: /undo last save/i }));

      await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
    });
  });

  it('offers Undo that deletes the created transaction', async () => {
    const user = userEvent.setup();
    renderSheet();
    await fillAndSave(user);

    expect(await screen.findByText(/saved £4\.80 · dining/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
  });

  it('passes onUndone through so a caller can react to Undo', async () => {
    const user = userEvent.setup();
    const onUndone = vi.fn();
    renderSheet({ onUndone });
    await fillAndSave(user);

    expect(await screen.findByText(/saved £4\.80 · dining/i)).toBeInTheDocument();
    expect(onUndone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
    expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' });
  });

  it('defers Undo until the create has finished', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ transactionId: string; yearMonth: string }>();
    mockCreate.mockReturnValue(pending.promise);
    renderSheet();
    await fillAndSave(user);

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(mockRemove).not.toHaveBeenCalled();

    pending.resolve({ transactionId: 'late-id', yearMonth: '2026-07' });
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 'late-id', yearMonth: '2026-07' }));
  });

  it('shows a Retry toast when the create fails and re-sends the same input', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new ApiError(400, 'Bad Request'));
    renderSheet();
    await fillAndSave(user);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const { transactionId: _firstTransactionId, ...firstInput } = mockCreate.mock.calls[0][0];
    expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining(firstInput));
  });

  it('stays silent when the create fails after the user pressed Undo', async () => {
    const user = userEvent.setup();
    const pending = deferred<never>();
    mockCreate.mockReturnValue(pending.promise.then(() => { throw new ApiError(400, 'Bad Request'); }));
    renderSheet();
    await fillAndSave(user);
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
    expect(screen.queryByText('Keep this open for the next entry?')).not.toBeInTheDocument();
  });

  it('closes after a successful edit', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({});
    const { onClose } = renderSheet({ editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('never asks whether to keep the sheet open after an edit', async () => {
    seedPreferences({ keepSheetOpen: 'ask' });
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({});
    const { onClose } = renderSheet({ editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText('Keep this open for the next entry?')).not.toBeInTheDocument();
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

  describe('category suggestions from the note', () => {
    it('offers the remembered category as a chip when a known note is fully typed', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starbucks');

      expect(screen.getByText("You used Dining for ‘starbucks’ before.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Use Dining?' })).toBeInTheDocument();
    });

    it('never applies the suggestion until it is tapped', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starbucks');
      expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();

      await user.click(screen.getByRole('button', { name: 'Use Dining?' }));

      expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
      expect(screen.queryByRole('button', { name: 'Use Dining?' })).not.toBeInTheDocument();
    });

    it('announces the suggestion as a status message', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starbucks');

      expect(screen.getByText("You used Dining for ‘starbucks’ before.").closest('[role="status"]')).not.toBeNull();
    });

    it('does not suggest a category for a partial note', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starb');

      expect(screen.queryByRole('button', { name: 'Use Dining?' })).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    });

    it('never overwrites a category the user picked', async () => {
      const user = userEvent.setup();
      mockTransactions = [
        pastTxn({ transactionId: 'a', description: 'Starbucks', categoryId: 'cat-dining' }),
        pastTxn({ transactionId: 'b', description: 'Tesco', categoryId: 'cat-food' }),
      ];
      renderSheet();

      await user.click(screen.getByRole('radio', { name: 'Groceries' }));
      await user.type(await openNote(user), 'starbucks');

      expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    });

    it('offers the suggestion once history loads after the note was typed', async () => {
      const user = userEvent.setup();
      mockTransactions = undefined;
      const { setProps } = renderSheet();

      await user.type(await openNote(user), 'starbucks');
      expect(screen.queryByRole('button', { name: 'Use Dining?' })).not.toBeInTheDocument();

      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      setProps({});

      expect(await screen.findByRole('button', { name: 'Use Dining?' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    });

    it('offers the suggestion once categories load after the history', async () => {
      const user = userEvent.setup();
      mockCategoriesLoaded = false;
      mockTransactions = undefined;
      const { setProps } = renderSheet();

      await user.type(await openNote(user), 'starbucks');

      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      setProps({});

      mockCategoriesLoaded = true;
      setProps({});

      expect(await screen.findByRole('button', { name: 'Use Dining?' })).toBeInTheDocument();
    });

    it('does not change a category the user picked when the history arrives late', async () => {
      const user = userEvent.setup();
      mockTransactions = undefined;
      const { setProps } = renderSheet();

      await user.click(screen.getByRole('radio', { name: 'Groceries' }));
      await user.type(await openNote(user), 'starbucks');

      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      setProps({});

      expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    });

    it('does not change an edited transaction when the history arrives late', async () => {
      mockTransactions = undefined;
      const { setProps } = renderSheet({ editing });
      expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

      mockTransactions = [pastTxn({ description: 'Lunch', categoryId: 'cat-food' })];
      setProps({});

      expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Groceries' })).not.toBeChecked();
    });

    it('suggests nothing when the history arrives but there is no note', () => {
      mockTransactions = undefined;
      const { setProps } = renderSheet();

      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      setProps({});

      expect(screen.queryByText(/you used/i)).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: 'Groceries' })).not.toBeChecked();
    });

    it('withdraws the suggestion when the note stops matching', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starbucks');
      expect(screen.getByRole('button', { name: 'Use Dining?' })).toBeInTheDocument();

      await user.type(noteInput(), 'x');

      expect(screen.queryByRole('button', { name: 'Use Dining?' })).not.toBeInTheDocument();
      expect(screen.queryByText(/you used/i)).not.toBeInTheDocument();
    });

    it('drops the suggestion once the user picks a category', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starbucks');
      await user.click(screen.getByRole('radio', { name: 'Groceries' }));

      expect(screen.queryByText(/you used/i)).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    });

    it('suggests again for the new type when the type changes', async () => {
      const user = userEvent.setup();
      mockTransactions = [
        pastTxn({ transactionId: 'a', description: 'Refund', categoryId: 'cat-dining' }),
        pastTxn({ transactionId: 'b', description: 'Refund', categoryId: 'cat-salary', type: 'INCOME', date: '2026-07-02' }),
      ];
      renderSheet();

      await user.type(await openNote(user), 'refund');
      expect(screen.getByRole('button', { name: 'Use Dining?' })).toBeInTheDocument();

      await pickType(user, 'Income');
      expect(screen.getByRole('button', { name: 'Use Salary?' })).toBeInTheDocument();

      await pickType(user, 'Spend');
      expect(screen.getByRole('button', { name: 'Use Dining?' })).toBeInTheDocument();
    });

    it('suggests nothing on a type change when the note has no match there', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet();

      await user.type(await openNote(user), 'starbucks');
      await pickType(user, 'Income');

      expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();
      expect(screen.queryByText(/you used/i)).not.toBeInTheDocument();
    });

    it('never suggests a category while editing', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet({ editing: { ...editing, categoryId: 'cat-food', description: 'Lunch' } });

      const note = noteInput();
      await user.clear(note);
      await user.type(note, 'starbucks');

      expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
      expect(screen.queryByText(/you used/i)).not.toBeInTheDocument();
    });

    it('keeps a duplicated category when the note is changed', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
      renderSheet({ template: { ...editing, categoryId: 'cat-food', description: 'Tesco' } });

      const note = noteInput();
      await user.clear(note);
      await user.type(note, 'starbucks');

      expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    });
  });

  describe('typing it instead', () => {
    async function startTyping(user: User): Promise<void> {
      await user.click(screen.getByRole('button', { name: 'Type it instead' }));
    }

    it('fills the form from the line without saving', async () => {
      const user = userEvent.setup();
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

      expect(screen.getByLabelText(/amount/i)).toHaveValue('3.50');
      expect(screen.getByRole('button', { name: 'Note: coffee' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Quick add')).not.toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('recalls the category and switches to income for a + line, and says where it came from', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'salary', categoryId: 'cat-salary', type: 'INCOME' })];
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), '+2400 salary{Enter}');

      expect(screen.getByRole('button', { name: 'Type: Income' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Salary' })).toBeChecked();
      expect(screen.getByLabelText(/amount/i)).toHaveValue('2400.00');
      expect(screen.getByText('Category filled in from your earlier ‘salary’.')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('drops the "filled in" message once the category is changed', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');
      expect(screen.getByText(/category filled in from your earlier/i)).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: 'Groceries' }));

      expect(screen.queryByText(/category filled in from your earlier/i)).not.toBeInTheDocument();
    });

    it('moves focus to Save, whether or not a category was recalled', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');
      expect(screen.getByRole('button', { name: /^save$/i })).toHaveFocus();
    });

    it('moves focus to Save when no category was recalled', async () => {
      const user = userEvent.setup();
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'flat white 3.50{Enter}');

      expect(screen.getByRole('button', { name: /^save$/i })).toHaveFocus();
      expect(screen.getByRole('radiogroup', { name: 'Category' })).toBeInTheDocument();
    });

    it('shows the parser message and keeps the text when the line is invalid', async () => {
      const user = userEvent.setup();
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');

      expect(await screen.findByText("Couldn't find an amount")).toBeInTheDocument();
      expect(screen.getByLabelText('Quick add')).toHaveValue('coffee');
    });

    it('clears the parser message on the next keystroke', async () => {
      const user = userEvent.setup();
      renderSheet();

      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
      await screen.findByText("Couldn't find an amount");
      await user.type(screen.getByLabelText('Quick add'), ' 3');

      expect(screen.queryByText("Couldn't find an amount")).not.toBeInTheDocument();
    });

    it('sets the type from the line even if another type was selected', async () => {
      const user = userEvent.setup();
      renderSheet();

      await pickType(user, 'Income');
      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

      expect(screen.getByRole('button', { name: 'Type: Spend' })).toBeInTheDocument();
    });

    it('keeps the chosen date when filling from the line', async () => {
      const user = userEvent.setup();
      renderSheet();

      await pickDate(user, 'Yesterday');
      await startTyping(user);
      await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

      expect(screen.getByRole('button', { name: 'Date: Yesterday' })).toBeInTheDocument();
    });

    it('replaces a category the user had already picked when the line has a remembered one', async () => {
      const user = userEvent.setup();
      mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
      renderSheet();

      await user.click(screen.getByRole('radio', { name: 'Groceries' }));
      await startTyping(user);
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

      await startTyping(user);
      expect(screen.getByText(example)).toBeInTheDocument();

      await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
      expect(await screen.findByText("Couldn't find an amount")).toBeInTheDocument();
      expect(screen.getByText(example)).toBeInTheDocument();
    });

    it('remembers the mode for next time, and goes back with Use the form instead', async () => {
      const user = userEvent.setup();
      renderSheet();

      await startTyping(user);
      expect(storedPreferences().entryMode).toBe('quick');

      await user.click(screen.getByRole('button', { name: 'Use the form instead' }));
      expect(storedPreferences().entryMode).toBe('form');
      expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    });

    it('opens in the remembered mode', () => {
      seedPreferences({ entryMode: 'quick' });
      renderSheet();
      expect(screen.getByLabelText('Quick add')).toBeInTheDocument();
      expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument();
    });

    it('offers Fill in the form rather than Save while typing a line', () => {
      seedPreferences({ entryMode: 'quick' });
      renderSheet();
      expect(screen.getByRole('button', { name: 'Fill in the form' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    });

    it('shows the tip in quick add until it is dismissed, then never again', async () => {
      seedPreferences({ quickAddTipDismissed: false, entryMode: 'quick' });
      const user = userEvent.setup();
      renderSheet();

      expect(screen.getByRole('note')).toHaveTextContent('Tip: type +2400 salary for income.');
      await user.click(screen.getByRole('button', { name: 'Got it' }));

      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      expect(storedPreferences().quickAddTipDismissed).toBe(true);
    });
  });

  it('uses the template date instead of today when one is given', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing, templateDate: '2099-01-15' });

    expect(screen.getByRole('button', { name: /^date:/i })).not.toHaveAccessibleName('Date: Today');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: '2099-01-15' }));
  });

  it('links the first save to the recurring bill it came from, and only that one', async () => {
    seedPreferences({ keepSheetOpen: 'yes' });
    const user = userEvent.setup();
    const recurringId = '3f2b8c1e-9a4d-4e7f-b1c2-0d9e8f7a6b5c';
    renderSheet({ template: editing, templateDate: '2099-01-15', recurringId });

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ recurringId }));

    await fillAndSave(user, '2.00', 'Dining');
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    expect(mockCreate.mock.calls[1][0]).not.toHaveProperty('recurringId');
  });

  it('never sends a recurringId without being given one', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('recurringId');
  });

  it('labels the date Today when the template date is today', () => {
    renderSheet({ template: editing, templateDate: todayIso() });
    expect(screen.getByRole('button', { name: 'Date: Today' })).toBeInTheDocument();
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

  describe('pots', () => {
    const holidays = { categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', icon: 'x', isDefault: true, createdAt: '' };

    it('opens on the preset type and category', () => {
      mockPotCategories = [holidays];
      renderSheet({ preset: { type: 'SET_ASIDE', categoryId: 'cat-holidays' } });
      expect(screen.getByRole('button', { name: 'Type: Set aside' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Holidays' })).toBeChecked();
    });

    it('ignores the preset when editing', () => {
      mockPotCategories = [holidays];
      renderSheet({ editing, preset: { type: 'SET_ASIDE', categoryId: 'cat-holidays' } });
      expect(screen.getByRole('radio', { name: 'Spend' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    });

    it('offers only pots for Set aside and Take out, and both kinds for Spend', async () => {
      mockPotCategories = [holidays];
      const user = userEvent.setup();
      renderSheet();
      expect(chipNames()).toEqual(expect.arrayContaining(['Dining', 'Holidays']));
      await pickType(user, 'Set aside');
      expect(chipNames()).toEqual(['Holidays']);
      await pickType(user, 'Take out');
      expect(chipNames()).toEqual(['Holidays']);
    });

    it('keeps an expense category when switching to Set aside, says it does not fit, and refuses to save', async () => {
      mockPotCategories = [holidays];
      const user = userEvent.setup();
      renderSheet();
      await user.click(screen.getByRole('radio', { name: 'Dining' }));
      await pickType(user, 'Set aside');

      expect(screen.getByText("Dining isn't a pot. Choose another.")).toBeInTheDocument();
      const group = screen.getByRole('radiogroup', { name: 'Category' });
      within(group).getAllByRole('radio').forEach(r => expect(r).not.toBeChecked());

      await user.type(screen.getByLabelText(/amount/i), '4.80');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(await screen.findByText("Dining isn't a pot. Choose another.")).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('field errors', () => {
    it('shows the category error on the category field and focuses a chip', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByLabelText(/amount/i), '4.80');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      const group = screen.getByRole('radiogroup', { name: 'Category' });
      expect(group).toHaveAttribute('aria-invalid', 'true');
      expect(group).toHaveAccessibleDescription('Choose a category');
      expect(screen.getByLabelText(/amount/i)).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText(/amount/i)).not.toHaveAccessibleDescription();
      expect(within(group).getAllByRole('radio')).toContain(document.activeElement);
    });

    it('shows the amount error on the amount field and focuses it', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.click(screen.getByRole('radio', { name: 'Dining' }));
      await user.type(screen.getByLabelText(/amount/i), 'abc');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      const amount = screen.getByLabelText(/amount/i);
      expect(amount).toHaveAttribute('aria-invalid', 'true');
      expect(amount).toHaveAccessibleDescription(/enter a valid amount/i);
      expect(amount).toHaveFocus();
      expect(screen.getByRole('radiogroup', { name: 'Category' })).not.toHaveAttribute('aria-invalid');
    });

    it('shows every error at once and focuses the first', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(screen.getAllByRole('alert').map(a => a.textContent)).toEqual([
        expect.stringMatching(/amount/i),
        'Choose a category',
      ]);
      expect(screen.getByLabelText(/amount/i)).toHaveFocus();
    });

    it('asks for a date in the picker\'s format and focuses the date field', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByLabelText(/amount/i), '4.80');
      await user.click(screen.getByRole('radio', { name: 'Dining' }));
      await pickDate(user, 'Other…');
      await user.clear(screen.getByLabelText('Date'));
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      const date = screen.getByLabelText('Date');
      expect(date).toHaveAttribute('aria-invalid', 'true');
      expect(date).toHaveAccessibleDescription('Enter a date, for example 27/09/2026');
      expect(date).toHaveFocus();
      expect(screen.queryByText(/YYYY/)).not.toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('clears a field\'s error once that field changes', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByLabelText(/amount/i), '4.80');
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      await user.click(screen.getByRole('radio', { name: 'Dining' }));
      expect(screen.queryByText('Choose a category')).not.toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Category' })).not.toHaveAttribute('aria-invalid');
    });

    it('shows an edit save failure apart from the amount field', async () => {
      const user = userEvent.setup();
      mockUpdate.mockRejectedValue(new Error('boom'));
      renderSheet({ editing });
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
      expect(screen.getByLabelText(/amount/i)).not.toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('drafts', () => {
    async function typeDraft(user: User): Promise<void> {
      await user.type(screen.getByLabelText(/amount/i), '9.99');
      await user.click(screen.getByRole('radio', { name: 'Groceries' }));
      await pickDate(user, 'Yesterday');
      await user.type(await openNote(user), 'Market');
    }

    function expectDraftRestored(): void {
      expect(screen.getByLabelText(/amount/i)).toHaveValue('9.99');
      expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Date: Yesterday' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Note: Market' })).toBeInTheDocument();
    }

    function expectEmptyForm(): void {
      expect(screen.getByLabelText(/amount/i)).toHaveValue('');
      within(screen.getByRole('radiogroup', { name: 'Category' })).getAllByRole('radio')
        .forEach(r => expect(r).not.toBeChecked());
      expect(screen.getByRole('button', { name: 'Type: Spend' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Date: Today' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Note: No note' })).toBeInTheDocument();
    }

    it('restores what was typed when the sheet is closed and reopened', async () => {
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await typeDraft(user);

      setProps({ opened: false });
      setProps({ opened: true });

      expectDraftRestored();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('restores the draft after the app remounts the sheet', async () => {
      const user = userEvent.setup();
      renderSheet();
      await typeDraft(user);
      cleanup();

      renderSheet();
      expectDraftRestored();
    });

    it('restores a line that was being typed', async () => {
      seedPreferences({ entryMode: 'quick' });
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await user.type(screen.getByLabelText('Quick add'), 'cof');

      setProps({ opened: false });
      setProps({ opened: true });

      expect(screen.getByLabelText('Quick add')).toHaveValue('cof');
    });

    it('restores a typed income entry with its type', async () => {
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await pickType(user, 'Income');
      await user.click(screen.getByRole('radio', { name: 'Salary' }));

      setProps({ opened: false });
      setProps({ opened: true });

      expect(screen.getByRole('button', { name: 'Type: Income' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Salary' })).toBeChecked();
    });

    it('shows Clear only once something has been entered', async () => {
      const user = userEvent.setup();
      renderSheet();
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
      await user.type(screen.getByLabelText(/amount/i), '1');
      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('empties the form and the draft on Clear', async () => {
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await typeDraft(user);

      await user.click(screen.getByRole('button', { name: 'Clear' }));
      expectEmptyForm();
      expect(screen.getByLabelText(/amount/i)).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

      setProps({ opened: false });
      setProps({ opened: true });
      expectEmptyForm();
    });

    it('removes the draft after a successful Save', async () => {
      const user = userEvent.setup();
      const { setProps, onClose } = renderSheet();
      await typeDraft(user);
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      expect(onClose).toHaveBeenCalled();

      setProps({ opened: false });
      setProps({ opened: true });
      expectEmptyForm();
    });

    it('removes the draft after saving with the sheet kept open', async () => {
      seedPreferences({ keepSheetOpen: 'yes' });
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await typeDraft(user);
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      setProps({ opened: false });
      setProps({ opened: true });
      expect(screen.getByLabelText(/amount/i)).toHaveValue('');
    });

    it('keeps the draft when Save finds a problem', async () => {
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await user.type(screen.getByLabelText(/amount/i), '9.99');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      setProps({ opened: false });
      setProps({ opened: true });
      expect(screen.getByLabelText(/amount/i)).toHaveValue('9.99');
    });

    it('asks for a category again when the restored one no longer exists', async () => {
      saveTransactionDraft('', { ...EMPTY_DRAFT, amount: '9.99', categoryId: 'cat-deleted' });
      const user = userEvent.setup();
      renderSheet();
      expect(screen.getByLabelText(/amount/i)).toHaveValue('9.99');
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      expect(screen.getByRole('radiogroup', { name: 'Category' })).toHaveAccessibleDescription('Choose a category');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('never restores a draft while editing, and leaves it for the next Add', async () => {
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await typeDraft(user);
      setProps({ opened: false });

      setProps({ opened: true, editing });
      expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
      expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
      expect(noteInput()).toHaveValue('Lunch');
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
      await user.clear(screen.getByLabelText(/amount/i));
      await user.type(screen.getByLabelText(/amount/i), '5.00');

      setProps({ opened: false, editing: null });
      setProps({ opened: true, editing: null });
      expectDraftRestored();
    });

    it('never restores a draft into a duplicate or a pot entry', async () => {
      const user = userEvent.setup();
      const { setProps } = renderSheet();
      await typeDraft(user);
      setProps({ opened: false });

      setProps({ opened: true, template: editing });
      expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
      setProps({ opened: false, template: null });

      setProps({ opened: true, preset: { type: 'EXPENSE', categoryId: 'cat-dining' } });
      expect(screen.getByLabelText(/amount/i)).toHaveValue('');
      expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    });
  });
});
