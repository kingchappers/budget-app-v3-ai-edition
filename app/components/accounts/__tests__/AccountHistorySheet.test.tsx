import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { AccountHistorySheet } from '../AccountHistorySheet';
import { addDaysIso, todayIso } from '~/lib/months';
import type { Account } from '~/lib/types';

function account(overrides: Partial<Account> = {}): Account {
  return {
    accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH',
    balances: [{ date: '2026-08-01', pence: 200000 }, { date: '2026-09-01', pence: 250000 }],
    createdAt: '', ...overrides,
  };
}

function renderSheet(data: Account | null) {
  const onClose = vi.fn();
  const onUpdate = vi.fn();
  render(<MantineProvider><AccountHistorySheet account={data} onClose={onClose} onUpdate={onUpdate} /></MantineProvider>);
  return { onClose, onUpdate };
}

describe('AccountHistorySheet', () => {
  it('renders nothing without an account', () => {
    renderSheet(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the current balance and every entry newest first', () => {
    renderSheet(account());
    const dialog = screen.getByRole('dialog', { name: 'Lloyds' });
    expect(dialog).toHaveTextContent('£2,500.00');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('£2,500.00');
    expect(rows[1]).toHaveTextContent('£2,000.00');
  });

  it('shows a message instead of a table when there is no history', () => {
    renderSheet(account({ balances: [] }));
    expect(screen.getByText('No balance history yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('opens the update form when Update is tapped', async () => {
    renderSheet(account());
    const { onUpdate } = renderSheet(account());
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Update' })[1]);
    expect(onUpdate).toHaveBeenCalled();
  });

  it('says how long ago the balance was entered, under the balance', () => {
    renderSheet(account({ balances: [{ date: addDaysIso(todayIso(), -23), pence: 200000 }] }));
    expect(screen.getByText('Updated 23 days ago')).toBeInTheDocument();
  });
});
