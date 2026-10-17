import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const show = vi.hoisted(() => vi.fn());
vi.mock('@mantine/notifications', () => ({ notifications: { show } }));

import { LocalAuthProvider } from '../LocalAuthProvider';
import { useAuth } from '~/lib/auth';
import { expireLocalSession, resetLocalAuthForTests } from '~/lib/localAuth';

const fetchMock = vi.fn();
const assign = vi.fn();

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function Probe() {
  const { login, logout } = useAuth();
  return (
    <>
      <button onClick={login}>open</button>
      <button onClick={() => void logout()}>out</button>
    </>
  );
}

function renderProvider() {
  return render(<MantineProvider env="test"><LocalAuthProvider><Probe /></LocalAuthProvider></MantineProvider>);
}

beforeEach(() => {
  resetLocalAuthForTests();
  fetchMock.mockReset();
  show.mockReset();
  assign.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { ...window.location, assign });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LocalAuthProvider', () => {
  it('does not reopen the sign-in form when the session later expires', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: false }))
      .mockResolvedValueOnce(reply(401, {})) // opening the form re-checks the status
      .mockResolvedValueOnce(reply(200, { setupRequired: false }))
      .mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }))
      .mockResolvedValueOnce(reply(401, {})) // the expiry re-checks the status
      .mockResolvedValueOnce(reply(200, { setupRequired: false }));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByText('open'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => expireLocalSession());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the recovery form when recovery opened after the page loaded', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: false, recoveryOpen: false }))
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: false, recoveryOpen: true }));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByText('open'));
    expect(await screen.findByLabelText('Recovery code')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Set a new password' })).toBeInTheDocument();
  });

  it('titles the dialog for first-run setup and for plain sign in', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: true, recoveryOpen: false }))
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: true, recoveryOpen: false }));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByText('open'));
    expect(await screen.findByRole('dialog', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('titles the dialog Sign in when an account exists and recovery is closed', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: false, recoveryOpen: false }))
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { setupRequired: false, recoveryOpen: false }));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByText('open'));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('stays put and tells the user when sign out fails', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }))
      .mockResolvedValueOnce(reply(500, { error: 'Server error' }));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('out'));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not sign out. Please try again.' })));
    expect(assign).not.toHaveBeenCalled();
  });

  it('stays put and tells the user when sign out cannot reach the server', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('out'));
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
  });

  it('goes to the start page after a successful sign out', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }))
      .mockResolvedValueOnce(reply(200, {}));
    renderProvider();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('out'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(show).not.toHaveBeenCalled();
  });
});
