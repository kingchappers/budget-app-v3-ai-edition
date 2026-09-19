import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QuickEntryTips } from '../QuickEntryTips';

function renderTips() {
  render(
    <MantineProvider>
      <QuickEntryTips />
    </MantineProvider>,
  );
}

describe('QuickEntryTips', () => {
  it('opens a tips dialog from an accessible button', async () => {
    const user = userEvent.setup();
    renderTips();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));

    expect(await screen.findByRole('dialog', { name: 'Quick entry tips' })).toBeInTheDocument();
  });

  it('describes each quick-entry option', async () => {
    const user = userEvent.setup();
    renderTips();

    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quick entry tips' });

    expect(within(dialog).getByText(/opens Add transaction/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Quick add:')).toBeInTheDocument();
    expect(within(dialog).getByText(/start the amount with \+ for income/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Remembered categories:')).toBeInTheDocument();
    expect(within(dialog).getByText('Save & add another:')).toBeInTheDocument();
    expect(within(dialog).getByText('Duplicate:')).toBeInTheDocument();
  });

  it('closes again', async () => {
    const user = userEvent.setup();
    renderTips();

    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    await screen.findByRole('dialog', { name: 'Quick entry tips' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
