import { request as httpRequest, createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRequestListener, type AdapterDeps, type HandlerResult } from '../adapter';

let server: Server;
let base: string;
let seen: APIGatewayProxyEventV2[];
let apiResult: HandlerResult;
let staticResult: HandlerResult;
let healthy: boolean;

function start(overrides: Partial<AdapterDeps> = {}): Promise<void> {
  const listener = createRequestListener({
    apiHandler: async event => { seen.push(event); return apiResult; },
    staticHandler: async () => staticResult,
    configBody: '{"auth":"local"}',
    trustProxy: false,
    isHealthy: async () => healthy,
    log: () => undefined,
    ...overrides,
  });
  server = createServer(listener);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  }));
}

beforeEach(() => {
  seen = [];
  apiResult = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":1}' };
  staticResult = { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html></html>' };
  healthy = true;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

describe('routing', () => {
  it('answers /healthz and flips to 503 when unhealthy', async () => {
    await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    healthy = false;
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
  });

  it('serves /config.json itself, ahead of the static handler', async () => {
    const staticHandler = vi.fn(async () => staticResult);
    await start({ staticHandler });
    const response = await fetch(`${base}/config.json`);
    expect(await response.json()).toEqual({ auth: 'local' });
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(staticHandler).not.toHaveBeenCalled();
  });

  it('sends everything else to the static handler and refuses other methods there', async () => {
    await start();
    expect(await (await fetch(`${base}/anything`)).text()).toBe('<html></html>');
    const post = await fetch(`${base}/anything`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('rejects a request target that is not origin-form', async () => {
    await start();
    const status = await new Promise<number>(resolve => {
      const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'GET', path: 'http://evil.test/x' }, res => resolve(res.statusCode ?? 0));
      req.end();
    });
    expect(status).toBe(400);
  });
});

describe('the API event', () => {
  it('lower-cases headers, splits cookies, keeps the query and never puts the path in routeKey', async () => {
    await start();
    await fetch(`${base}/api/transactions/2026-10/abc-123?x=1&y=two%20words`, {
      method: 'DELETE', headers: { 'X-Custom': 'v', Cookie: 'a=1; b=2' },
    });
    const event = seen[0];
    expect(event.rawPath).toBe('/api/transactions/2026-10/abc-123');
    expect(event.rawQueryString).toBe('x=1&y=two%20words');
    expect(event.queryStringParameters).toEqual({ x: '1', y: 'two words' });
    expect(event.headers['x-custom']).toBe('v');
    expect(event.cookies).toEqual(['a=1', 'b=2']);
    expect(event.requestContext.http.method).toBe('DELETE');
    expect(event.requestContext.routeKey).toBe('DELETE /api/{proxy+}');
    expect(JSON.stringify(event.requestContext)).not.toContain('abc-123');
  });

  it('passes the body of a POST and none for a GET', async () => {
    await start();
    await fetch(`${base}/api/x`, { method: 'POST', body: '{"a":1}' });
    await fetch(`${base}/api/x`);
    expect(seen[0].body).toBe('{"a":1}');
    expect(seen[1].body).toBeUndefined();
  });

  it('writes status, headers, a body, every cookie as its own Set-Cookie, and decodes base64', async () => {
    apiResult = { statusCode: 201, headers: { 'X-One': '1' }, body: 'hello', cookies: ['a=1; HttpOnly', 'b=2; HttpOnly'] };
    await start();
    const response = await fetch(`${base}/api/x`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-one')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual(['a=1; HttpOnly', 'b=2; HttpOnly']);
    expect(await response.text()).toBe('hello');

    staticResult = { statusCode: 200, headers: { 'Content-Type': 'image/png' }, body: Buffer.from([1, 2, 3, 250]).toString('base64'), isBase64Encoded: true };
    const image = Buffer.from(await (await fetch(`${base}/logo.png`)).arrayBuffer());
    expect([...image]).toEqual([1, 2, 3, 250]);
  });

  it('answers a generic 500 without detail when the handler throws, and keeps serving', async () => {
    const logs: string[] = [];
    await start({ apiHandler: async () => { throw new Error('secret detail'); }, log: message => logs.push(message) });
    const response = await fetch(`${base}/api/x`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret detail');
    expect(logs.join(' ')).not.toContain('secret detail');
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});

describe('forwarding headers', () => {
  const send = (headers: Record<string, string>) => fetch(`${base}/api/x`, { method: 'POST', body: '{}', headers });

  it('strips them and uses the socket address when the proxy is not trusted', async () => {
    await start({ trustProxy: false });
    await send({ 'x-forwarded-for': '6.6.6.6', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https', forwarded: 'for=6.6.6.6' });
    const event = seen[0];
    for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']) expect(event.headers[name]).toBeUndefined();
    expect(event.requestContext.http.sourceIp).toMatch(/127\.0\.0\.1$/);
  });

  it('keeps them and takes the first forwarded address when the proxy is trusted', async () => {
    await start({ trustProxy: true });
    await send({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-forwarded-host': 'budget.example.com' });
    expect(seen[0].requestContext.http.sourceIp).toBe('203.0.113.7');
    expect(seen[0].headers['x-forwarded-host']).toBe('budget.example.com');
  });
});

describe('the body limit', () => {
  it('answers 413 to a Content-Length above the limit without calling the handler', async () => {
    await start({ maxBodyBytes: 1024 });
    const response = await fetch(`${base}/api/x`, { method: 'POST', body: 'x'.repeat(2048) });
    expect(response.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('answers 413 to a chunked upload that grows past the limit', async () => {
    await start({ maxBodyBytes: 1024 });
    const status = await new Promise<number>(resolve => {
      const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'POST', path: '/api/x', headers: { 'Transfer-Encoding': 'chunked' } }, res => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      req.on('error', () => resolve(413));
      req.write('x'.repeat(600));
      req.write('x'.repeat(600));
      req.end();
    });
    expect(status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('accepts a body at exactly the limit', async () => {
    await start({ maxBodyBytes: 1024 });
    const response = await fetch(`${base}/api/x`, { method: 'POST', body: 'x'.repeat(1024) });
    expect(response.status).toBe(200);
    expect(seen[0].body).toHaveLength(1024);
  });
});
