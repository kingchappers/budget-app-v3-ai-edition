import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';
import { LaunchOffer } from '../LaunchOffer';

function renderOffer(entryCount: number) {
  return render(<MantineProvider><LaunchOffer entryCount={entryCount} /></MantineProvider>);
}

beforeEach(() => window.localStorage.clear());

describe('LaunchOffer', () => {
  it('waits until there have been a few entries', () => {
    renderOffer(2);
    expect(screen.queryByText(/open as soon as/i)).not.toBeInTheDocument();
  });

  it('turns on opening Add at launch when accepted, and does not ask again', async () => {
    const user = userEvent.setup();
    const { unmount } = renderOffer(3);

    await user.click(screen.getByRole('button', { name: 'Yes, open Add' }));

    expect(readPreferences(window.localStorage)).toMatchObject({ openAddOnLaunch: true, launchOfferAnswered: true });
    unmount();
    renderOffer(10);
    expect(screen.queryByText(/open as soon as/i)).not.toBeInTheDocument();
  });

  it('leaves the setting alone and never asks again when declined', async () => {
    const user = userEvent.setup();
    renderOffer(5);

    await user.click(screen.getByRole('button', { name: 'No thanks' }));

    expect(readPreferences(window.localStorage)).toMatchObject({ openAddOnLaunch: false, launchOfferAnswered: true });
    expect(screen.queryByText(/open as soon as/i)).not.toBeInTheDocument();
  });

  it('is not shown to someone who already opens Add at launch', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ openAddOnLaunch: true }));
    renderOffer(9);
    expect(screen.queryByText(/open as soon as/i)).not.toBeInTheDocument();
  });
});
