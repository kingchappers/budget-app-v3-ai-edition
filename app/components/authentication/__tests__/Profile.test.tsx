import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

const mockUseAuth0 = vi.hoisted(() => vi.fn());
vi.mock('@auth0/auth0-react', () => ({ useAuth0: mockUseAuth0 }));

import { Profile } from '../Profile';

function mockAuthedUser(overrides: Partial<{ name: string; email: string; picture: string }> = {}) {
  mockUseAuth0.mockReturnValue({
    user: { name: 'Sam Tester', email: 'sam@example.com', picture: '', ...overrides },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  });
}

async function openMenu(): Promise<void> {
  const user = userEvent.setup();
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </MantineProvider>,
  );
  await user.click(screen.getByText('Sam Tester'));
}

beforeEach(() => {
  window.localStorage.clear();
  mockAuthedUser();
});

describe('Profile menu', () => {
  it('links to the Settings page', async () => {
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('no longer holds settings or an unclear label itself', async () => {
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Settings' });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText('Application')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Profile' })).not.toBeInTheDocument();
  });
});

describe('Profile avatar', () => {
  it('shows the profile picture when Auth0 has one', () => {
    mockAuthedUser({ picture: 'https://example.com/avatar.png' });
    render(
      <MantineProvider env="test">
        <Profile />
      </MantineProvider>,
    );

    expect(screen.getByRole('img', { name: 'Sam Tester' })).toHaveAttribute('src', 'https://example.com/avatar.png');
  });

  it('falls back to an initials avatar when Auth0 has no picture', () => {
    mockAuthedUser({ picture: '' });
    render(
      <MantineProvider env="test">
        <Profile />
      </MantineProvider>,
    );

    expect(screen.queryByRole('img', { name: 'Sam Tester' })).not.toBeInTheDocument();
    expect(screen.getByText('ST')).toBeInTheDocument();
  });
});
