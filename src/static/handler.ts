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

  function canonicalUrlPath(filePath: string): string {
    return '/' + path.relative(root, filePath).split(path.sep).join('/');
  }

  return async (event: StaticEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const urlPath = decodeRequestPath(event.rawPath);
      if (urlPath === null) return textResponse(400, 'text/plain', 'Bad Request');

      const requested = path.join(root, urlPath);
      if (requested !== root && !requested.startsWith(root + path.sep)) {
        return textResponse(403, 'text/plain', 'Forbidden');
      }

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
}

export const handler: StaticHandler = createStaticHandler(__dirname);
