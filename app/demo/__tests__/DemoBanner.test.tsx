import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import DemoBanner from '../DemoBanner';
import { demoControls } from '../controls';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderBanner = () => render(<MantineProvider env="test"><DemoBanner /></MantineProvider>);

describe('DemoBanner', () => {
  it('says the data stays in the tab and asks for no real details', () => {
    renderBanner();
    expect(screen.getByRole('region', { name: 'Demo notice' })).toHaveTextContent(/vanish when you reload/i);
    expect(screen.getByRole('region', { name: 'Demo notice' })).toHaveTextContent(/real financial details/i);
  });

  it('resets the demo and reloads the page when the button is pressed', async () => {
    const reset = vi.spyOn(demoControls, 'reset').mockResolvedValue(undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the reset fails, and says so', async () => {
    vi.spyOn(demoControls, 'reset').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reset/i);
    expect(reload).not.toHaveBeenCalled();
  });
});
