// Throwaway adapter for the local-login browser check. NOT the Container Image's server.
// Usage: PORT=<port> SQLITE_PATH=<file> node server.cjs
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.AUTH_MODE = 'local';
process.env.STORE = 'sqlite';
process.env.COOKIE_SECURE = 'false';
if (!process.env.SQLITE_PATH) throw new Error('SQLITE_PATH is required');

const root = path.join(__dirname, '..', '..');
const clientDir = path.join(root, 'build/client');
const { handler } = require(path.join(root, 'build/local-auth-check/api-handler.js'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveApi(req, res, url) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
  const method = req.method || 'GET';
  const event = {
    version: '2.0',
    routeKey: `${method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    cookies: headers.cookie ? headers.cookie.split(';').map(part => part.trim()) : [],
    body: await readBody(req),
    isBase64Encoded: false,
    requestContext: { routeKey: `${method} ${url.pathname}`, http: { method, path: url.pathname, sourceIp: req.socket.remoteAddress || '127.0.0.1' } },
  };
  const result = await handler(event, {}, () => undefined);
  const outHeaders = { ...(result.headers || {}) };
  if (result.cookies && result.cookies.length) outHeaders['Set-Cookie'] = result.cookies;
  res.writeHead(result.statusCode || 200, outHeaders);
  res.end(result.body || '');
}

function serveStatic(res, pathname) {
  const requested = path.normalize(path.join(clientDir, decodeURIComponent(pathname)));
  const inside = requested.startsWith(clientDir + path.sep);
  const isFile = inside && fs.existsSync(requested) && fs.statSync(requested).isFile();
  if (!isFile && path.extname(pathname)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const file = isFile ? requested : path.join(clientDir, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ auth: 'local' }));
    } else if (url.pathname.startsWith('/api/')) {
      await serveApi(req, res, url);
    } else {
      serveStatic(res, url.pathname);
    }
  } catch (error) {
    console.error('request failed:', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal error');
  }
});

const port = Number(process.env.PORT) || 0;
server.listen(port, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${server.address().port}`);
});
