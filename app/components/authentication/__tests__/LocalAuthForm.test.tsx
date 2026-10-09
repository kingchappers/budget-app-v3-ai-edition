import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LocalAuthForm } from '../LocalAuthForm';

function renderForm(props: { setupRequired: boolean; onLogin?: any; onSetup?: any }) {
  return render(
    <MantineProvider env="test">
      <LocalAuthForm setupRequired={props.setupRequired} onLogin={props.onLogin ?? vi.fn()} onSetup={props.onSetup ?? vi.fn()} />
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
    expect(screen.getByText(/server log/i)).toBeInTheDocument();
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

  it('does not submit a password that is too short', () => {
    const onLogin = vi.fn();
    renderForm({ setupRequired: true, onSetup: onLogin });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 12/)).toBeInTheDocument();
  });
});
