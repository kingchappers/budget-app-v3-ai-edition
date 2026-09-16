import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

const auth0 = { isLoading: false, isAuthenticated: true, loginWithRedirect: vi.fn() };
const complete = { mutateAsync: vi.fn() };
const clear = { mutate: vi.fn() };
const navigate = vi.fn();

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));
vi.mock('~/lib/queries', () => ({
  useCompleteBankCallback: () => complete,
  useClearBankAuth: () => clear,
}));
vi.mock('react-router', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

import { BankCallback } from '../BankCallback';

function renderAt(search: string) {
  window.history.pushState({}, '', `/banks/callback${search}`);
  return render(
    <StrictMode>
      <MemoryRouter>
        <MantineProvider>
          <BankCallback storage={window.sessionStorage} />
        </MantineProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe('BankCallback', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    auth0.isLoading = false;
    auth0.isAuthenticated = true;
    auth0.loginWithRedirect.mockReset();
    complete.mutateAsync.mockReset().mockResolvedValue({ status: 'READY', connection: {} });
    clear.mutate.mockReset();
    navigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes the connection exactly once and returns to banks when already ready', async () => {
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    renderAt('');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/banks', { replace: true }));
    expect(complete.mutateAsync).toHaveBeenCalledTimes(1);
    expect(complete.mutateAsync).toHaveBeenCalledWith('s1');
  });

  it('removes any query params from the address bar', async () => {
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    renderAt('?state=s1');
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('stashes state and logs in when the session has expired', async () => {
    // The state was stashed before the user ever left for the bank; if the
    // Auth0 session has since expired we need it to survive a login redirect too.
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    auth0.isAuthenticated = false;
    renderAt('');
    await waitFor(() => expect(auth0.loginWithRedirect).toHaveBeenCalledWith({ appState: { returnTo: '/banks/callback' } }));
    expect(window.sessionStorage.getItem('budget.bankCallback')).toContain('s1');
    expect(complete.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows an error when there is no stashed state to resume', async () => {
    renderAt('');
    expect(await screen.findByText('Start the bank connection again from the Banks page.')).toBeInTheDocument();
    expect(complete.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the bank error as text', async () => {
    renderAt('?error=access_denied&error_description=%3Cb%3EUser%20cancelled%3C%2Fb%3E');
    expect(await screen.findByText('<b>User cancelled</b>')).toBeInTheDocument();
    expect(complete.mutateAsync).not.toHaveBeenCalled();
  });

  it('polls again while the connection is pending, then completes on ready', async () => {
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    complete.mutateAsync
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'READY', connection: {} });

    renderAt('');

    await waitFor(() => expect(complete.mutateAsync).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(complete.mutateAsync).toHaveBeenCalledTimes(2), { timeout: 3000, interval: 50 });
    await vi.waitFor(() => expect(complete.mutateAsync).toHaveBeenCalledTimes(3), { timeout: 3000, interval: 50 });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/banks', { replace: true }));
  });

  it('gives up after the poll times out and shows an error with retry', async () => {
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    complete.mutateAsync.mockResolvedValue({ status: 'PENDING' });

    renderAt('');

    await waitFor(
      () => expect(screen.getByText('This is taking longer than expected. Please try again shortly.')).toBeInTheDocument(),
      { timeout: 6000 },
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  }, 8000);

  it('explains an expired attempt', async () => {
    const { ApiError } = await import('~/lib/apiError');
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    complete.mutateAsync.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    renderAt('');
    expect(await screen.findByText('This connection attempt has expired. Please start again.')).toBeInTheDocument();
  });

  it('shows a generic failure message and allows retry for other errors', async () => {
    const { ApiError } = await import('~/lib/apiError');
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ state: 's1' }));
    complete.mutateAsync.mockRejectedValueOnce(new ApiError(500, 'Server Error'));
    renderAt('');
    expect(await screen.findByText('We could not finish connecting your bank. Please try again.')).toBeInTheDocument();
  });
});
