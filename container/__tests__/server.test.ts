import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteStore } from '../../src/store/sqlite';
import { ConfigError } from '../config';
import { startServer, type RunningServer } from '../server';

let dir: string;
let clientDir: string;
let running: RunningServer | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'container-'));
  clientDir = join(dir, 'client');
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<html><body>app</body></html>');
  // The built SPA ships an Auth0 config.json; the container must ignore it.
  writeFileSync(join(clientDir, 'config.json'), '{"auth":"auth0","domain":"x","clientId":"y","audience":"z"}');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ DATA_DIR: join(dir, 'data'), PORT: '0', ...extra });
const start = async (extra: NodeJS.ProcessEnv = {}) => {
  running = await startServer(env(extra), { clientDir, log: () => undefined });
  return `http://127.0.0.1:${running.port}`;
};
const setupCodeFromLogs = (): string => {
  const line = logSpy.mock.calls.map((call: unknown[]) => String(call[0])).find((text: string) => text.includes('setup code'));
  const match = line?.match(/: (\S+)$/);
  if (!match) throw new Error('no setup code was logged');
  return match[1];
};

describe('serving', () => {
  it('serves health, the runtime config (not the built file) and the app shell with a CSP header', async () => {
    const base = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect(await (await fetch(`${base}/config.json`)).json()).toEqual({ auth: 'local' });
    const page = await fetch(`${base}/some/route`);
    expect(await page.text()).toContain('app');
    expect(page.headers.get('content-security-policy-report-only')).toBeTruthy();
  });

  it('never exposes the built Auth0 config.json through a path variant', async () => {
    const base = await start();
    // fetch would normalise "//config.json" and "%63" in a URL, so send the raw targets over a socket.
    const { request } = await import('node:http');
    const get = (target: string): Promise<string> => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: running!.port, path: target, method: 'GET' }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve(text));
      });
      req.on('error', reject);
      req.end();
    });
    expect(base).toContain('127.0.0.1');
    expect(JSON.parse(await get('//config.json'))).toEqual({ auth: 'local' });
    expect(JSON.parse(await get('/%63onfig.json'))).toEqual({ auth: 'local' });
  });

  it('runs the whole login flow against a real database and keeps the session across a restart', async () => {
    let base = await start();
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ setupRequired: true });

    const code = setupCodeFromLogs();
    const origin = base;
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ code, email: 'me@example.com', password: 'a perfectly fine password' }),
    });
    expect(setup.status).toBe(200);
    const cookie = setup.headers.getSetCookie()[0].split(';')[0];
    expect(cookie.startsWith('budget_session=')).toBe(true);

    expect((await fetch(`${base}/api/categories`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(`${base}/api/categories`)).status).toBe(401);

    await running!.close();
    running = undefined;
    base = await start();
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ setupRequired: false });
    expect((await fetch(`${base}/api/categories`, { headers: { Cookie: cookie } })).status).toBe(200);
  });
});

describe('boot', () => {
  it('takes a catch-up backup on the first start', async () => {
    await start();
    const backups = join(dir, 'data', 'backups');
    expect(existsSync(backups)).toBe(true);
    expect(readdirSync(backups).filter(name => name.endsWith('.sqlite'))).toHaveLength(1);
  });

  it('takes none when BACKUP_KEEP=0', async () => {
    await start({ BACKUP_KEEP: '0' });
    expect(existsSync(join(dir, 'data', 'backups'))).toBe(false);
  });

  it('refuses an invalid environment with every problem listed', async () => {
    await expect(startServer(env({ BACKUP_HOUR: '99', TLS_DOMAIN: 'bad host' }), { clientDir })).rejects.toBeInstanceOf(ConfigError);
  });

  it('refuses a database created by a newer version, with a clear message', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(dir, 'data'), { recursive: true });
    const db = new DatabaseSync(join(dir, 'data', 'budget.sqlite'));
    db.exec('PRAGMA user_version = 99');
    db.close();
    await expect(startServer(env(), { clientDir })).rejects.toThrow(/newer version/);
  });

  it('reports a port that is already in use, and leaves nothing running', async () => {
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(0, '0.0.0.0', resolve));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(startServer(env({ PORT: String(port) }), { clientDir })).rejects.toThrow(/already in use/);
      // A second start on a free port must work: the failed one released the database and the registries.
      // A different data directory proves the registries were cleared: a leftover store would be reused instead.
      const base = await start({ DATA_DIR: join(dir, 'data2') });
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect(existsSync(join(dir, 'data2', 'budget.sqlite'))).toBe(true);
    } finally {
      blocker.close();
    }
  });
});

describe('shutdown', () => {
  it('closes the port and the database, and may be called twice', async () => {
    const base = await start();
    const server = running!;
    const closeStore = vi.spyOn(SqliteStore.prototype, 'close');
    await server.close();
    await server.close();
    running = undefined;
    expect(closeStore).toHaveBeenCalledTimes(1);
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });
});
