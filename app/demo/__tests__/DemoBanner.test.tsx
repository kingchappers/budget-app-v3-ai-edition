import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import DemoBanner from '../DemoBanner';

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderBanner = () => render(<MantineProvider env="test"><DemoBanner /></MantineProvider>);

describe('DemoBanner', () => {
  it('names the app, says the data stays in the tab and asks for no real details', () => {
    renderBanner();
    const notice = screen.getByRole('region', { name: 'Demo notice' });
    expect(notice).toHaveTextContent(/Hoardwise demo/);
    expect(notice).toHaveTextContent(/vanish when you reload/i);
    expect(notice).toHaveTextContent(/real financial details/i);
  });

  it('reloads the page to reset the demo', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
