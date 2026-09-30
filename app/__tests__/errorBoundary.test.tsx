import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ErrorBoundary } from '../root';

type Props = React.ComponentProps<typeof ErrorBoundary>;

const notFound = { status: 404, statusText: 'Not Found', data: '', internal: true } as unknown as Props['error'];
const serverError = { status: 500, statusText: 'Server Error', data: '', internal: true } as unknown as Props['error'];

function renderBoundary(error: Props['error']) {
  render(<MantineProvider><ErrorBoundary error={error} {...({} as Omit<Props, 'error'>)} /></MantineProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('ErrorBoundary', () => {
  it('says it could not find the page and offers Home, without "Oops"', () => {
    renderBoundary(notFound);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("We couldn't find that page");
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByText(/Oops/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('says data is safe for any other error and offers Reload and Home', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderBoundary(serverError);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Something didn't load. Your data is safe.");
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('never shows raw error text to the user outside development', () => {
    vi.stubEnv('DEV', false);
    renderBoundary(new Error('token abc123 leaked'));
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
  });

  it('shows the stack in development to help whoever is fixing it', () => {
    vi.stubEnv('DEV', true);
    renderBoundary(new Error('token abc123 leaked'));
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
});
