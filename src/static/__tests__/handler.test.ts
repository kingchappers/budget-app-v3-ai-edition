import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCsp, createStaticHandler, type StaticHandler } from '../handler';

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
  fs.writeFileSync(path.join(site, 'index.js'), 'handler source');
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

describe('ENAMETOOLONG and similar stat errors', () => {
  it('treats an overlong path segment with an extension as 404', async () => {
    const res = await handle({ rawPath: '/x.' + 'a'.repeat(300) });

    expect(res.statusCode).toBe(404);
    expect(res.headers?.['Content-Type']).toBe('text/plain');
    expect(res.body).toBe('Not Found');
  });

  it('falls back to index.html for an overlong path segment without extension', async () => {
    const res = await handle({ rawPath: '/' + 'a'.repeat(300) });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('treats ENOTDIR (file used as directory) as index.html fallback', async () => {
    const res = await handle({ rawPath: '/index.html/foo' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });
});

describe('cache header normalization', () => {
  it('serves /assets/../index.html with no-cache, not immutable', async () => {
    const res = await handle({ rawPath: '/assets/../index.html' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves /assets/../icons/icon-192.png with icon cache (canonical path)', async () => {
    const res = await handle({ rawPath: '/assets/../icons/icon-192.png' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=86400');
    expect(res.isBase64Encoded).toBe(true);
  });
});

describe('the handler source', () => {
  it.each(['/index.js', '/index.js?x=1', '/%69ndex.js', '/assets/../index.js'])('returns 404 for %s', async (rawPath) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('Not Found');
    expectSecurityHeaders(res.headers);
  });

  it('still serves hashed assets that have index in their name', async () => {
    const res = await handle({ rawPath: '/assets/index-abc12345.js' });
    expect(res.statusCode).toBe(200);
  });
});

describe('content security policy header', () => {
  const CSP = 'Content-Security-Policy-Report-Only';

  it.each(['/', '/index.html', '/transactions'])('is added to the page at %s', async (rawPath) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.[CSP]).toContain("script-src 'self'");
    expect(res.headers).not.toHaveProperty('Content-Security-Policy');
  });

  it.each(['/assets/index-abc12345.js', '/icons/icon-192.png', '/manifest.webmanifest', '/missing.png', '/%2e%2e/secret.txt'])(
    'is not added to %s',
    async (rawPath) => {
      const res = await handle({ rawPath });
      expect(res.headers).not.toHaveProperty(CSP);
    },
  );

  it('is built from the page\'s inline scripts and the tenant in csp.json', async () => {
    const site = path.join(base, 'site-csp');
    fs.mkdirSync(site);
    const script = 'window.__ctx = 1;';
    fs.writeFileSync(path.join(site, 'index.html'), `<html><script>${script}</script></html>`);
    fs.writeFileSync(path.join(site, 'csp.json'), JSON.stringify({ auth0Domain: 'tenant.uk.auth0.com' }));

    const res = await createStaticHandler(site)({ rawPath: '/' });

    const policy = String(res.headers?.[CSP]);
    expect(policy).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    expect(policy).toContain('https://tenant.uk.auth0.com');
  });

  it('still produces a policy when csp.json is missing', async () => {
    const site = path.join(base, 'site-no-csp');
    fs.mkdirSync(site);
    fs.writeFileSync(path.join(site, 'index.html'), '<html></html>');

    const res = await createStaticHandler(site)({ rawPath: '/' });

    expect(String(res.headers?.[CSP])).toContain("connect-src 'self'; frame-src 'self';");
  });
});

describe('buildCsp', () => {
  const hash = (code: string): string => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;
  const directive = (policy: string, name: string): string =>
    policy.split('; ').find(part => part.startsWith(`${name} `)) ?? '';

  const html = [
    '<html>',
    '<script data-mantine-script="true">window.a = 1;</script>',
    '<script src="/assets/app.js"></script>',
    '<script type="module" async="">import "/assets/x.js";</script>',
    '<script></script>',
    '</html>',
  ].join('');

  it('hashes every inline script and skips scripts with a src and empty scripts', () => {
    const scripts = directive(buildCsp(html, undefined), 'script-src');

    expect(scripts).toContain(hash('window.a = 1;'));
    expect(scripts).toContain(hash('import "/assets/x.js";'));
    expect(scripts).not.toContain(hash(''));
  });

  it('never allows unsafe inline scripts or eval', () => {
    const policy = buildCsp(html, 'tenant.uk.auth0.com');

    expect(directive(policy, 'script-src')).not.toContain('unsafe');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('allows inline styles because Mantine adds style elements at runtime', () => {
    expect(directive(buildCsp(html, undefined), 'style-src')).toContain("'unsafe-inline'");
  });

  it('allows the Auth0 tenant for connections and frames', () => {
    const policy = buildCsp(html, 'tenant.uk.auth0.com');

    expect(directive(policy, 'connect-src')).toContain('https://tenant.uk.auth0.com');
    expect(directive(policy, 'frame-src')).toContain('https://tenant.uk.auth0.com');
  });

  it('allows only self when no domain is given', () => {
    expect(directive(buildCsp(html, undefined), 'connect-src')).toBe("connect-src 'self'");
  });

  it.each(['evil.com; script-src *', 'a b', '', 'https://x.com'])('ignores an invalid domain %j', (domain) => {
    const policy = buildCsp(html, domain);

    expect(policy).not.toContain('evil');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  it('locks down objects, base URIs and framing', () => {
    const policy = buildCsp(html, undefined);

    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
