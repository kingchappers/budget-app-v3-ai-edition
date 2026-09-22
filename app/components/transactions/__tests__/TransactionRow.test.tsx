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
