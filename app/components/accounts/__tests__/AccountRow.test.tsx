import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { AccountRow } from '../AccountRow';
import type { Account } from '~/lib/types';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [{ date: '2026-09-01', pence: 250000 }], createdAt: '', ...overrides };
}

function renderRow(data: Account = account()) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(<MantineProvider><AccountRow account={data} onOpen={onOpen} onDelete={onDelete} /></MantineProvider>);
  return { onOpen, onDelete };
}

describe('AccountRow', () => {
  it('shows the name, type and current balance', () => {
    renderRow();
    expect(screen.getByText('Lloyds')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('£2,500.00')).toBeInTheDocument();
  });

  it('shows £0.00 for an account with no balance entries yet', () => {
    renderRow(account({ balances: [] }));
    expect(screen.getByText('£0.00')).toBeInTheDocument();
  });

  it('opens the account when the row is tapped', async () => {
    const { onOpen } = renderRow();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Lloyds history' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('asks to delete the account from its menu', async () => {
    const { onDelete } = renderRow();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions for Lloyds' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
