import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export interface StaticEvent {
  rawPath?: string;
}

export type StaticHandler = (event: StaticEvent) => Promise<APIGatewayProxyStructuredResultV2>;

// Anything not listed here is read as bytes and returned base64-encoded.
const TEXT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

const BINARY_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const CSP_HEADER = 'Content-Security-Policy-Report-Only';
const HANDLER_FILE = 'index.js';
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const PICTURE_HOSTS = [
  'https://s.gravatar.com',
  'https://*.gravatar.com',
  'https://*.googleusercontent.com',
  'https://cdn.auth0.com',
];

function auth0Origins(domain: string | undefined): string[] {
  if (!domain || !HOSTNAME.test(domain)) return [];
  return [`https://${domain}`];
}

export function buildCsp(indexHtml: string, auth0Domain: string | undefined): string {
  const scriptHashes = [...indexHtml.matchAll(INLINE_SCRIPT)]
    .map(match => match[1])
    .filter(code => code.trim() !== '')
    .map(code => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`);
  const auth0 = auth0Origins(auth0Domain);

  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    ["connect-src 'self'", ...auth0].join(' '),
    ["frame-src 'self'", ...auth0].join(' '),
    ["img-src 'self' data:", ...PICTURE_HOSTS].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function readAuth0Domain(root: string): string | undefined {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'csp.json'), 'utf8')) as { auth0Domain?: unknown };
    return typeof config.auth0Domain === 'string' ? config.auth0Domain : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Static handler: could not read csp.json', error);
    }
    return undefined;
  }
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const ICON_CACHE = 'public, max-age=86400';
const NO_CACHE = 'no-cache';

function cacheControlFor(urlPath: string): string {
  if (urlPath.startsWith('/assets/')) return IMMUTABLE_CACHE;
  if (urlPath.startsWith('/icons/')) return ICON_CACHE;
  return NO_CACHE;
}

function textResponse(statusCode: number, contentType: string, body: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': contentType, 'Cache-Control': NO_CACHE, ...SECURITY_HEADERS },
    body,
  };
}

function decodeRequestPath(rawPath: string | undefined): string | null {
  const withoutQuery = (rawPath || '/').split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function statOrUndefined(target: string): fs.Stats | undefined {
  try {
    return fs.statSync(target, { throwIfNoEntry: false });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENAMETOOLONG' || code === 'ENOTDIR' || code === 'ELOOP') return undefined;
    throw error;
  }
}

function fileResponse(filePath: string, urlPath: string): APIGatewayProxyStructuredResultV2 {
  const ext = path.extname(filePath).toLowerCase();
  const cacheHeaders = { 'Cache-Control': cacheControlFor(urlPath), ...SECURITY_HEADERS };
  const textType = TEXT_TYPES[ext];

  if (textType) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': textType, ...cacheHeaders },
      body: fs.readFileSync(filePath, 'utf8'),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': BINARY_TYPES[ext] ?? 'application/octet-stream', ...cacheHeaders },
    body: fs.readFileSync(filePath).toString('base64'),
    isBase64Encoded: true,
  };
}

export function createStaticHandler(rootDir: string): StaticHandler {
  const root = path.resolve(rootDir);
  const indexPath = path.join(root, 'index.html');
  const handlerPath = path.join(root, HANDLER_FILE);

  function canonicalUrlPath(filePath: string): string {
    return '/' + path.relative(root, filePath).split(path.sep).join('/');
  }

  const respond = async (event: StaticEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const urlPath = decodeRequestPath(event.rawPath);
      if (urlPath === null) return textResponse(400, 'text/plain', 'Bad Request');

      const requested = path.join(root, urlPath);
      if (requested !== root && !requested.startsWith(root + path.sep)) {
        return textResponse(403, 'text/plain', 'Forbidden');
      }
      if (requested === handlerPath) return textResponse(404, 'text/plain', 'Not Found');

      const stat = statOrUndefined(requested);
      if (stat?.isFile()) return fileResponse(requested, canonicalUrlPath(requested));

      if (stat?.isDirectory()) {
        const dirIndex = path.join(requested, 'index.html');
        if (statOrUndefined(dirIndex)?.isFile()) {
          return fileResponse(dirIndex, canonicalUrlPath(dirIndex));
        }
      }

      if (!stat && path.extname(urlPath) !== '') return textResponse(404, 'text/plain', 'Not Found');

      return textResponse(200, 'text/html', fs.readFileSync(indexPath, 'utf8'));
    } catch (error) {
      console.error('Static handler error:', error);
      return textResponse(500, 'application/json', JSON.stringify({ error: 'Internal Server Error' }));
    }
  };

  let cachedPolicy: string | undefined;

  function contentSecurityPolicy(): string {
    if (cachedPolicy === undefined) {
      cachedPolicy = buildCsp(fs.readFileSync(indexPath, 'utf8'), readAuth0Domain(root));
    }
    return cachedPolicy;
  }

  function withPolicy(response: APIGatewayProxyStructuredResultV2): APIGatewayProxyStructuredResultV2 {
    const isPage = response.statusCode === 200 && response.headers?.['Content-Type'] === 'text/html';
    if (!isPage) return response;
    return { ...response, headers: { ...response.headers, [CSP_HEADER]: contentSecurityPolicy() } };
  }

  return async (event: StaticEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    const response = await respond(event);
    try {
      return withPolicy(response);
    } catch (error) {
      console.error('Static handler: could not build the content security policy', error);
      return response;
    }
  };
}

export const handler: StaticHandler = createStaticHandler(__dirname);
