import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { TransactionRow } from '../TransactionRow';
import type { Transaction } from '~/lib/types';

const transaction: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 1000, type: 'EXPENSE', categoryId: 'cat-food',
  description: 'Weekly Shop', date: '2026-09-10', createdAt: '',
};

function renderRow(props: Partial<React.ComponentProps<typeof TransactionRow>> = {}) {
  render(
    <MantineProvider>
      <TransactionRow transaction={transaction} categoryName="Groceries" categoryIcon="shopping-cart" {...props} />
    </MantineProvider>,
  );
}

describe('TransactionRow menu', () => {
  it('offers Duplicate and reports the transaction', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    renderRow({ onEdit: vi.fn(), onDuplicate });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    expect(onDuplicate).toHaveBeenCalledWith(transaction);
  });

  it('omits Duplicate when no handler is given', async () => {
    const user = userEvent.setup();
    renderRow({ onEdit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await screen.findByRole('menuitem', { name: 'Edit' });

    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument();
  });

  it('offers Repeat monthly and reports the transaction', async () => {
    const user = userEvent.setup();
    const onRepeat = vi.fn();
    renderRow({ onEdit: vi.fn(), onRepeat });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Repeat monthly' }));

    expect(onRepeat).toHaveBeenCalledWith(transaction);
  });

  it('omits Repeat monthly when no handler is given', async () => {
    const user = userEvent.setup();
    renderRow({ onEdit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await screen.findByRole('menuitem', { name: 'Edit' });

    expect(screen.queryByRole('menuitem', { name: 'Repeat monthly' })).not.toBeInTheDocument();
  });

  it('shows the menu when Duplicate is the only action', async () => {
    renderRow({ onDuplicate: vi.fn() });
    expect(screen.getByRole('button', { name: 'Actions for Weekly Shop' })).toBeInTheDocument();
  });
});

describe('TransactionRow pending badge', () => {
  it('shows a pending clock icon when pending is true', () => {
    renderRow({ pending: true });
    expect(screen.getByLabelText('Waiting to sync')).toBeInTheDocument();
  });

  it('shows the queued error as a tooltip label when pendingError is set', () => {
    renderRow({ pending: true, pendingError: 'categoryId must be an existing category' });
    expect(screen.getByLabelText('categoryId must be an existing category')).toBeInTheDocument();
  });

  it('shows no pending icon when pending is false or omitted', () => {
    renderRow();
    expect(screen.queryByLabelText('Waiting to sync')).not.toBeInTheDocument();
  });
});

describe('TransactionRow pending row actions', () => {
  it('offers only Discard while pending, never Edit or Delete', async () => {
    const user = userEvent.setup();
    renderRow({ pending: true, onEdit: vi.fn(), onDelete: vi.fn(), onDiscard: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));

    expect(await screen.findByRole('menuitem', { name: 'Discard' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('calls onDiscard with the transaction', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    renderRow({ pending: true, onDiscard });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Discard' }));

    expect(onDiscard).toHaveBeenCalledWith(transaction);
  });

  it('shows no actions menu at all while pending if no onDiscard is given', () => {
    renderRow({ pending: true, onEdit: vi.fn(), onDelete: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Actions for Weekly Shop' })).not.toBeInTheDocument();
  });
});
