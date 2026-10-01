import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ResponsiveSheet } from '../ResponsiveSheet';

function renderSheet(opened = true, onClose: () => void = () => {}) {
  return render(
    <MantineProvider>
      <ResponsiveSheet opened={opened} onClose={onClose} title="Test sheet">
        <p>Sheet body</p>
      </ResponsiveSheet>
    </MantineProvider>,
  );
}

describe('ResponsiveSheet', () => {
  it('names its close button, whichever form the sheet takes', () => {
    const original = window.matchMedia;
    renderSheet();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    cleanup();

    window.matchMedia = ((query: string) => ({ ...original(query), matches: true })) as typeof window.matchMedia;
    try {
      renderSheet();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('is a bottom drawer on narrow screens', () => {
    renderSheet();
    expect(document.querySelector('.mantine-Drawer-root')).not.toBeNull();
    expect(document.querySelector('.mantine-Modal-root')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument();
    expect(screen.getByText('Sheet body')).toBeInTheDocument();
  });

  it('is a centred modal on wide screens', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: true })) as typeof window.matchMedia;
    try {
      renderSheet();
      expect(document.querySelector('.mantine-Modal-root')).not.toBeNull();
      expect(document.querySelector('.mantine-Drawer-root')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('renders nothing while closed', () => {
    renderSheet(false);
    expect(screen.queryByText('Sheet body')).not.toBeInTheDocument();
  });

  it('asks to close on Escape', async () => {
    const onClose = vi.fn();
    renderSheet(true, onClose);
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sizes the bottom drawer to its content instead of filling the screen', () => {
    renderSheet();
    const content = document.querySelector('.mantine-Drawer-content') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content).toHaveStyle({ height: 'auto', maxHeight: '90dvh' });
  });
});
