import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureLocalAuth, expireLocalSession, getLocalAuthState, loginLocal, logoutLocal, resetLocalAuthForTests, setupLocal,
} from '../localAuth';

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  resetLocalAuthForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local auth store', () => {
  it('starts loading, then signs in when /me succeeds', async () => {
    expect(getLocalAuthState()).toEqual({ status: 'loading' });
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedIn', user: { sub: 'local|1', email: 'me@example.com' } });
  });

  it('asks whether setup is needed when /me says 401', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { setupRequired: true }));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: true });
  });

  it('checks only once however many layouts mount', async () => {
    fetchMock.mockResolvedValue(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await Promise.all([ensureLocalAuth(), ensureLocalAuth(), ensureLocalAuth()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to signed out, and logs, when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: false });
    expect(console.error).toHaveBeenCalled();
  });

  it('signs in on a good login and surfaces the server message on a bad one', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await loginLocal('me@example.com', 'a long enough password');
    expect(getLocalAuthState()).toMatchObject({ status: 'signedIn' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));

    resetLocalAuthForTests();
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'Invalid email or password' }));
    await expect(loginLocal('me@example.com', 'wrong')).rejects.toThrow('Invalid email or password');
  });

  it('sends the setup code and fields to /setup', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await setupLocal({ code: 'abc', email: 'me@example.com', password: 'a long enough password' });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ code: 'abc', email: 'me@example.com', password: 'a long enough password' });
  });

  it('goes signed out when the session expires mid-use', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await ensureLocalAuth();
    expireLocalSession();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: false });
  });

  it('posts to /logout', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await logoutLocal();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
});
