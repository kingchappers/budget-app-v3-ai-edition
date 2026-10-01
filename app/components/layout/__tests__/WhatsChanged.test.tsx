import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';
import { WhatsChanged } from '../WhatsChanged';

function renderNote(releaseKey = 'menu-2026-10') {
  return render(
    <MantineProvider>
      <WhatsChanged releaseKey={releaseKey}>The menu has changed.</WhatsChanged>
    </MantineProvider>,
  );
}

beforeEach(() => window.localStorage.clear());

describe('WhatsChanged', () => {
  it('shows the note in plain words', () => {
    renderNote();
    expect(screen.getByRole('region', { name: "What's changed" })).toHaveTextContent('The menu has changed.');
  });

  it('goes away when dismissed, and stays away after a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNote();

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
    expect(readPreferences(window.localStorage).seenReleases).toEqual(['menu-2026-10']);
    unmount();

    renderNote();
    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
  });

  it('shows again for a new release key, keeping the old one dismissed', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNote('one');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    unmount();

    renderNote('two');
    expect(screen.getByText('The menu has changed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(readPreferences(window.localStorage).seenReleases).toEqual(['one', 'two']);
  });

  it('can be used from the keyboard', async () => {
    const user = userEvent.setup();
    renderNote();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
  });

  it('starts unseen for a person who has stored nothing', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ shortcutN: false }));
    renderNote();
    expect(screen.getByText('The menu has changed.')).toBeInTheDocument();
  });
});
