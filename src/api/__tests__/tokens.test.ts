import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { handler } from '../../../api-handler';
import { setAuth } from '../../auth';
import type { AuthResult } from '../../auth';
import { createAccount, recordFailure } from '../../auth/localData';
import { verifyPassword } from '../../auth/password';
import { MAX_TOKENS_PER_USER, createToken, findToken, listTokens } from '../../auth/tokens';
import { setStore } from '../../store';
import { MemoryStore } from '../../store/memory';
import { createAccessToken, listAccessTokens, revokeAccessToken } from '../tokens';
import type { ApiResponse } from '../types';

vi.mock('../../auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/password')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const PASSWORD = 'correct horse battery staple';
const NOW_MS = Date.UTC(2026, 9, 30, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);
const VALID = { name: 'Spreadsheet sync', scope: 'read', expiryDays: 90 };

let store: MemoryStore;
let logSpy: MockInstance<typeof console.log>;
let ipCounter = 0;

function createEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    rawPath: '/api/tokens',
    headers: {},
    body: JSON.stringify(body),
    requestContext: { routeKey: 'ANY /api/{proxy+}', http: { method: 'POST', sourceIp: '198.51.100.1' } },
  } as unknown as APIGatewayProxyEventV2;
}

function plainEvent(method: string, path: string): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    headers: {},
    requestContext: { routeKey: 'ANY /api/{proxy+}', http: { method, sourceIp: '198.51.100.1' } },
  } as unknown as APIGatewayProxyEventV2;
}

function create(body: unknown, userId = 'user-a'): Promise<ApiResponse> {
  return createAccessToken(createEvent(body), userId, {});
}

function list(userId = 'user-a'): Promise<ApiResponse> {
  return listAccessTokens(plainEvent('GET', '/api/tokens'), userId, {});
}

function revoke(tokenId: string, userId = 'user-a'): Promise<ApiResponse> {
  return revokeAccessToken(plainEvent('DELETE', `/api/tokens/${tokenId}`), userId, { tokenId });
}

function errorOf(res: ApiResponse): string {
  return JSON.parse(res.body).error;
}

function loggedText(): string {
  return logSpy.mock.calls.map((call) => call.map((part: unknown) => String(part)).join(' ')).join('\n');
}

async function useLocalModeWithAccount(): Promise<void> {
  vi.stubEnv('AUTH_MODE', 'local');
  await createAccount(store, 'owner@example.com', PASSWORD);
}

beforeEach(() => {
  store = new MemoryStore();
  setStore(store);
  vi.stubEnv('AUTH_MODE', 'auth0');
  vi.mocked(verifyPassword).mockClear();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setAuth(undefined);
  setStore(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/tokens', () => {
  it('creates a token and returns it once with its record', async () => {
    const res = await create(VALID);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.token).toMatch(/^hwr_/);
    expect(body.record).toMatchObject({ name: 'Spreadsheet sync', scope: 'read', lastUsedAt: null });
    expect(await findToken(store, body.token, NOW)).toMatchObject({ userId: 'user-a', tokenId: body.record.tokenId });
  });

  it('creates a write token with a "never" expiry', async () => {
    const res = await create({ ...VALID, scope: 'write', expiryDays: null });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.token).toMatch(/^hww_/);
    expect(body.record).toMatchObject({ scope: 'write', expiresAt: null });
  });

  it('computes the expiry on the server from the chosen number of days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const res = await create({ ...VALID, expiryDays: 365 });
    expect(JSON.parse(res.body).record).toMatchObject({ createdAt: NOW, expiresAt: NOW + 365 * 24 * 60 * 60 });
  });

  it('stores the name trimmed', async () => {
    const res = await create({ ...VALID, name: '  Laptop  ' });
    expect(JSON.parse(res.body).record.name).toBe('Laptop');
  });

  it('accepts a name of exactly 60 characters', async () => {
    const res = await create({ ...VALID, name: 'a'.repeat(60) });
    expect(res.statusCode).toBe(201);
  });

  it('never returns the hash in the record', async () => {
    const res = await create(VALID);
    expect(JSON.parse(res.body).record).not.toHaveProperty('hash');
  });

  it('logs the token id and scope, never the token', async () => {
    const res = await create(VALID);
    const { token, record } = JSON.parse(res.body);
    const text = loggedText();
    expect(text).toContain(`Access token created: ${record.tokenId} read`);
    expect(text).not.toContain(token);
    expect(text).not.toContain(token.slice(4));
  });

  describe('rejects bad input with 400', () => {
    it.each([
      ['an array body', [VALID], 'Invalid JSON'],
      ['a name of only spaces', { ...VALID, name: '   ' }, 'name is required'],
      ['a missing name', { scope: 'read', expiryDays: 90 }, 'name is required'],
      ['a name that is not a string', { ...VALID, name: 42 }, 'name is required'],
      ['an over-long name', { ...VALID, name: 'a'.repeat(61) }, 'name must be at most 60 characters'],
      ['a control character in the name', { ...VALID, name: 'Laptop\u0007' }, 'name must not contain control characters'],
      ['a delete character in the name', { ...VALID, name: 'Laptop\u007f' }, 'name must not contain control characters'],
      ['an unknown field', { ...VALID, expiresAt: 0 }, 'Unexpected fields in the request'],
      ['a bad scope', { ...VALID, scope: 'admin' }, "scope must be 'read' or 'write'"],
      ['a missing scope', { name: 'x', expiryDays: 90 }, "scope must be 'read' or 'write'"],
      ['expiry given as a string', { ...VALID, expiryDays: '90' }, 'expiryDays must be 90, 180, 365, 730 or null'],
      ['an expiry of 91 days', { ...VALID, expiryDays: 91 }, 'expiryDays must be 90, 180, 365, 730 or null'],
      ['a missing expiry', { name: 'x', scope: 'read' }, 'expiryDays must be 90, 180, 365, 730 or null'],
      ['a password that is not a string', { ...VALID, password: 12 }, 'password must be a string of at most 128 characters'],
      ['an over-long password', { ...VALID, password: 'p'.repeat(129) }, 'password must be a string of at most 128 characters'],
    ])('%s', async (_case, body, message) => {
      const res = await create(body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe(message);
      expect(await listTokens(store, 'user-a')).toEqual([]);
    });

    it('a body that is not JSON', async () => {
      const event = { ...createEvent(VALID), body: '{not json' } as APIGatewayProxyEventV2;
      const res = await createAccessToken(event, 'user-a', {});
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe('Invalid JSON');
    });
  });

  it('answers 409 at the limit of 25 tokens', async () => {
    for (let i = 0; i < MAX_TOKENS_PER_USER; i += 1) {
      await createToken(store, { userId: 'user-a', name: `t${i}`, scope: 'read', expiryDays: 90 }, NOW);
    }
    const res = await create(VALID);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('You can have at most 25 access tokens. Revoke one first.');
  });

  it("another user's tokens do not count towards the limit", async () => {
    for (let i = 0; i < MAX_TOKENS_PER_USER; i += 1) {
      await createToken(store, { userId: 'user-b', name: `t${i}`, scope: 'read', expiryDays: 90 }, NOW);
    }
    expect((await create(VALID)).statusCode).toBe(201);
  });
});

describe('password re-entry for write tokens in local mode', () => {
  beforeEach(async () => {
    await useLocalModeWithAccount();
  });

  it('a write token without a password answers 403 Password required', async () => {
    const res = await create({ ...VALID, scope: 'write' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('Password required');
    expect(await listTokens(store, 'user-a')).toEqual([]);
  });

  it('a wrong password answers 403 Incorrect password and counts as a failure', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    for (let i = 0; i < 3; i += 1) {
      const res = await create({ ...VALID, scope: 'write', password: 'not the password' });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toBe('Incorrect password');
    }
    expect((await create({ ...VALID, scope: 'write', password: 'not the password' })).statusCode).toBe(403);
    expect((await create({ ...VALID, scope: 'write', password: PASSWORD })).statusCode).toBe(429);
    expect(await listTokens(store, 'user-a')).toEqual([]);
  });

  it('answers 429 while throttled, before checking the password', async () => {
    for (let i = 0; i < 4; i += 1) await recordFailure(store, NOW);
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const res = await create({ ...VALID, scope: 'write', password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(errorOf(res)).toBe('Too many attempts');
    expect(res.headers?.['Retry-After']).toBe('1');
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('a correct password creates the token and clears the throttle', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    for (let i = 0; i < 3; i += 1) await recordFailure(store, NOW);
    const res = await create({ ...VALID, scope: 'write', password: PASSWORD });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).token).toMatch(/^hww_/);
    await create({ ...VALID, scope: 'write', password: 'wrong' });
    expect((await create({ ...VALID, scope: 'write', password: PASSWORD })).statusCode).toBe(201);
  });

  it('a read token never asks for the password', async () => {
    const res = await create(VALID);
    expect(res.statusCode).toBe(201);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('the password check cannot be used to guess: 20 wrong passwords hit the throttle', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      statuses.push((await create({ ...VALID, scope: 'write', password: `guess ${i}` })).statusCode);
    }
    expect(statuses).toEqual([403, 403, 403, 403, ...Array(16).fill(429)]);
    expect(verifyPassword).toHaveBeenCalledTimes(4);
  });

  it('concurrent wrong passwords are checked one at a time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create({ ...VALID, scope: 'write', password: `guess ${i}` })),
    );
    const statuses = responses.map((res) => res.statusCode);
    expect(statuses.filter((s) => s === 403)).toHaveLength(4);
    expect(statuses.filter((s) => s === 429)).toHaveLength(6);
    expect(verifyPassword).toHaveBeenCalledTimes(4);
  });
});

describe('Auth0 mode', () => {
  it('a write token never asks for a password', async () => {
    await createAccount(store, 'owner@example.com', PASSWORD);
    const res = await create({ ...VALID, scope: 'write' });
    expect(res.statusCode).toBe(201);
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});

describe('GET /api/tokens', () => {
  it("lists only the caller's tokens", async () => {
    await create({ ...VALID, name: 'mine' });
    await create({ ...VALID, name: 'theirs' }, 'user-b');
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tokens.map((t: { name: string }) => t.name)).toEqual(['mine']);
  });

  it('list returns neither hash nor full token', async () => {
    const { token } = JSON.parse((await create(VALID)).body);
    const res = await list();
    const [record] = JSON.parse(res.body).tokens;
    expect(record).not.toHaveProperty('hash');
    expect(res.body).not.toContain(token);
    expect(record.prefix).toBe(token.slice(0, 8));
  });
});

describe('DELETE /api/tokens/{tokenId}', () => {
  it('revokes the token so it no longer authenticates', async () => {
    const { token, record } = JSON.parse((await create(VALID)).body);
    const res = await revoke(record.tokenId);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({});
    expect(await findToken(store, token, NOW)).toBeUndefined();
    expect(await listTokens(store, 'user-a')).toEqual([]);
  });

  it('logs the token id, never the token', async () => {
    const { token, record } = JSON.parse((await create(VALID)).body);
    logSpy.mockClear();
    await revoke(record.tokenId);
    const text = loggedText();
    expect(text).toContain(`Access token revoked: ${record.tokenId}`);
    expect(text).not.toContain(token.slice(4));
  });

  it('answers 404 for an unknown id', async () => {
    const res = await revoke('3f1c2b8e-7a6d-4e5f-9a0b-1c2d3e4f5a6b');
    expect(res.statusCode).toBe(404);
    expect(errorOf(res)).toBe('Token not found');
  });

  it("revoke of another user's token answers the same 404 as an unknown id", async () => {
    const { token, record } = JSON.parse((await create(VALID, 'user-b')).body);
    const theirs = await revoke(record.tokenId);
    const unknown = await revoke('3f1c2b8e-7a6d-4e5f-9a0b-1c2d3e4f5a6b');
    expect(theirs).toEqual(unknown);
    expect(await findToken(store, token, NOW)).toBeDefined();
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const res = await revoke('not-a-uuid');
    expect(res.statusCode).toBe(404);
    expect(errorOf(res)).toBe('Token not found');
  });
});

describe('Cache-Control', () => {
  it('every response has no-store', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const created = await create(VALID);
    const { record } = JSON.parse(created.body);
    const responses = [
      created,
      await create([VALID]),
      await list(),
      await revoke(record.tokenId),
      await revoke(record.tokenId),
    ];
    for (let i = 0; i < MAX_TOKENS_PER_USER; i += 1) {
      await createToken(store, { userId: 'user-c', name: `t${i}`, scope: 'read', expiryDays: 90 }, NOW);
    }
    responses.push(await create(VALID, 'user-c'));

    await useLocalModeWithAccount();
    responses.push(await create({ ...VALID, scope: 'write' }));
    for (let i = 0; i < 4; i += 1) responses.push(await create({ ...VALID, scope: 'write', password: 'wrong' }));

    expect(responses.map((res) => res.statusCode)).toEqual([201, 400, 200, 200, 404, 409, 403, 403, 403, 403, 403]);
    responses.push(await create({ ...VALID, scope: 'write', password: 'wrong' }));
    expect(responses.at(-1)?.statusCode).toBe(429);
    for (const res of responses) expect(res.headers?.['Cache-Control']).toBe('no-store');
  });
});

describe('through the API handler', () => {
  function apiEvent(method: string, path: string, options: { body?: object; authorization?: string } = {}): APIGatewayProxyEventV2 {
    ipCounter += 1;
    const headers: Record<string, string> = {};
    if (options.authorization) headers.authorization = options.authorization;
    return {
      rawPath: path,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      requestContext: { routeKey: 'ANY /api/{proxy+}', http: { method, sourceIp: `203.0.113.${ipCounter}` } },
    } as unknown as APIGatewayProxyEventV2;
  }

  async function invoke(event: APIGatewayProxyEventV2): Promise<ApiResponse> {
    return (await handler(event, {} as Context, () => {})) as ApiResponse;
  }

  beforeEach(() => {
    setAuth({
      authenticate: vi.fn<(event: APIGatewayProxyEventV2) => Promise<AuthResult>>().mockResolvedValue({ userId: 'jwt-user' }),
    });
  });

  it('a token calling POST /api/tokens gets 403', async () => {
    const { token } = await createToken(store, { userId: 'jwt-user', name: 'w', scope: 'write', expiryDays: 90 }, NOW);
    const res = await invoke(apiEvent('POST', '/api/tokens', { body: VALID, authorization: `Bearer ${token}` }));
    expect(res.statusCode).toBe(403);
    expect(await listTokens(store, 'jwt-user')).toHaveLength(1);
  });

  it('a signed-in user can create, list and revoke', async () => {
    const created = await invoke(apiEvent('POST', '/api/tokens', { body: VALID }));
    expect(created.statusCode).toBe(201);
    const { record } = JSON.parse(created.body);

    const listed = await invoke(apiEvent('GET', '/api/tokens'));
    expect(JSON.parse(listed.body).tokens.map((t: { tokenId: string }) => t.tokenId)).toEqual([record.tokenId]);

    const revoked = await invoke(apiEvent('DELETE', `/api/tokens/${record.tokenId}`));
    expect(revoked.statusCode).toBe(200);
    expect(JSON.parse((await invoke(apiEvent('GET', '/api/tokens'))).body).tokens).toEqual([]);
  });
});
