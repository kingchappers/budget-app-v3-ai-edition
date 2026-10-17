import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { resetTestStore, useTestStore } from '../../store/testing';
import type { SqliteStore } from '../../store/sqlite';
import { createAccount, createSession } from '../localData';
import { createLocalProvider } from '../local';
import { initAuth, setAuth } from '..';

let store: SqliteStore;
const now = () => Math.floor(Date.now() / 1000);

function event(over: { method?: string; cookie?: string; origin?: string } = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: '/api/categories',
    headers: { host: 'budget.example.com', ...(over.origin ? { origin: over.origin } : {}) },
    cookies: over.cookie ? [over.cookie] : undefined,
    requestContext: { routeKey: 'GET /x', http: { method: over.method ?? 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  store = useTestStore();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  resetTestStore();
  setAuth(undefined);
  vi.restoreAllMocks();
});

describe('createLocalProvider', () => {
  it('logs the setup code exactly once when there is no account, and never when there is', async () => {
    const log = vi.mocked(console.log);
    await createLocalProvider({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/setup code/i);

    log.mockClear();
    await createAccount(store, 'me@example.com', 'a long enough password');
    await createLocalProvider({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(log).not.toHaveBeenCalled();
  });

  it('authenticates a live session cookie', async () => {
    const provider = await createLocalProvider({});
    const token = await createSession(store, 'local|u1', now());
    expect(await provider.authenticate(event({ cookie: `__Host-budget_session=${token}` }))).toEqual({ userId: 'local|u1' });
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown cookie', '__Host-budget_session=bogus'],
  ])('answers 401 for %s', async (_label, cookie) => {
    const provider = await createLocalProvider({});
    const result = await provider.authenticate(event({ cookie }));
    expect('rejection' in result && result.rejection.statusCode).toBe(401);
  });

  it('answers 403 for a state-changing request from another origin, even with a valid cookie', async () => {
    const provider = await createLocalProvider({});
    const token = await createSession(store, 'local|u1', now());
    const result = await provider.authenticate(event({ method: 'DELETE', cookie: `__Host-budget_session=${token}`, origin: 'https://evil.example.com' }));
    expect('rejection' in result && result.rejection.statusCode).toBe(403);
  });

  it('ignores a plain budget_session cookie while cookies are Secure', async () => {
    const provider = await createLocalProvider({});
    const token = await createSession(store, 'local|u1', now());
    const result = await provider.authenticate(event({ cookie: `budget_session=${token}` }));
    expect('rejection' in result && result.rejection.statusCode).toBe(401);
  });

  it('uses the plain name when COOKIE_SECURE=false', async () => {
    const provider = await createLocalProvider({ COOKIE_SECURE: 'false' });
    const token = await createSession(store, 'local|u1', now());
    expect(await provider.authenticate(event({ cookie: `budget_session=${token}` }))).toEqual({ userId: 'local|u1' });
    const hosted = await provider.authenticate(event({ cookie: `__Host-budget_session=${token}` }));
    expect('rejection' in hosted && hosted.rejection.statusCode).toBe(401);
  });

  it('checks Origin against APP_ORIGIN, not the Host header, for state-changing requests', async () => {
    const provider = await createLocalProvider({ APP_ORIGIN: 'https://budget.example.com' });
    const token = await createSession(store, 'local|u1', now());
    const cookie = `__Host-budget_session=${token}`;
    const ok = await provider.authenticate(event({ method: 'DELETE', cookie, origin: 'https://budget.example.com' }));
    expect(ok).toEqual({ userId: 'local|u1' });
    const bad = await provider.authenticate(event({ method: 'DELETE', cookie, origin: 'https://budget.example.com.evil.test' }));
    expect('rejection' in bad && bad.rejection.statusCode).toBe(403);
  });

  it('is what initAuth loads for AUTH_MODE=local', async () => {
    const provider = await initAuth({ AUTH_MODE: 'local' });
    expect(typeof provider.handlePublic).toBe('function');
  });
});
