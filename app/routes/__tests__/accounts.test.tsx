import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Account } from '~/lib/types';

const state = vi.hoisted(() => ({
  accounts: [] as Account[],
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useAccounts: () => ({ data: state.accounts, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateAccount: () => ({ mutate: state.create, isPending: false }),
  useDeleteAccount: () => ({ mutate: state.remove, isPending: false }),
  useAddBalance: () => ({ mutate: vi.fn(), isPending: false }),
}));

import Accounts from '../accounts';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [{ date: '2026-09-01', pence: 250000 }], createdAt: '', ...overrides };
}

function renderPage() {
  return render(<MantineProvider><Accounts /></MantineProvider>);
}

function renderPageAsUser() {
  renderPage();
  return userEvent.setup();
}

beforeEach(() => {
  state.accounts = [];
  state.create.mockReset();
  state.remove.mockReset();
});

describe('Accounts page', () => {
  it('shows total assets, total liabilities and net worth', () => {
    state.accounts = [
      account({ accountId: 'a', kind: 'ASSET', balances: [{ date: '2026-09-01', pence: 500000 }] }),
      account({ accountId: 'b', kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 100000 }] }),
    ];
    renderPage();
    expect(screen.getByText('£5,000.00')).toBeInTheDocument();
    expect(screen.getByText('£1,000.00')).toBeInTheDocument();
    expect(screen.getByText('£4,000.00')).toBeInTheDocument();
  });

  it('groups accounts under Assets and Liabilities, omitting an empty group', () => {
    state.accounts = [account({ accountId: 'a', kind: 'ASSET' })];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Liabilities' })).not.toBeInTheDocument();
  });

  it('shows an empty state with no accounts', () => {
    renderPage();
    expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  });

  it('creates a new account with the type scoped to the chosen kind', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Name'), 'Trading 212');
    await user.click(screen.getByLabelText('Kind', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Liability', hidden: true }));
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    expect(screen.queryByRole('option', { name: 'Cash', hidden: true })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'Loan', hidden: true }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Trading 212', kind: 'LIABILITY', type: 'LOAN' });
  });

  it('asks for confirmation before deleting, naming the account', async () => {
    state.accounts = [account({ name: 'Premium Bonds' })];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Actions for Premium Bonds' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete account' });
    expect(within(dialog).getByText("Delete Premium Bonds? This can't be undone.")).toBeInTheDocument();
    expect(state.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(state.remove).toHaveBeenCalledWith('acc-1');
  });

  it('opens the history sheet when a row is tapped, and the update sheet from its own button', async () => {
    state.accounts = [account()];
    const user = renderPageAsUser();
    await user.click(screen.getByRole('button', { name: 'Open Lloyds history' }));
    expect(await screen.findByRole('dialog', { name: 'Lloyds' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Lloyds' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Update Lloyds' }));
    expect(await screen.findByLabelText('Balance')).toBeInTheDocument();
  });
});
