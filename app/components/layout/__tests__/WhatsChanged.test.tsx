import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';
import { WhatsChanged, type ReleaseNote } from '../WhatsChanged';

const menu: ReleaseNote = { key: 'menu-2026-10', text: 'The menu has changed.' };
const names: ReleaseNote = { key: 'names-2026-10', text: 'Some names have changed.' };

function renderNotes(notes: ReleaseNote[] = [menu], isNewUser = false) {
  return render(
    <MantineProvider>
      <WhatsChanged notes={notes} isNewUser={isNewUser} />
    </MantineProvider>,
  );
}

beforeEach(() => window.localStorage.clear());

describe('WhatsChanged', () => {
  it('shows the note in plain words', () => {
    renderNotes();
    expect(screen.getByRole('region', { name: "What's changed" })).toHaveTextContent('The menu has changed.');
  });

  it('puts several notes in one card with one button', () => {
    renderNotes([menu, names]);
    expect(screen.getAllByRole('region', { name: "What's changed" })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Got it' })).toHaveLength(1);
    expect(screen.getByText('The menu has changed.')).toBeInTheDocument();
    expect(screen.getByText('Some names have changed.')).toBeInTheDocument();
  });

  it('goes away when dismissed, and stays away after a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNotes([menu, names]);

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
    expect(readPreferences(window.localStorage).seenReleases).toEqual(['menu-2026-10', 'names-2026-10']);
    unmount();

    renderNotes([menu, names]);
    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
  });

  it('shows only the note that is new, keeping the old one dismissed', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNotes([menu]);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    unmount();

    renderNotes([menu, names]);
    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
    expect(screen.getByText('Some names have changed.')).toBeInTheDocument();
  });

  it('is not shown to someone who has never used the app, and is marked as seen for them', () => {
    renderNotes([menu, names], true);
    expect(screen.queryByRole('region', { name: "What's changed" })).not.toBeInTheDocument();
    expect(readPreferences(window.localStorage).seenReleases).toEqual(['menu-2026-10', 'names-2026-10']);
  });

  it('can be used from the keyboard', async () => {
    const user = userEvent.setup();
    renderNotes();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByText('The menu has changed.')).not.toBeInTheDocument();
  });
});
