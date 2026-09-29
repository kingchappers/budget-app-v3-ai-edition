import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

const mockUseAuth0 = vi.hoisted(() => vi.fn());
vi.mock('@auth0/auth0-react', () => ({ useAuth0: mockUseAuth0 }));

import { Profile } from '../Profile';
import { OPEN_ON_LAUNCH_KEY } from '~/lib/launchIntent';

function mockAuthedUser(overrides: Partial<{ name: string; email: string; picture: string }> = {}) {
  mockUseAuth0.mockReturnValue({
    user: { name: 'Sam Tester', email: 'sam@example.com', picture: '', ...overrides },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  });
}

async function openMenu() {
  const user = userEvent.setup();
  render(
    <MantineProvider env="test">
      <Profile />
    </MantineProvider>,
  );
  await user.click(screen.getByText('Sam Tester'));
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  mockAuthedUser();
});

describe('Profile launch toggle', () => {
  it('offers an off-by-default switch with a hint', async () => {
    await openMenu();

    const toggle = await screen.findByRole('switch', { name: /open add sheet on launch/i });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Installed app only')).toBeInTheDocument();
  });

  it('turns on, persists, and keeps the menu open', async () => {
    const user = await openMenu();

    await user.click(await screen.findByRole('switch', { name: /open add sheet on launch/i }));

    expect(screen.getByRole('switch', { name: /open add sheet on launch/i })).toBeChecked();
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBe('1');
  });

  it('starts on when it was saved on, and turns off again', async () => {
    window.localStorage.setItem(OPEN_ON_LAUNCH_KEY, '1');
    const user = await openMenu();

    const toggle = await screen.findByRole('switch', { name: /open add sheet on launch/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(screen.getByRole('switch', { name: /open add sheet on launch/i })).not.toBeChecked();
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBeNull();
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
