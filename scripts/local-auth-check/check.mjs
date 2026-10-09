// Throwaway browser check for the built-in login (AUTH_MODE=local). Not a CI test.
// Run: yarn build (dummy VITE_AUTH0_* values), then PATH=$PWD/node_modules/.bin:$PATH node scripts/local-auth-check/build.cjs, then node scripts/local-auth-check/check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMAIL = 'owner@example.invalid';
const PASSWORD = 'correct horse battery staple';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  const dir = mkdtempSync(path.join(process.env.CHECK_TMP_DIR || tmpdir(), 'local-auth-check-'));
  const child = spawn('node', [path.join(HERE, 'server.cjs')], {
    env: { ...process.env, PORT: String(port), SQLITE_PATH: path.join(dir, 'check.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  const waiters = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const line of parts) {
      lines.push(line);
      waiters.forEach(check => check());
    }
  });
  child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));
  const waitFor = (pattern, ms = 20000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), ms);
    const check = () => {
      const hit = lines.map(line => line.match(pattern)).find(Boolean);
      if (!hit) return;
      clearTimeout(timer);
      resolve(hit);
    };
    waiters.push(check);
    check();
  });
  return { child, waitFor };
}

async function step(name, action) {
  try {
    await action();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main(server, url) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Hide the first-run tour and "What's changed" cards, whose overlay would otherwise block the Profile menu.
    await context.addInitScript(() => {
      window.localStorage.setItem('budget.preferences', JSON.stringify({ seenReleases: ['menu-2026-10', 'names-2026-10'], tourStep: 3 }));
    });
    const page = await context.newPage();
    const dialog = page.getByRole('dialog');
    const signIn = page.getByRole('button', { name: 'Sign in' }).first();
    const profileEmail = page.locator('.profile-email');

    let code;
    await step('the server prints a setup code', async () => {
      await fetch(`${url}/api/auth/status`); // the provider starts on the first request
      code = (await server.waitFor(/enter this setup code to create your account: (\S+)/))[1];
      assert(code.length > 0, 'empty setup code');
    });

    await step('signed-out state shows Sign in', async () => {
      await page.goto(url);
      await signIn.waitFor({ timeout: 20000 });
      assert(await profileEmail.count() === 0, 'profile visible while signed out');
    });

    await step('setup form creates the account and signs in', async () => {
      await signIn.click();
      await dialog.waitFor();
      await dialog.getByLabel('Setup code').fill(code);
      await dialog.getByLabel('Email').fill(EMAIL);
      await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await dialog.getByRole('button', { name: 'Create account' }).click();
      await profileEmail.waitFor({ timeout: 20000 });
      assert((await profileEmail.textContent()).trim() === EMAIL, 'profile email does not match');
    });

    await step('still signed in after a reload', async () => {
      await page.reload();
      await profileEmail.waitFor({ timeout: 20000 });
      assert((await profileEmail.textContent()).trim() === EMAIL, 'profile email does not match');
    });

    await step('the session cookie is HttpOnly (not in document.cookie)', async () => {
      const visible = await page.evaluate(() => document.cookie);
      assert(!visible.includes('budget_session'), `document.cookie exposes the session: ${visible}`);
      const stored = (await context.cookies()).find(cookie => cookie.name === 'budget_session');
      assert(stored && stored.httpOnly && stored.sameSite === 'Strict', 'cookie missing or not HttpOnly/SameSite=Strict');
    });

    await step('a second /api/auth/setup is refused with 409', async () => {
      const response = await page.request.post(`${url}/api/auth/setup`, {
        headers: { Origin: url },
        data: { code, email: 'second@example.invalid', password: PASSWORD },
      });
      assert(response.status() === 409, `expected 409, got ${response.status()}`);
    });

    let oldCookie;
    await step('logout returns to the signed-out state', async () => {
      const stored = (await context.cookies()).find(cookie => cookie.name === 'budget_session');
      assert(stored, 'no session cookie before logout');
      oldCookie = stored.value;
      await profileEmail.click();
      await page.getByRole('menuitem', { name: 'Logout' }).click();
      await signIn.waitFor({ timeout: 20000 });
      assert(await profileEmail.count() === 0, 'profile still visible after logout');
    });

    await step('the old session cookie is rejected server-side after logout', async () => {
      const response = await fetch(`${url}/api/auth/me`, { headers: { Cookie: `budget_session=${oldCookie}` } });
      assert(response.status === 401, `expected 401, got ${response.status}`);
    });

    await step('a wrong password shows an error', async () => {
      await signIn.click();
      await dialog.waitFor();
      await dialog.getByLabel('Email').fill(EMAIL);
      await dialog.getByLabel('Password', { exact: true }).fill('not the right password');
      await dialog.getByRole('button', { name: 'Sign in' }).click();
      const alert = dialog.getByRole('alert');
      await alert.waitFor({ timeout: 20000 });
      assert((await alert.textContent()).includes('Invalid email or password'), `unexpected alert: ${await alert.textContent()}`);
      assert(await profileEmail.count() === 0, 'signed in with a wrong password');
    });

    await step('signing in with the password works', async () => {
      await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await dialog.getByRole('button', { name: 'Sign in' }).click();
      await profileEmail.waitFor({ timeout: 20000 });
      assert((await profileEmail.textContent()).trim() === EMAIL, 'profile email does not match');
    });
  } finally {
    await browser.close();
  }
}

const port = await freePort();
const server = startServer(port);
let failed = false;
try {
  await server.waitFor(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
  await main(server, `http://127.0.0.1:${port}`);
  console.log('All steps passed');
} catch (error) {
  failed = true;
  console.log(`Check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  server.child.kill();
}
process.exit(failed ? 1 : 0);
