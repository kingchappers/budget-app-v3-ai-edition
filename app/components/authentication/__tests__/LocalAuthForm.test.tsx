import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LocalAuthForm } from '../LocalAuthForm';

function renderForm(props: { setupRequired: boolean; recoveryOpen?: boolean; onLogin?: any; onSetup?: any; onRecover?: any }) {
  return render(
    <MantineProvider env="test">
      <LocalAuthForm
        setupRequired={props.setupRequired}
        recoveryOpen={props.recoveryOpen}
        onLogin={props.onLogin ?? vi.fn()}
        onSetup={props.onSetup ?? vi.fn()}
        onRecover={props.onRecover ?? vi.fn()}
      />
    </MantineProvider>,
  );
}

describe('LocalAuthForm', () => {
  it('shows email and password only when signing in', () => {
    renderForm({ setupRequired: false });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Setup code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks for the setup code on first run, and says where to find it', () => {
    renderForm({ setupRequired: true });
    expect(screen.getByLabelText('Setup code')).toBeInTheDocument();
    expect(screen.getByText(/SETUP_CODE\.txt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('submits the login fields', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: false, onLogin });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('me@example.com', 'a long enough password'));
  });

  it('submits the setup fields', async () => {
    const onSetup = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: true, onSetup });
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(onSetup).toHaveBeenCalledWith({ code: 'abc123', email: 'me@example.com', password: 'a long enough password' }));
  });

  it('shows the server message when it fails, without clearing the email', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('Invalid email or password'));
    renderForm({ setupRequired: false, onLogin });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong password here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com');
  });

  it('says every field is required', () => {
    renderForm({ setupRequired: false });
    expect(screen.getByText('All fields are required.')).toBeInTheDocument();
  });

  it('does not create an account with a password that is too short', () => {
    const onSetup = vi.fn();
    renderForm({ setupRequired: true, onSetup });
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 12 characters');
    expect(onSetup).not.toHaveBeenCalled();
  });

  it('still submits a short password when signing in', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: false, onLogin });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('me@example.com', 'short'));
  });

  it('tells a first-run user where the code is without naming Docker', () => {
    renderForm({ setupRequired: true });
    expect(screen.getByText(/host's logs/i)).toBeInTheDocument();
    expect(screen.queryByText(/docker/i)).not.toBeInTheDocument();
  });

  it('offers a forgot-your-password link on the sign-in form only', () => {
    const { unmount } = renderForm({ setupRequired: false });
    expect(screen.getByRole('link', { name: /how to reset it/i })).toHaveAttribute('href', expect.stringContaining('SELF-HOSTING.md#forgot-your-password'));
    unmount();
    renderForm({ setupRequired: true });
    expect(screen.queryByRole('link', { name: /how to reset it/i })).not.toBeInTheDocument();
  });

  it('shows only the code and a new password while recovery is open, and submits them', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: false, recoveryOpen: true, onRecover });
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: ' abc123 ' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(onRecover).toHaveBeenCalledWith({ code: 'abc123', password: 'a long enough password' }));
  });

  it('does not submit a too-short new password during recovery', () => {
    const onRecover = vi.fn();
    renderForm({ setupRequired: false, recoveryOpen: true, onRecover });
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 12 characters');
    expect(onRecover).not.toHaveBeenCalled();
  });
});
