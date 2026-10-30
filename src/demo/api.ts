import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRouter } from '../api/router';
import { registerCoreRoutes } from '../api/routes';
import { setStore } from '../store';
import { MemoryStore } from '../store/memory';
import { DEMO_MARKER } from './marker';

export const DEMO_USER_ID = 'demo|visitor';
export const DEMO_EMAIL = 'demo@example.com';

export interface DemoRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Send = (method: string, path: string, body?: unknown) => Promise<DemoResponse>;

export interface DemoApi {
  handles(pathname: string): boolean;
  handle(request: DemoRequest): Promise<DemoResponse>;
  send: Send;
}

export interface DemoApiOptions {
  // Fills the fresh store through the API at start-up.
  seed?: (send: Send) => Promise<void>;
}

const BASE = 'http://demo.invalid';

function reply(status: number, body: object): DemoResponse {
  return { status, headers: { 'Content-Type': 'application/json', 'X-Demo': DEMO_MARKER }, body: JSON.stringify(body) };
}

// The sign-in endpoints of the built-in login, answered locally: the visitor is always signed in, so the sign-in form never shows.
function authReply(method: string, path: string): DemoResponse {
  if (method === 'GET' && path === '/api/auth/me') return reply(200, { userId: DEMO_USER_ID, email: DEMO_EMAIL });
  if (method === 'GET' && path === '/api/auth/status') return reply(200, { setupRequired: false, recoveryOpen: false });
  if (method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/setup')) {
    return reply(200, { userId: DEMO_USER_ID, email: DEMO_EMAIL });
  }
  if (method === 'POST' && path === '/api/auth/logout') return reply(200, {});
  return reply(404, { error: 'Endpoint not found' });
}

// The same shape the Lambda receives from API Gateway, which is what every handler reads.
function buildEvent(request: DemoRequest, target: URL): APIGatewayProxyEventV2 {
  const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
  const query: Record<string, string> = {};
  target.searchParams.forEach((value, name) => { query[name] = value; });
  const routeKey = `${request.method} /api/{proxy+}`;
  return {
    version: '2.0',
    routeKey,
    rawPath: target.pathname,
    rawQueryString: target.search.slice(1),
    headers,
    queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
    body: request.body,
    isBase64Encoded: false,
    requestContext: {
      routeKey,
      http: { method: request.method, path: '/api/{proxy+}', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: headers['user-agent'] ?? '' },
    },
  } as unknown as APIGatewayProxyEventV2;
}

export async function createDemoApi(options: DemoApiOptions = {}): Promise<DemoApi> {
  const router = createRouter();
  registerCoreRoutes(router);

  async function handle(request: DemoRequest): Promise<DemoResponse> {
    const target = new URL(request.url, BASE);
    const path = target.pathname;
    if (path === '/config.json') return reply(200, { auth: 'local' });
    if (path.startsWith('/api/auth/')) return authReply(request.method, path);
    if (!path.startsWith('/api/')) return reply(404, { error: 'Endpoint not found' });

    const event = buildEvent(request, target);
    try {
      const result = await router.dispatch(event, DEMO_USER_ID);
      const headers = Object.fromEntries(Object.entries(result.headers ?? {}).map(([name, value]) => [name, String(value)]));
      return { status: result.statusCode, headers: { ...headers, 'X-Demo': DEMO_MARKER }, body: result.body };
    } catch (error) {
      console.error(`Demo API error in ${event.requestContext.routeKey}:`, error instanceof Error ? error.name : 'Error');
      return reply(500, { error: 'Internal server error' });
    }
  }

  const send: Send = (method, path, body) => handle({
    method,
    url: path,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  setStore(new MemoryStore());
  await options.seed?.(send);
  return {
    handles: pathname => pathname === '/config.json' || pathname.startsWith('/api/'),
    handle,
    send,
  };
}
