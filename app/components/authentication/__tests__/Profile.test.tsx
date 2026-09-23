import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    user: { name: 'Sam Tester', email: 'sam@example.com', picture: '' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

import { Profile } from '../Profile';
import { OPEN_ON_LAUNCH_KEY } from '~/lib/launchIntent';

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
