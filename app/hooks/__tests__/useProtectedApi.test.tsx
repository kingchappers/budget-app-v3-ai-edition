import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const getAccessTokenSilently = vi.hoisted(() => vi.fn());
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently }) }));
const markSessionEnded = vi.hoisted(() => vi.fn());
vi.mock('~/lib/session', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/session')>()),
  markSessionEnded,
}));

import { useProtectedApi } from '../useProtectedApi';

beforeEach(() => {
  getAccessTokenSilently.mockReset();
  markSessionEnded.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useProtectedApi', () => {
  it('reports an ended session when the token cannot be renewed', async () => {
    getAccessTokenSilently.mockRejectedValue(Object.assign(new Error('Unknown or invalid refresh token.'), { error: 'invalid_grant' }));
    const { result } = renderHook(() => useProtectedApi());

    await expect(result.current.request('/api/categories')).rejects.toThrow();

    expect(markSessionEnded).toHaveBeenCalled();
  });

  it('does not report an ended session for other failures', async () => {
    getAccessTokenSilently.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useProtectedApi());

    await expect(result.current.request('/api/categories')).rejects.toThrow();

    expect(markSessionEnded).not.toHaveBeenCalled();
  });
});

describe('useProtectedApi in Auth0 mode', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the access token as a Bearer header', async () => {
    getAccessTokenSilently.mockResolvedValue('tok');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"a":1}' });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useProtectedApi());

    await expect(result.current.request('/api/categories')).resolves.toEqual({ a: 1 });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('does not expire a local session or end the session on a 401', async () => {
    const { ApiError } = await import('~/lib/apiError');
    const { getLocalAuthState, resetLocalAuthForTests } = await import('~/lib/localAuth');
    resetLocalAuthForTests();
    const before = getLocalAuthState();
    getAccessTokenSilently.mockResolvedValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));
    const { result } = renderHook(() => useProtectedApi());

    await expect(result.current.request('/api/categories')).rejects.toBeInstanceOf(ApiError);

    expect(getLocalAuthState()).toEqual(before);
    expect(markSessionEnded).not.toHaveBeenCalled();
    resetLocalAuthForTests();
  });
});

describe('useProtectedApi in local mode', () => {
  it('sends no Authorization header and reports an ended session on a 401', async () => {
    // Re-mock useAuth for this block only.
    const { LocalAuthContext } = await import('~/lib/auth');
    const { getLocalAuthState, resetLocalAuthForTests } = await import('~/lib/localAuth');
    resetLocalAuthForTests();
    const { ApiError } = await import('~/lib/apiError');
    const { createElement } = await import('react');
    const localState = {
      mode: 'local' as const, isAuthenticated: true, isLoading: false, user: { sub: 'local|1' },
      login: vi.fn(), logout: vi.fn(), getToken: async () => undefined,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(LocalAuthContext.Provider, { value: localState }, children);
    const { result } = renderHook(() => useProtectedApi(), { wrapper });

    try {
      await expect(result.current.request('/api/categories')).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
      expect(markSessionEnded).toHaveBeenCalled();
      expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: false });
    } finally {
      vi.unstubAllGlobals();
      resetLocalAuthForTests();
    }
  });
});
