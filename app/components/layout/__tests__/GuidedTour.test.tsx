import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { PREFERENCES_KEY, TOUR_SCREENS, readPreferences } from '~/lib/preferences';

const history = vi.hoisted(() => ({ value: { isSuccess: true, data: [] as unknown[] } }));

vi.mock('~/lib/queries', () => ({ useTransactionsRange: () => history.value }));

import { GuidedTour } from '../GuidedTour';

function renderTour(url = '/') {
  return render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={[url]}><GuidedTour /></MemoryRouter>
    </MantineProvider>,
  );
}

function savedStep(): number {
  return readPreferences(window.localStorage).tourStep;
}

beforeEach(() => {
  window.localStorage.clear();
  history.value = { isSuccess: true, data: [] };
});

describe('GuidedTour', () => {
  it('opens on the first screen for someone with no transactions', async () => {
    renderTour();
    expect(await screen.findByText('What a budget is')).toBeInTheDocument();
    expect(screen.getByText(`Step 1 of ${TOUR_SCREENS}`)).toBeInTheDocument();
  });

  it('stays away from someone who already has transactions', () => {
    history.value = { isSuccess: true, data: [{}] };
    renderTour();
    expect(screen.queryByText('What a budget is')).not.toBeInTheDocument();
  });

  it('waits until the history has loaded', () => {
    history.value = { isSuccess: false, data: undefined as unknown as unknown[] };
    renderTour();
    expect(screen.queryByText('What a budget is')).not.toBeInTheDocument();
  });

  it('walks through all three screens and then stays finished', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTour();

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('What pots are for')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('How recurring bills remind you')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(savedStep()).toBe(TOUR_SCREENS);
    unmount();
    renderTour();
    expect(screen.queryByText('What a budget is')).not.toBeInTheDocument();
  });

  it('resumes where it was left', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ tourStep: 1 }));
    renderTour();
    expect(await screen.findByText('What pots are for')).toBeInTheDocument();
    expect(screen.getByText(`Step 2 of ${TOUR_SCREENS}`)).toBeInTheDocument();
  });

  it('can be skipped, and does not come back', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTour();
    await user.click(await screen.findByRole('button', { name: 'Skip' }));

    expect(savedStep()).toBe(TOUR_SCREENS);
    unmount();
    renderTour();
    expect(screen.queryByText('What a budget is')).not.toBeInTheDocument();
  });

  it('counts closing it with Escape as skipping', async () => {
    const user = userEvent.setup();
    renderTour();
    await screen.findByText('What a budget is');
    await user.keyboard('{Escape}');
    expect(savedStep()).toBe(TOUR_SCREENS);
  });

  it('plays again when replayed, even with transactions', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ tourStep: 0 }));
    history.value = { isSuccess: true, data: [{}] };
    renderTour('/?tour=1');
    expect(await screen.findByText('What a budget is')).toBeInTheDocument();
  });
});
