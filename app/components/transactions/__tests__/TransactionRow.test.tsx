import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider, TextInput } from '@mantine/core';
import { TransactionRow } from '../TransactionRow';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
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

describe('TransactionRow sync status', () => {
  it('says the row is waiting to sync when it is queued', () => {
    renderRow({ pending: true });
    expect(screen.getByText('Waiting to sync')).toBeVisible();
  });

  it('shows a sync error as visible text with a focusable Retry that calls onRetry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderRow({ pending: true, pendingError: 'categoryId must be an existing category', onRetry });

    expect(screen.getByText('Not synced. Tap to retry.')).toBeVisible();
    const retry = screen.getByRole('button', { name: 'Retry syncing Weekly Shop' });
    await user.tab();
    expect(retry).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('labels a row still waiting for the server as Saving', () => {
    renderRow({ saving: true });
    expect(screen.getByText('Saving')).toBeVisible();
  });

  it('shows no sync status for a confirmed row', () => {
    renderRow();
    expect(screen.queryByText('Waiting to sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Saving')).not.toBeInTheDocument();
    expect(screen.queryByText('Not synced. Tap to retry.')).not.toBeInTheDocument();
  });
});

function EditHarness() {
  const [editing, setEditing] = useState<Transaction | null>(null);
  return (
    <>
      <TransactionRow transaction={transaction} categoryName="Groceries" categoryIcon="shopping-cart" onEdit={setEditing} />
      <ResponsiveSheet opened={editing !== null} onClose={() => setEditing(null)} title="Edit transaction">
        <TextInput data-autofocus label="Description" />
      </ResponsiveSheet>
    </>
  );
}

describe('TransactionRow menu focus handoff', () => {
  it('never returns focus to the closed Actions button after Edit opens the sheet', async () => {
    render(
      <MantineProvider>
        <EditHarness />
      </MantineProvider>,
    );
    const actionsButton = screen.getByRole('button', { name: 'Actions for Weekly Shop' });
    // Mantine's Menu returns focus to its target 10ms after it closes (useFocusReturn).
    // That races the sheet's own focus trap and, uncorrected, steals focus back onto
    // this now-hidden button after the sheet has already taken it — the spy catches
    // that second call regardless of which one happens to "win" by the time we look.
    const focusSpy = vi.spyOn(actionsButton, 'focus');

    const user = userEvent.setup();
    await user.click(actionsButton);
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit transaction' });
    // Give any delayed return-focus timer time to fire before asserting.
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('still returns focus to the Actions button after Delete, which opens no sheet', async () => {
    const user = userEvent.setup();
    renderRow({ onDelete: vi.fn() });

    const actionsButton = screen.getByRole('button', { name: 'Actions for Weekly Shop' });
    await user.click(actionsButton);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(actionsButton).toHaveFocus();
  });

  it('still returns focus to the Actions button after dismissing the menu with Escape', async () => {
    const user = userEvent.setup();
    renderRow({ onEdit: vi.fn() });

    const actionsButton = screen.getByRole('button', { name: 'Actions for Weekly Shop' });
    await user.click(actionsButton);
    await screen.findByRole('menuitem', { name: 'Edit' });
    await user.keyboard('{Escape}');

    expect(actionsButton).toHaveFocus();
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
