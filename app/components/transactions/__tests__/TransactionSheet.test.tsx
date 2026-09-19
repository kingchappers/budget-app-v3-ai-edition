import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIso, yesterdayIso } from '~/lib/months';
import type { Transaction } from '~/lib/types';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
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
  useTransactions: () => ({ data: mockTransactions }),
  useCreateTransaction: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

import { TransactionSheet, type TransactionSheetProps } from '../TransactionSheet';

function renderSheet(props: Partial<TransactionSheetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <TransactionSheet opened onClose={() => {}} yearMonth="2026-07" {...props} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

function chipNames(): (string | undefined)[] {
  const group = screen.getByRole('radiogroup', { name: 'Category' });
  return within(group).getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0]?.textContent ?? undefined);
}

const editing: Transaction = {
  transactionId: 't1', yearMonth: '2026-07', amount: 480, type: 'EXPENSE', categoryId: 'cat-dining',
  description: 'Lunch', date: '2026-07-03', createdAt: '',
};

describe('TransactionSheet', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ transactionId: 't-real', yearMonth: '2026-07' });
    mockUpdate.mockReset();
    mockTransactions = [];
  });

  it('shows a validation message for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), 'abc');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects more than two decimal places', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.805');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a category before submitting', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/choose a category/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('submits a valid transaction as integer pence', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /save/i }));
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
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: yesterdayIso() }));
  });

  it('saves with today\'s date when no date is chosen', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /save/i }));
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
});
