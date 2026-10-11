import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '../../src/auth';
import { getStore } from '../../src/store';
import { SqliteStore } from '../../src/store/sqlite';
import type { HandlerResult } from '../adapter';
import { ConfigError } from '../config';
import { describeListenError, startServer, type RunningServer, type StartOptions } from '../server';

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
const start = async (extra: NodeJS.ProcessEnv = {}, options: StartOptions = {}) => {
  running = await startServer(env(extra), { clientDir, log: () => undefined, ...options });
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
    const failure = await startServer(env({ BACKUP_HOUR: '99', TLS_DOMAIN: 'bad host' }), { clientDir }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as ConfigError).message).toContain('BACKUP_HOUR');
    expect((failure as ConfigError).message).toContain('TLS_DOMAIN');
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

const ok = (body: string): HandlerResult => ({ statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body });
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('shutdown under load', () => {
  it('lets an in-flight request finish before close() resolves', async () => {
    let entered!: () => void;
    const inHandler = new Promise<void>(resolve => { entered = resolve; });
    let finished = false;
    const base = await start({}, { apiHandler: async () => { entered(); await sleep(150); finished = true; return ok('slow body'); } });
    const response = fetch(`${base}/api/anything`);
    await inHandler;

    const answered = response.then(async r => ({ status: r.status, body: await r.text() }));
    await running!.close();
    running = undefined;
    expect(finished).toBe(true);
    expect(await Promise.race([answered, sleep(1000)])).toEqual({ status: 200, body: 'slow body' });
  });

  it('cuts off a handler that never finishes, within the caps, and leaves the registries empty', async () => {
    let entered!: () => void;
    const inHandler = new Promise<void>(resolve => { entered = resolve; });
    const base = await start({}, {
      shutdownGraceMs: 200, handlerGraceMs: 200,
      apiHandler: () => { entered(); return new Promise<HandlerResult>(() => undefined); },
    });
    const response = fetch(`${base}/api/hang`).then(() => 'answered', () => 'failed');
    await inHandler;

    const started = Date.now();
    await running!.close();
    running = undefined;
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await response).toBe('failed');
    expect(() => getStore()).toThrow(/not initialised/);
    expect(() => getAuth()).toThrow(/not initialised/);
  });

  it('answers 503 to work that arrives after close() has started, without calling the handler', async () => {
    let calls = 0;
    await start({}, { apiHandler: async () => { calls += 1; await sleep(200); return ok('first'); } });
    const port = running!.port;
    const socket = createConnection(port, '127.0.0.1');
    let received = '';
    socket.on('data', chunk => { received += chunk.toString(); });
    const request = 'GET /api/x HTTP/1.1\r\nHost: x\r\n\r\n';
    socket.write(request);
    await sleep(50);
    // The connection is busy with the first request, so close() leaves it open; the second arrives mid-shutdown.
    const closed = running!.close();
    await sleep(50);
    socket.write(request);
    await closed;
    running = undefined;
    socket.destroy();
    expect(received).toContain('200 OK');
    expect(received).toContain('503');
    expect(received).toContain('Shutting down');
    expect(calls).toBe(1);
  });
});

describe('maintenance lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stops its timer on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const purge = vi.spyOn(SqliteStore.prototype, 'purgeExpired');
    await start();
    await running!.close();
    running = undefined;
    purge.mockClear();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(purge).not.toHaveBeenCalled();
  });

  it('stops its timer when the listen fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const purge = vi.spyOn(SqliteStore.prototype, 'purgeExpired');
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(0, '0.0.0.0', resolve));
    try {
      const port = (blocker.address() as { port: number }).port;
      await expect(startServer(env({ PORT: String(port) }), { clientDir })).rejects.toThrow(/already in use/);
      purge.mockClear();
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);
      expect(purge).not.toHaveBeenCalled();
    } finally {
      blocker.close();
    }
  });
});

describe('describeListenError', () => {
  const coded = (code: string): NodeJS.ErrnoException => Object.assign(new Error('raw'), { code });

  it('explains a permission failure', () => {
    expect(describeListenError(coded('EACCES'), 80).message).toMatch(/Cannot listen on port 80: permission denied/);
  });
  it('explains a port in use', () => {
    expect(describeListenError(coded('EADDRINUSE'), 80).message).toBe('Port 80 is already in use');
  });
  it('passes other errors through', () => {
    const error = coded('EOTHER');
    expect(describeListenError(error, 80)).toBe(error);
  });
});
