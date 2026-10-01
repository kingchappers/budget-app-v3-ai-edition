import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider, TextInput } from '@mantine/core';
import { TransactionRow } from '../TransactionRow';
import { todayIso, yesterdayIso } from '~/lib/months';
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

  it('has no menu when Duplicate is the only action, because Duplicate is not in the menu', () => {
    renderRow({ onDuplicate: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Actions for Weekly Shop' })).not.toBeInTheDocument();
  });
});

describe('TransactionRow tap targets', () => {
  it('gives Duplicate and the actions menu a 44px target, with the amount kept on one line', () => {
    renderRow({ onEdit: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() });
    // 2.75rem is 44px at the standard size, and grows with the text size.
    expect(screen.getByRole('button', { name: 'Duplicate Weekly Shop' }).getAttribute('style')).toMatch(/2\.75rem/);
    expect(screen.getByRole('button', { name: 'Actions for Weekly Shop' }).getAttribute('style')).toMatch(/2\.75rem/);
  });
});

describe('TransactionRow Duplicate', () => {
  it('is a visible, labelled button, not tucked in the menu, and reports the transaction', async () => {
    const onDuplicate = vi.fn();
    renderRow({ onEdit: vi.fn(), onDuplicate });

    const button = screen.getByRole('button', { name: 'Duplicate Weekly Shop' });
    expect(button).toBeVisible();
    expect(button).toHaveTextContent('Duplicate');
    await userEvent.setup().click(button);

    expect(onDuplicate).toHaveBeenCalledWith(transaction);
  });

  it('is not repeated inside the menu', async () => {
    renderRow({ onEdit: vi.fn(), onDuplicate: vi.fn() });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await screen.findByRole('menuitem', { name: 'Edit' });
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument();
  });

  it('is absent when no handler is given', () => {
    renderRow({ onEdit: vi.fn() });
    expect(screen.queryByRole('button', { name: /^Duplicate/ })).not.toBeInTheDocument();
  });

  it('is absent while the row is still waiting to sync', () => {
    renderRow({ onDuplicate: vi.fn(), onDiscard: vi.fn(), pending: true });
    expect(screen.queryByRole('button', { name: /^Duplicate/ })).not.toBeInTheDocument();
  });
});

describe('TransactionRow date', () => {
  it('says Today and Yesterday, and otherwise a readable day, never an ISO date', () => {
    renderRow({ transaction: { ...transaction, date: todayIso() } });
    expect(screen.getByText('Groceries · Today')).toBeInTheDocument();
  });

  it('says Yesterday for yesterday', () => {
    renderRow({ transaction: { ...transaction, date: yesterdayIso() } });
    expect(screen.getByText('Groceries · Yesterday')).toBeInTheDocument();
  });

  it('gives an older date as weekday, day and month', () => {
    renderRow({ transaction: { ...transaction, date: '2020-09-10' } });
    expect(screen.getByText('Groceries · Thu 10 Sep 2020')).toBeInTheDocument();
    expect(screen.queryByText(/2020-09-10/)).not.toBeInTheDocument();
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

describe('TransactionRow tap to edit', () => {
  it('opens Edit when the row itself is tapped', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderRow({ onEdit });

    await user.click(screen.getByRole('button', { name: 'Edit Weekly Shop' }));

    expect(onEdit).toHaveBeenCalledWith(transaction);
  });

  it('opens Edit from the keyboard', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderRow({ onEdit });

    screen.getByRole('button', { name: 'Edit Weekly Shop' }).focus();
    await user.keyboard('{Enter}');

    expect(onEdit).toHaveBeenCalledWith(transaction);
  });

  it('is not tappable without an Edit handler', () => {
    renderRow();
    expect(screen.queryByRole('button', { name: 'Edit Weekly Shop' })).not.toBeInTheDocument();
  });

  it('is not tappable while pending', () => {
    renderRow({ onEdit: vi.fn(), pending: true });
    expect(screen.queryByRole('button', { name: 'Edit Weekly Shop' })).not.toBeInTheDocument();
  });
});

describe('TransactionRow layout', () => {
  it('lets the amount and actions drop below the name when they do not fit beside it', () => {
    render(
      <MantineProvider>
        <TransactionRow
          transaction={{ transactionId: 't1', yearMonth: '2026-10', amount: 1000, type: 'EXPENSE', categoryId: 'c', description: 'Lunch', date: '2026-10-01', createdAt: '' }}
          categoryName="Eating out"
          categoryIcon="tag"
          onEdit={() => {}}
        />
      </MantineProvider>,
    );
    const row = screen.getByRole('button', { name: 'Edit Lunch' }).parentElement as HTMLElement;
    expect(row.style.getPropertyValue('--group-wrap')).toBe('wrap');
  });
});
