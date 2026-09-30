import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const mockUseAuth0 = vi.hoisted(() => vi.fn());
vi.mock('@auth0/auth0-react', () => ({ useAuth0: mockUseAuth0 }));
vi.mock('../Profile', () => ({ Profile: () => <div>Profile menu</div> }));

import Authentication from '../Authentication';

function renderAuthentication() {
  return render(
    <MantineProvider env="test">
      <Authentication />
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Authentication', () => {
  it('offers Sign in when signed out', () => {
    mockUseAuth0.mockReturnValue({ isAuthenticated: false, isLoading: false, error: undefined, loginWithRedirect: vi.fn() });
    renderAuthentication();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the profile menu when signed in', () => {
    mockUseAuth0.mockReturnValue({ isAuthenticated: true, isLoading: false, error: undefined, loginWithRedirect: vi.fn() });
    renderAuthentication();
    expect(screen.getByText('Profile menu')).toBeInTheDocument();
  });

  it('offers Sign in after an Auth0 error without showing the raw error or alarm copy', () => {
    const error = Object.assign(new Error('Invalid state: raw provider detail'), { error: 'invalid_state' });
    mockUseAuth0.mockReturnValue({ isAuthenticated: false, isLoading: false, error, loginWithRedirect: vi.fn() });

    renderAuthentication();

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/raw provider detail/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Oops/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('Authentication: Auth0 reported an error', error);
  });
});
