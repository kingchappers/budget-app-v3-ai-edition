import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ConnectionCard } from '../ConnectionCard';
import type { BankConnection } from '~/lib/types';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

const connection: BankConnection = {
  connectionId: 'c1',
  provider: 'truelayer',
  displayName: 'Lloyds Bank',
  status: 'EXPIRED',
  consecutiveFailures: 0,
  createdAt: 't',
  updatedAt: 't',
  needsAttention: true,
  accounts: [
    {
      accountUid: 'a1',
      dedupeId: 'a1',
      displayName: 'Current Account',
      last4: '1234',
      currency: 'GBP',
      startDate: '2026-09-01',
      lastSyncedAt: '2026-09-13T09:00:00.000Z',
    },
  ],
};

describe('ConnectionCard', () => {
  it('shows bank, accounts, status and sync age', () => {
    render(
      <MantineProvider>
        <ConnectionCard connection={connection} nowMs={NOW} onReconnect={() => {}} onDisconnect={() => {}} />
      </MantineProvider>,
    );
    expect(screen.getByText('Lloyds Bank')).toBeInTheDocument();
    expect(screen.getByText('Current Account ••1234')).toBeInTheDocument();
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.getByText('Synced 3h ago')).toBeInTheDocument();
  });

  it('calls the reconnect handler and confirms before disconnecting', async () => {
    const onReconnect = vi.fn();
    const onDisconnect = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ConnectionCard connection={connection} nowMs={NOW} onReconnect={onReconnect} onDisconnect={onDisconnect} />
      </MantineProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(await screen.findByText(/fully revoke access/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Confirm disconnect' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
