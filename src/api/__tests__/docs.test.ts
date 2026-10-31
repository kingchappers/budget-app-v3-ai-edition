import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { handler } from '../../../api-handler';
import { setAuth } from '../../auth';
import type { AuthResult } from '../../auth';
import { sessionCookie } from '../../auth/cookies';
import { createLocalProvider } from '../../auth/local';
import { createSession } from '../../auth/localData';
import { createToken, revokeToken } from '../../auth/tokens';
import type { TokenScope } from '../../auth/tokens';
import { setStore } from '../../store';
import { MemoryStore } from '../../store/memory';
import { AGENT_DOCS_MARKDOWN } from '../generated/agentDocs';
import { createRouter } from '../router';
import { registerCoreRoutes } from '../routes';
import type { ApiResponse } from '../types';

const SPEC_PATH = '/api/openapi.json';
const AGENT_DOCS_PATH = '/api/docs/agents';
const ROUTES = [SPEC_PATH, AGENT_DOCS_PATH];

let store: MemoryStore;
let fakeAuth: {
  mode: 'auth0';
  authenticate: Mock<(event: APIGatewayProxyEventV2) => Promise<AuthResult>>;
  handlePublic: Mock<(event: APIGatewayProxyEventV2) => Promise<ApiResponse | undefined>>;
};
let ipCounter = 0;

function makeEvent(path: string, options: { method?: string; authorization?: string; cookie?: string } = {}): APIGatewayProxyEventV2 {
  const { method = 'GET', authorization, cookie } = options;
  ipCounter += 1;
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  if (cookie !== undefined) headers.cookie = cookie;
  return {
    rawPath: path,
    headers,
    requestContext: { routeKey: 'ANY /api/{proxy+}', http: { method, sourceIp: `198.51.100.${ipCounter}` } },
  } as unknown as APIGatewayProxyEventV2;
}

async function invoke(event: APIGatewayProxyEventV2): Promise<ApiResponse> {
  return (await handler(event, {} as Context, () => {})) as ApiResponse;
}

async function tokenFor(scope: TokenScope): Promise<string> {
  const { token } = await createToken(store, { userId: 'user-a', name: 'script', scope, expiryDays: 90 }, Math.floor(Date.now() / 1000));
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
});

describe.each(ROUTES)('GET %s', (path) => {
  it('refuses a request with no credential and says nothing of the spec', async () => {
    fakeAuth.authenticate.mockResolvedValue({ rejection: { statusCode: 401, headers: {}, body: '{"error":"Unauthorized"}' } });
    const res = await invoke(makeEvent(path));
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('{"error":"Unauthorized"}');
  });

  it('answers a read token', async () => {
    const res = await invoke(makeEvent(path, { authorization: `Bearer ${await tokenFor('read')}` }));
    expect(res.statusCode).toBe(200);
  });

  it('answers a write token', async () => {
    const res = await invoke(makeEvent(path, { authorization: `Bearer ${await tokenFor('write')}` }));
    expect(res.statusCode).toBe(200);
  });

  it('refuses a revoked token', async () => {
    const created = await createToken(store, { userId: 'user-a', name: 'gone', scope: 'read', expiryDays: 90 }, Math.floor(Date.now() / 1000));
    await revokeToken(store, 'user-a', created.record.tokenId);
    const res = await invoke(makeEvent(path, { authorization: `Bearer ${created.token}` }));
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('{"error":"Unauthorized"}');
  });

  it('refuses an expired token', async () => {
    const issued = Math.floor(Date.now() / 1000) - 91 * 86400;
    const { token } = await createToken(store, { userId: 'user-a', name: 'old', scope: 'read', expiryDays: 90 }, issued);
    const res = await invoke(makeEvent(path, { authorization: `Bearer ${token}` }));
    expect(res.statusCode).toBe(401);
  });

  it('answers a local-mode session', async () => {
    setAuth(await createLocalProvider({}));
    const session = await createSession(store, 'user-a', Math.floor(Date.now() / 1000));
    const cookie = sessionCookie(session, true).split(';')[0];
    const res = await invoke(makeEvent(path, { cookie }));
    expect(res.statusCode).toBe(200);
  });

  it('answers HEAD with 200 and an empty body', async () => {
    const res = await invoke(makeEvent(path, { method: 'HEAD' }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('is private and carries the security headers', async () => {
    const res = await invoke(makeEvent(path));
    expect(res.headers).toMatchObject({
      'Cache-Control': 'private',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
  });
});

describe('the OpenAPI document', () => {
  it('is JSON for OpenAPI 3.1.0', async () => {
    const res = await invoke(makeEvent(SPEC_PATH));
    expect(res.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(res.body).openapi).toBe('3.1.0');
  });
});

describe('the agent docs', () => {
  it('are Markdown', async () => {
    const res = await invoke(makeEvent(AGENT_DOCS_PATH));
    expect(res.headers?.['Content-Type']).toBe('text/markdown; charset=utf-8');
    expect(res.body).toBe(AGENT_DOCS_MARKDOWN);
  });
});

describe('the core routes alone', () => {
  it.each(ROUTES)('do not serve %s, so the demo cannot', async (path) => {
    const router = createRouter();
    registerCoreRoutes(router);
    const res = await router.dispatch(makeEvent(path), 'user-a');
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('openapi');
  });
});
