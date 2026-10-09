import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const mockGetRuntimeConfig = vi.hoisted(() => vi.fn());
vi.mock('~/lib/runtimeConfig', () => ({ getRuntimeConfig: mockGetRuntimeConfig }));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children, domain }: { children: React.ReactNode; domain: string }) => <div data-testid="auth0" data-domain={domain}>{children}</div>,
  useAuth0: () => ({}),
}));
vi.mock('../LocalAuthProvider', () => ({ LocalAuthProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="local">{children}</div> }));

import { AuthProvider } from '../AuthProvider';

function renderProvider() {
  return render(<MantineProvider env="test"><AuthProvider><span>app</span></AuthProvider></MantineProvider>);
}

beforeEach(() => {
  mockGetRuntimeConfig.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AuthProvider', () => {
  it('wraps the app in Auth0 with the configured values', async () => {
    mockGetRuntimeConfig.mockResolvedValue({ auth: 'auth0', domain: 't.example.com', clientId: 'cid', audience: 'aud' });
    renderProvider();
    expect(await screen.findByTestId('auth0')).toHaveAttribute('data-domain', 't.example.com');
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('uses the local provider in local mode', async () => {
    mockGetRuntimeConfig.mockResolvedValue({ auth: 'local' });
    renderProvider();
    expect(await screen.findByTestId('local')).toBeInTheDocument();
  });

  it('shows a clear error, and no app, when the config cannot be loaded', async () => {
    mockGetRuntimeConfig.mockRejectedValue(new Error('config.json could not be loaded (404)'));
    renderProvider();
    expect(await screen.findByText(/could not start/i)).toBeInTheDocument();
    expect(screen.queryByText('app')).not.toBeInTheDocument();
  });
});
