import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { SaveStatus, type SaveState } from '../SaveStatus';

function renderStatus(state: SaveState, onRetry = vi.fn()) {
  render(<MantineProvider><SaveStatus state={state} onRetry={onRetry} /></MantineProvider>);
  return onRetry;
}

describe('SaveStatus', () => {
  it('renders an empty polite status region when idle', () => {
    renderStatus('idle');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows Saving… while the request is in flight', () => {
    renderStatus('saving');
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('shows Saved once the server confirms', () => {
    renderStatus('saved');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('shows the failure with a Retry button that calls back', async () => {
    const onRetry = renderStatus('error');
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't save.");
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
