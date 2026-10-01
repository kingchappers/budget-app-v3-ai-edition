import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';
import { CollapsibleSection } from '../CollapsibleSection';

function renderSection() {
  return render(
    <MantineProvider>
      <CollapsibleSection id="trend" title="Monthly trend"><p>Trend details</p></CollapsibleSection>
    </MantineProvider>,
  );
}

beforeEach(() => window.localStorage.clear());

describe('CollapsibleSection', () => {
  it('starts closed, with its heading as a button that says so', () => {
    renderSection();
    const button = screen.getByRole('button', { name: 'Monthly trend' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Trend details')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monthly trend' })).toBeInTheDocument();
  });

  it('opens and closes from the keyboard', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Trend details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monthly trend' })).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(screen.queryByText('Trend details')).not.toBeInTheDocument();
  });

  it('remembers that it was left open', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Monthly trend' }));
    expect(readPreferences(window.localStorage).insightsOpenSections).toEqual(['trend']);
    unmount();

    renderSection();
    expect(screen.getByText('Trend details')).toBeInTheDocument();
  });

  it('forgets it once closed again', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ insightsOpenSections: ['trend', 'groups'] }));
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Monthly trend' }));
    expect(readPreferences(window.localStorage).insightsOpenSections).toEqual(['groups']);
  });

  it('has a 44px tall target', () => {
    renderSection();
    expect(screen.getByRole('button', { name: 'Monthly trend' })).toHaveStyle({ minHeight: '44px' });
  });
});
