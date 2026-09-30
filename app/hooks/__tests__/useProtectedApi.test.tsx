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
