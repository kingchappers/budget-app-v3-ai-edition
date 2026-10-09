import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockUseAuth0 = vi.hoisted(() => vi.fn());
vi.mock('@auth0/auth0-react', () => ({ useAuth0: mockUseAuth0 }));

import { LocalAuthContext, useAuth } from '../auth';
import type { AuthState } from '../auth';

const auth0 = (over: Record<string, unknown> = {}) => ({
  isAuthenticated: true, isLoading: false, error: undefined, user: { sub: 'auth0|1', email: 'a@b.c' },
  getAccessTokenSilently: vi.fn().mockResolvedValue('tok'), loginWithRedirect: vi.fn(), logout: vi.fn(), ...over,
});

describe('useAuth with Auth0', () => {
  it('adapts the Auth0 hook', async () => {
    const mocked = auth0();
    mockUseAuth0.mockReturnValue(mocked);
    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({ mode: 'auth0', isAuthenticated: true, isLoading: false, user: { sub: 'auth0|1' } });
    expect(await result.current.getToken()).toBe('tok');

    await result.current.login();
    expect(mocked.loginWithRedirect).toHaveBeenCalledTimes(1);

    await result.current.logout();
    expect(mocked.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });

  it('keeps getToken, login and logout stable across renders', () => {
    const mocked = auth0();
    mockUseAuth0.mockReturnValue(mocked);
    const { result, rerender } = renderHook(() => useAuth());
    const first = result.current;
    rerender();
    expect(result.current.getToken).toBe(first.getToken);
    expect(result.current.login).toBe(first.login);
    expect(result.current.logout).toBe(first.logout);
  });

  it('copes with a partial Auth0 mock, as the existing component tests supply', () => {
    mockUseAuth0.mockReturnValue({ getAccessTokenSilently: vi.fn() });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBeUndefined();
    expect(typeof result.current.getToken).toBe('function');
  });
});

describe('useAuth with the local provider', () => {
  it('prefers the local context over Auth0', async () => {
    mockUseAuth0.mockReturnValue(auth0());
    const local: AuthState = {
      mode: 'local', isAuthenticated: false, isLoading: false, user: undefined,
      login: vi.fn(), logout: vi.fn(), getToken: async () => undefined,
    };
    const wrapper = ({ children }: { children: ReactNode }) => <LocalAuthContext.Provider value={local}>{children}</LocalAuthContext.Provider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current).toBe(local);
  });
});
