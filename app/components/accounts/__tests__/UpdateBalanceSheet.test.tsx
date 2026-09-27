import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { UpdateBalanceSheet } from '../UpdateBalanceSheet';
import type { Account } from '~/lib/types';

const save = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('~/lib/queries', () => ({ useAddBalance: () => ({ mutate: save.mutate, isPending: false }) }));

const account: Account = { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '' };

function renderSheet(data: Account | null = account) {
  const onClose = vi.fn();
  render(<MantineProvider><UpdateBalanceSheet account={data} onClose={onClose} /></MantineProvider>);
  return onClose;
}

beforeEach(() => { save.mutate.mockReset(); });

describe('UpdateBalanceSheet', () => {
  it('renders nothing without an account', () => {
    renderSheet(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults the date to today', () => {
    renderSheet();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toEqual(expect.stringContaining('/'));
  });

  it('saves the entered amount and date', async () => {
    const user = userEvent.setup();
    const onClose = renderSheet();
    await user.type(screen.getByLabelText('Balance'), '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(save.mutate).toHaveBeenCalledWith(
      { accountId: 'acc-1', input: { date: expect.any(String), pence: 250000 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    save.mutate.mock.calls[0][1].onSuccess();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and does not save for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText('Balance'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an error when the save fails', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText('Balance'), '100');
    save.mutate.mockImplementation((_vars, options) => options.onError(new Error('boom')));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
