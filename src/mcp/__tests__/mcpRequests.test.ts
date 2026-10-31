import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { handler } from '../../../api-handler';
import { setAuth } from '../../auth';
import type { AuthResult } from '../../auth';
import { createToken, listTokens, revokeToken } from '../../auth/tokens';
import type { TokenScope } from '../../auth/tokens';
import { MCP_TOOLS } from '../tools';
import { setStore } from '../../store';
import { MemoryStore } from '../../store/memory';
import type { ApiResponse } from '../../api/types';

let store: MemoryStore;
let fakeAuth: {
  mode: 'auth0';
  authenticate: Mock<(event: APIGatewayProxyEventV2) => Promise<AuthResult>>;
  handlePublic: Mock<(event: APIGatewayProxyEventV2) => Promise<ApiResponse | undefined>>;
};
let ipCounter = 0;

const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

interface EventOptions {
  method?: string;
  path?: string;
  authorization?: string;
  cookie?: string;
  origin?: string;
  body?: string;
  base64?: boolean;
  sourceIp?: string;
}

function makeEvent(options: EventOptions = {}): APIGatewayProxyEventV2 {
  ipCounter += 1;
  const { method = 'POST', path = '/mcp', authorization, cookie, origin, body = LIST, base64 = false, sourceIp = `203.0.113.${ipCounter}` } = options;
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  if (cookie !== undefined) headers.cookie = cookie;
  if (origin !== undefined) headers.origin = origin;
  return {
    rawPath: path,
    headers,
    body: base64 ? Buffer.from(body).toString('base64') : body,
    isBase64Encoded: base64,
    requestContext: { routeKey: 'ANY /mcp', http: { method, sourceIp } },
  } as unknown as APIGatewayProxyEventV2;
}

async function invoke(event: APIGatewayProxyEventV2): Promise<ApiResponse> {
  return (await handler(event, {} as Context, () => {})) as ApiResponse;
}

async function tokenFor(userId: string, scope: TokenScope, expiryDays = 90): Promise<string> {
  const { token } = await createToken(store, { userId, name: 'agent', scope, expiryDays }, Math.floor(Date.now() / 1000));
  return token;
}

beforeEach(() => {
  store = new MemoryStore();
  setStore(store);
  fakeAuth = {
    mode: 'auth0',
    authenticate: vi.fn<(event: APIGatewayProxyEventV2) => Promise<AuthResult>>().mockResolvedValue({ userId: 'jwt-user' }),
    handlePublic: vi.fn<(event: APIGatewayProxyEventV2) => Promise<ApiResponse | undefined>>().mockResolvedValue(undefined),
  };
  setAuth(fakeAuth);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setAuth(undefined);
  setStore(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('POST /mcp authentication', () => {
  it('answers tools/list for a read token', async () => {
    const token = await tokenFor('user-a', 'read');
    const res = await invoke(makeEvent({ authorization: `Bearer ${token}` }));
    expect(res.statusCode).toBe(200);
    const names = JSON.parse(res.body).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['month_review', 'category_detail']);
  });

  it('decodes a base64 body', async () => {
    const token = await tokenFor('user-a', 'read');
    const res = await invoke(makeEvent({ authorization: `Bearer ${token}`, base64: true }));
    expect(JSON.parse(res.body).result.tools).toHaveLength(MCP_TOOLS.length);
  });

  it('answers 401 to a session cookie alone and never calls the auth provider', async () => {
    const res = await invoke(makeEvent({ cookie: 'hw_session=abc' }));
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('{"error":"Unauthorized"}');
    expect(fakeAuth.authenticate).not.toHaveBeenCalled();
    expect(fakeAuth.handlePublic).not.toHaveBeenCalled();
  });

  it('answers 401 with no Authorization header', async () => {
    expect((await invoke(makeEvent())).statusCode).toBe(401);
  });

  it('answers 401 to a revoked token', async () => {
    const token = await tokenFor('user-a', 'read');
    const [record] = await listTokens(store, 'user-a');
    await revokeToken(store, 'user-a', record.tokenId);
    expect((await invoke(makeEvent({ authorization: `Bearer ${token}` }))).statusCode).toBe(401);
  });

  it('answers 401 to an expired token', async () => {
    const token = await tokenFor('user-a', 'read', 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    expect((await invoke(makeEvent({ authorization: `Bearer ${token}` }))).statusCode).toBe(401);
  });

  it('still counts repeated bad tokens against the failure limiter', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      statuses.push((await invoke(makeEvent({ authorization: 'Bearer hwr_nope', sourceIp: '192.0.2.77' }))).statusCode);
    }
    expect(statuses[0]).toBe(401);
    expect(statuses).toContain(429);
  });
});

describe('POST /mcp request rules', () => {
  it('answers 405 with Allow: POST to GET and DELETE', async () => {
    const token = await tokenFor('user-a', 'read');
    for (const method of ['GET', 'DELETE']) {
      const res = await invoke(makeEvent({ method, authorization: `Bearer ${token}` }));
      expect(res.statusCode).toBe(405);
      expect(res.headers?.Allow).toBe('POST');
    }
  });

  it('answers 403 to a request that carries an Origin header', async () => {
    const token = await tokenFor('user-a', 'read');
    const res = await invoke(makeEvent({ authorization: `Bearer ${token}`, origin: 'http://evil.example' }));
    expect(res.statusCode).toBe(403);
  });

  it('answers 413 to a body over 65,536 bytes', async () => {
    const token = await tokenFor('user-a', 'read');
    const res = await invoke(makeEvent({ authorization: `Bearer ${token}`, body: 'x'.repeat(65_537) }));
    expect(res.statusCode).toBe(413);
  });

  it('answers 429 with Retry-After on the 61st request in a minute, for that user only', async () => {
    const tokenA = await tokenFor('rate-a', 'read');
    const tokenB = await tokenFor('rate-b', 'read');
    for (let i = 0; i < 60; i += 1) {
      expect((await invoke(makeEvent({ authorization: `Bearer ${tokenA}` }))).statusCode).toBe(200);
    }
    const limited = await invoke(makeEvent({ authorization: `Bearer ${tokenA}` }));
    expect(limited.statusCode).toBe(429);
    expect(limited.headers?.['Retry-After']).toBe('60');
    expect((await invoke(makeEvent({ authorization: `Bearer ${tokenB}` }))).statusCode).toBe(200);
  });
});

describe('token rules elsewhere are unchanged', () => {
  it('a read token still cannot POST to /api/transactions', async () => {
    const token = await tokenFor('user-a', 'read');
    const res = await invoke(makeEvent({ path: '/api/transactions', authorization: `Bearer ${token}`, body: '{}' }));
    expect(res.statusCode).toBe(403);
  });

  it('a token cannot reach /api/tokens', async () => {
    const token = await tokenFor('user-a', 'write');
    const res = await invoke(makeEvent({ method: 'GET', path: '/api/tokens', authorization: `Bearer ${token}` }));
    expect(res.statusCode).toBe(403);
  });
});
