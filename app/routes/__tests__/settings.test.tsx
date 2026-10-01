import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Settings from '../settings';
import { TextSize } from '~/components/layout/TextSize';
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

  it('shows the Reduce motion switch off by default and saves it when turned on', async () => {
    renderSettings();
    const toggle = screen.getByRole('switch', { name: /^Reduce motion/ });
    expect(toggle).not.toBeChecked();

    await userEvent.setup().click(toggle);

    expect(screen.getByRole('switch', { name: /^Reduce motion/ })).toBeChecked();
    expect(readPreferences(window.localStorage).reduceMotion).toBe(true);
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

  it('keeps milestones off until they are switched on', async () => {
    renderSettings();
    const toggle = screen.getByRole('switch', { name: /^Show milestones/ });
    expect(toggle).not.toBeChecked();

    await userEvent.setup().click(toggle);

    expect(toggle).toBeChecked();
    expect(readPreferences(window.localStorage).showMilestones).toBe(true);
  });

  it('says what milestones are and what they are not', () => {
    renderSettings();
    expect(screen.getByText(/no streaks, sounds or animations/i)).toBeInTheDocument();
  });

  it('holds the pages that used to be in the More menu, one link each', () => {
    renderSettings();
    const manage = screen.getByRole('heading', { name: 'Manage' }).closest('.mantine-Card-root') as HTMLElement;
    const links = [...manage.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['CategoriesAdd, rename or remove spending and income categories.', '/categories'],
      ['AccountsBalances of your bank accounts, savings and debts.', '/accounts'],
      ['Recently deletedBring back something you removed.', '/deleted'],
      ['Catch upAdd what you remember from the last few weeks.', '/catch-up'],
    ]);
  });

  it('gives each link a 44px target', () => {
    renderSettings();
    screen.getByRole('link', { name: /^Categories/ });
    expect(screen.getByRole('link', { name: /^Categories/ })).toHaveStyle({ minHeight: '44px' });
  });

  describe('grouping', () => {
    it('groups the controls under Display, Messages, Keyboard and launch, and Manage, in that order', () => {
      renderSettings();
      const headings = screen.getAllByRole('heading', { level: 4 }).map(heading => heading.textContent);
      expect(headings).toEqual(['Display', 'Messages', 'Keyboard and launch', 'Manage']);
    });

    it('keeps to a handful of controls, each with a line of plain help', () => {
      renderSettings();
      const controls = [
        ...screen.getAllByRole('radiogroup'),
        ...screen.getAllByRole('switch'),
      ];
      expect(controls.length).toBeLessThanOrEqual(10);
      expect(screen.getByText('Makes text bigger everywhere. It changes straight away.')).toBeInTheDocument();
      expect(screen.getByText('Light, dark, or whichever your device is set to.')).toBeInTheDocument();
      expect(screen.getByText(/Saved, deleted and skipped messages/)).toBeInTheDocument();
    });
  });

  describe('text size', () => {
    it('starts at Standard', () => {
      renderSettings();
      expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
    });

    it.each([['Large', 'large'], ['Largest', 'largest']])('saves %s', async (label, value) => {
      renderSettings();
      await userEvent.setup().click(screen.getByRole('radio', { name: label }));
      expect(screen.getByRole('radio', { name: label })).toBeChecked();
      expect(readPreferences(window.localStorage).textSize).toBe(value);
    });

    it('comes back from the saved choice', () => {
      writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, textSize: 'largest' });
      renderSettings();
      expect(screen.getByRole('radio', { name: 'Largest' })).toBeChecked();
    });

    it('takes effect on the page straight away when the app applies it', async () => {
      document.documentElement.removeAttribute('data-text-size');
      render(
        <MantineProvider env="test">
          <MemoryRouter>
            <TextSize />
            <Settings />
          </MemoryRouter>
        </MantineProvider>,
      );
      await userEvent.setup().click(screen.getByRole('radio', { name: 'Large' }));
      expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
    });
  });

  describe('appearance', () => {
    it('offers Match my device, Light and Dark, starting on the device setting', () => {
      // The app starts on "auto"; the plain test provider would start on light.
      render(
        <MantineProvider env="test" defaultColorScheme="auto">
          <MemoryRouter>
            <Settings />
          </MemoryRouter>
        </MantineProvider>,
      );
      expect(screen.getAllByRole('radio', { name: /^(Match my device|Light|Dark)$/ }).map(radio => radio.getAttribute('value')))
        .toEqual(['auto', 'light', 'dark']);
      expect(screen.getByRole('radio', { name: 'Match my device' })).toBeChecked();
    });

    it('switches the page to dark and remembers it', async () => {
      renderSettings();
      await userEvent.setup().click(screen.getByRole('radio', { name: 'Dark' }));
      expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
      expect(window.localStorage.getItem('mantine-color-scheme-value')).toBe('dark');
    });
  });

  describe('undo messages', () => {
    it('defaults to until I close them', () => {
      renderSettings();
      expect(screen.getByRole('radio', { name: 'Until I close them' })).toBeChecked();
    });

    it.each([['30 seconds', '30s'], ['10 seconds', '10s'], ['Until I close them', 'until-closed']])('saves %s', async (label, value) => {
      writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, undoDuration: value === 'until-closed' ? '10s' : 'until-closed' });
      renderSettings();
      await userEvent.setup().click(screen.getByRole('radio', { name: label }));
      expect(readPreferences(window.localStorage).undoDuration).toBe(value);
    });

    it('says that errors always stay', () => {
      renderSettings();
      expect(screen.getByText(/Errors always stay until you close them/)).toBeInTheDocument();
    });
  });

  it('restarts the guided tour from the beginning', async () => {
    writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, tourStep: 3 });
    renderSettings();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Take the tour again' }));

    expect(readPreferences(window.localStorage).tourStep).toBe(0);
  });
});
