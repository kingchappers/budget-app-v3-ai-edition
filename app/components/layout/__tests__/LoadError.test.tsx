import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { LoadError } from '../LoadError';

function renderError(onRetry = vi.fn()) {
  render(<MantineProvider><LoadError thing="transactions" onRetry={onRetry} /></MantineProvider>);
  return onRetry;
}

describe('LoadError', () => {
  it('says what failed, that nothing was lost, and what to do next', () => {
    renderError();
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your transactions");
    expect(screen.getByText('Nothing has been lost. Check your connection and try again.')).toBeInTheDocument();
  });

  it('retries when Try again is pressed', async () => {
    const onRetry = renderError();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
