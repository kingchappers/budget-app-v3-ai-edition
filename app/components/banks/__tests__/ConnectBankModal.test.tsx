import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

const connect = { mutateAsync: vi.fn(), isPending: false };

vi.mock('~/lib/queries', () => ({
  useConnectBank: () => connect,
}));
vi.mock('~/lib/bankCallback', () => ({
  stashBankCallback: vi.fn(),
}));

import { ConnectBankModal } from '../ConnectBankModal';
import { stashBankCallback } from '~/lib/bankCallback';
import { todayIso } from '~/lib/months';

function renderModal(props: Partial<Parameters<typeof ConnectBankModal>[0]> = {}) {
  const redirect = vi.fn();
  render(
    <MantineProvider>
      <ConnectBankModal opened onClose={() => {}} redirect={redirect} {...props} />
    </MantineProvider>,
  );
  return { redirect };
}

describe('ConnectBankModal', () => {
  beforeEach(() => {
    connect.mutateAsync.mockReset().mockResolvedValue({ url: 'https://truelayer.com/connect/x', state: 'state-1' });
    vi.mocked(stashBankCallback).mockReset();
  });

  it('starts the connection from today by default, stashes state, and redirects to the bank', async () => {
    const user = userEvent.setup();
    const { redirect } = renderModal();
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://truelayer.com/connect/x'));
    expect(connect.mutateAsync).toHaveBeenCalledWith({ startDate: todayIso() });
    expect(stashBankCallback).toHaveBeenCalledWith(window.sessionStorage, { state: 'state-1' });
    // stash must happen before redirect
    const stashOrder = vi.mocked(stashBankCallback).mock.invocationCallOrder[0];
    const redirectOrder = redirect.mock.invocationCallOrder[0];
    expect(stashOrder).toBeLessThan(redirectOrder);
  });

  it('renders a start-date picker defaulted to today', () => {
    renderModal();
    const input = screen.getByLabelText(/import transactions from/i) as HTMLInputElement;
    const [year, month, day] = todayIso().split('-');
    expect(input.value).toBe(`${day}/${month}/${year}`);
  });

  it('shows an error when the connection cannot start', async () => {
    connect.mutateAsync.mockRejectedValueOnce(new Error('502'));
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /connect/i }));
    expect(await screen.findByText('Could not start the bank connection. Please try again.')).toBeInTheDocument();
  });

  it('closes via the cancel button without connecting', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(connect.mutateAsync).not.toHaveBeenCalled();
  });
});
