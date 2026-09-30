import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/lib/queries', () => ({ useApi: () => ({}) }));

import Settings from '../settings';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from '~/lib/preferences';

function renderSettings() {
  return render(
    <MantineProvider env="test">
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Settings page', () => {
  it('has a Settings heading', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the N shortcut switch on by default and saves it when turned off', async () => {
    renderSettings();
    const toggle = screen.getByRole('switch', { name: /^Press N to add a transaction/ });
    expect(toggle).toBeChecked();

    await userEvent.setup().click(toggle);

    expect(screen.getByRole('switch', { name: /^Press N to add a transaction/ })).not.toBeChecked();
    expect(readPreferences(window.localStorage).shortcutN).toBe(false);
  });

  it('shows the launch switch off by default and saves it when turned on', async () => {
    renderSettings();
    const toggle = screen.getByRole('switch', { name: /^Open Add sheet when the installed app starts/ });
    expect(toggle).not.toBeChecked();

    await userEvent.setup().click(toggle);

    expect(screen.getByRole('switch', { name: /^Open Add sheet when the installed app starts/ })).toBeChecked();
    expect(readPreferences(window.localStorage).openAddOnLaunch).toBe(true);
  });

  it('reflects preferences saved earlier', () => {
    writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: true });
    renderSettings();
    expect(screen.getByRole('switch', { name: /^Press N to add a transaction/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /^Open Add sheet when the installed app starts/ })).toBeChecked();
  });

  it('has a Reminders section with bill reminders off', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Reminders' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /^Remind me about bills/ })).not.toBeChecked();
  });
});
