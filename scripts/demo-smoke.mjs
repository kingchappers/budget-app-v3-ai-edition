// Local smoke test for the browser demo (not part of CI). Serves build/demo/client, drives it with Chromium and checks that the
// demo works with no server behind it. Run `yarn build:demo` first, then `node scripts/demo-smoke.mjs`.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'build', 'demo', 'client');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function startServer(requested) {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    requested.push(pathname);
    let file = path.join(DIST, path.normalize(pathname));
    const insideDist = file.startsWith(DIST + path.sep) || file === DIST;
    const isFile = insideDist && existsSync(file) && statSync(file).isFile();
    if (!isFile && path.extname(pathname)) {
      res.writeHead(404).end();
      return;
    }
    if (!isFile) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date();
const MONTH_QUERY = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
const LIST_URL = `/api/transactions?${MONTH_QUERY}`;

const apiCall = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, demo: response.headers.get('X-Demo'), json: await response.json() };
}, { method, url, body });

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error('build/demo/client/index.html is missing. Run `yarn build:demo` first.');
    return 1;
  }
  const requested = [];
  const { server, origin } = await startServer(requested);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const foreign = [];
    page.on('request', request => {
      const url = request.url();
      if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
    });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${origin}/`);
    await check('banner and Reset demo button are shown', async () => {
      await page.getByText('vanish when you reload').first().waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Reset demo' }).waitFor({ timeout: 5000 });
    });

    await check('Transactions page shows a seeded description', async () => {
      await page.goto(`${origin}/transactions`);
      await page.getByText('Weekly shop').first().waitFor({ timeout: 15000 });
    });

    await check('header has no sign-in or account control', async () => {
      const labels = /sign in|log in|login|logout|log out|sign out/i;
      assert((await page.getByRole('button', { name: labels }).count()) === 0, 'found a sign-in/out button');
      assert((await page.getByRole('link', { name: labels }).count()) === 0, 'found a sign-in/out link');
    });

    await check('/settings shows no reminders section', async () => {
      await page.goto(`${origin}/settings`);
      await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 15000 });
      assert((await page.getByRole('heading', { name: 'Reminders' }).count()) === 0, 'Reminders heading present');
    });

    await check('a posted transaction appears in a GET and is gone after reload', async () => {
      await page.goto(`${origin}/transactions`);
      await page.getByText('Weekly shop').first().waitFor({ timeout: 15000 });
      const before = await apiCall(page, 'GET', LIST_URL);
      assert(before.status === 200 && before.demo, `GET answered ${before.status} without X-Demo`);
      const categories = await apiCall(page, 'GET', '/api/categories');
      const categoryId = categories.json.categories[0].categoryId;
      const today = new Date().toISOString().slice(0, 10);
      const created = await apiCall(page, 'POST', '/api/transactions', { type: 'EXPENSE', categoryId, amount: 1234, description: 'Smoke test purchase', date: today });
      assert(created.status >= 200 && created.status < 300, `POST answered ${created.status}`);
      const during = await apiCall(page, 'GET', LIST_URL);
      assert(JSON.stringify(during.json).includes('Smoke test purchase'), 'posted transaction missing from GET');
      await page.reload();
      await page.getByText('Weekly shop').first().waitFor({ timeout: 15000 });
      const after = await apiCall(page, 'GET', LIST_URL);
      assert(!JSON.stringify(after.json).includes('Smoke test purchase'), 'posted transaction survived reload');
    });

    await check('Reset demo leaves the seeded household in place', async () => {
      await page.getByRole('button', { name: 'Reset demo' }).click();
      await page.getByText('Weekly shop').first().waitFor({ timeout: 15000 });
      const after = await apiCall(page, 'GET', LIST_URL);
      assert(after.status === 200 && !JSON.stringify(after.json).includes('Smoke test purchase'), 'reset left the smoke purchase or failed');
      const categories = await apiCall(page, 'GET', '/api/categories');
      assert(categories.json.categories.length > 0, 'no categories after reset');
    });

    await check('no request goes to another origin', async () => {
      assert(foreign.length === 0, `foreign requests: ${foreign.join(', ')}`);
    });

    await check('the server saw no /api or /config.json request', async () => {
      const leaked = requested.filter(item => item.startsWith('/api') || item === '/config.json');
      assert(leaked.length === 0, `server saw: ${leaked.join(', ')}`);
    });

    await check('no uncaught page errors', async () => {
      assert(pageErrors.length === 0, pageErrors.join(' | '));
    });
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(result => !result.ok).length;
  console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks FAILED.`);
  return failed === 0 ? 0 : 1;
}

process.exit(await main());
