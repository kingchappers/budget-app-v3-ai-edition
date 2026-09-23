import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStaticHandler, type StaticHandler } from '../handler';

// Bytes that are not valid UTF-8, so a handler that reads binary as text corrupts them.
const BINARY_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
const INDEX_HTML = '<!doctype html><title>app</title>';

let base: string;
let handle: StaticHandler;

function expectSecurityHeaders(headers: Record<string, string | number | boolean> | undefined): void {
  expect(headers).toMatchObject({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'static-handler-'));
  const site = path.join(base, 'site');
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(site, 'icons'));
  fs.mkdirSync(path.join(base, 'site-evil'));
  fs.writeFileSync(path.join(site, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(site, 'assets', 'index-abc12345.js'), 'console.log("app")');
  fs.writeFileSync(path.join(site, 'icons', 'icon-192.png'), BINARY_BYTES);
  fs.writeFileSync(path.join(site, 'manifest.webmanifest'), '{"name":"Budget"}');
  fs.writeFileSync(path.join(site, 'favicon.ico'), BINARY_BYTES);
  fs.writeFileSync(path.join(base, 'site-evil', 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  handle = createStaticHandler(site);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('serving files', () => {
  it('serves index.html as text that must be revalidated', async () => {
    const res = await handle({ rawPath: '/index.html' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/html');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.isBase64Encoded).toBeUndefined();
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves the root path as index.html', async () => {
    const res = await handle({ rawPath: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('treats a missing rawPath as the root', async () => {
    const res = await handle({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves hashed assets as immutable', async () => {
    const res = await handle({ rawPath: '/assets/index-abc12345.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/javascript');
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(res.body).toBe('console.log("app")');
  });

  it('serves icons as base64 with a one-day cache', async () => {
    const res = await handle({ rawPath: '/icons/icon-192.png' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('image/png');
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=86400');
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body ?? '', 'base64').equals(BINARY_BYTES)).toBe(true);
  });

  it('serves the manifest with its own MIME type', async () => {
    const res = await handle({ rawPath: '/manifest.webmanifest' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/manifest+json');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe('{"name":"Budget"}');
  });

  it('serves other binary files as base64 that must be revalidated', async () => {
    const res = await handle({ rawPath: '/favicon.ico' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('image/x-icon');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body ?? '', 'base64').equals(BINARY_BYTES)).toBe(true);
  });

  it('ignores a query string', async () => {
    const res = await handle({ rawPath: '/index.html?x=1' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });
});

describe('routing fallback', () => {
  it('falls back to index.html for client-side routes', async () => {
    const res = await handle({ rawPath: '/transactions' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/html');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('never caches the fallback as immutable, even under /assets/', async () => {
    const res = await handle({ rawPath: '/assets/nope' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it.each(['/icons', '/icons/'])('falls back for the directory path %s instead of failing', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it.each(['/sw.js', '/icons/missing.png'])('answers a missing file (%s) with 404, not HTML', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(404);
    expect(res.headers?.['Content-Type']).toBe('text/plain');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe('Not Found');
  });
});

describe('request validation', () => {
  it.each([
    '/../secret.txt',
    '/../site-evil/secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e/site-evil/secret.txt',
    '/assets/../../secret.txt',
  ])('rejects the traversal path %s with 403', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('Forbidden');
  });

  it.each(['/a%00b', '/%E0%A4%A'])('rejects the malformed path %s with 400', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Bad Request');
  });

  it.each([
    '/',
    '/icons/icon-192.png',
    '/assets/index-abc12345.js',
    '/transactions',
    '/sw.js',
    '/../secret.txt',
    '/a%00b',
  ])('sends the security headers for %s', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expectSecurityHeaders(res.headers);
  });
});

describe('failure handling', () => {
  it('returns a generic 500 and logs when index.html is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-handler-empty-'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await createStaticHandler(emptyDir)({ rawPath: '/transactions' });

      expect(res.statusCode).toBe(500);
      expect(res.body).toBe(JSON.stringify({ error: 'Internal Server Error' }));
      expect(errorLog).toHaveBeenCalled();
      expectSecurityHeaders(res.headers);
    } finally {
      errorLog.mockRestore();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
