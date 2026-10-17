import { EventEmitter } from 'node:events';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const text = logSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
  const last = [...text.matchAll(/^(?:Setup|Recovery) code: (\S+)$/gm)].at(-1);
  if (!last) throw new Error('no setup code was logged');
  return last[1];
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
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ setupRequired: true, recoveryOpen: false });

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
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ setupRequired: false, recoveryOpen: false });
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

  it('refuses to start while another server in this process is still running', async () => {
    await start();
    await expect(startServer(env({ DATA_DIR: join(dir, 'other') }), { clientDir })).rejects.toThrow('Another server instance is still running in this process');
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
  it('lets an in-flight request finish before close() resolves, without lingering on keep-alive', async () => {
    let entered!: () => void;
    const inHandler = new Promise<void>(resolve => { entered = resolve; });
    let finished = false;
    const base = await start({}, { apiHandler: async () => { entered(); await sleep(150); finished = true; return ok('slow body'); } });
    const response = fetch(`${base}/api/anything`);
    await inHandler;

    const answered = response.then(async r => ({ status: r.status, body: await r.text() }));
    const started = performance.now();
    await running!.close();
    const elapsed = performance.now() - started;
    running = undefined;
    expect(finished).toBe(true);
    expect(elapsed).toBeLessThan(1500);
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
    let entered!: () => void;
    const inHandler = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await start({}, { apiHandler: async () => { calls += 1; entered(); await gate; return ok('first'); } });
    const socket = createConnection(running!.port, '127.0.0.1');
    let received = '';
    socket.on('data', chunk => { received += chunk.toString(); });
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    const request = 'GET /api/x HTTP/1.1\r\nHost: x\r\n\r\n';
    socket.write(request);
    await inHandler;
    // The connection is busy with the first request, so close() leaves it open; the second arrives mid-shutdown.
    const started = performance.now();
    const closed = running!.close();
    socket.write(request);
    // Node answers pipelined requests in order, so the second one is only parsed once the gated first one finishes.
    release();
    await closed;
    const elapsed = performance.now() - started;
    running = undefined;
    await socketClosed;
    expect(received).toContain('200 OK');
    expect(received).toContain('Shutting down');
    expect(calls).toBe(1);
    expect(elapsed).toBeLessThan(1500);
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

class FakeChild extends EventEmitter {
  killed: string | undefined;
  signals: string[] = [];
  ignoreTerm = false;
  kill(signal: string): boolean {
    this.signals.push(signal);
    this.killed = signal;
    if (this.ignoreTerm && signal === 'SIGTERM') return true;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

describe('Caddy supervision', () => {
  const tls = async (): Promise<NodeJS.ProcessEnv> => ({ TLS_DOMAIN: 'budget.example.com', TLS_EMAIL: 'me@example.com', PORT: String(await freePort()) });
  const asSpawn = (child: FakeChild): StartOptions['spawnCaddy'] => (() => child) as never;

  it('does not start Caddy without TLS_DOMAIN, and listens on all interfaces', async () => {
    const spawnCaddy = vi.fn();
    running = await startServer(env(), { clientDir, log: () => undefined, spawnCaddy: spawnCaddy as never });
    expect(spawnCaddy).not.toHaveBeenCalled();
    expect(running.host).toBe('0.0.0.0');
  });

  it('starts Caddy with a generated Caddyfile, binds loopback only and stops it on close', async () => {
    const child = new FakeChild();
    const spawnCaddy = vi.fn(() => child);
    const settings = await tls();
    running = await startServer(env(settings), { clientDir, log: () => undefined, spawnCaddy: spawnCaddy as never });
    expect(running.host).toBe('127.0.0.1');
    const [command, args, spawnOptions] = spawnCaddy.mock.calls[0] as unknown as [string, string[], { stdio: string; env: NodeJS.ProcessEnv }];
    expect(command).toBe('caddy');
    expect(args.slice(0, 2)).toEqual(['run', '--config']);
    expect(args.slice(3)).toEqual(['--adapter', 'caddyfile']);
    expect(spawnOptions.stdio).toBe('inherit');
    expect(spawnOptions.env.XDG_DATA_HOME).toBe(join(dir, 'data', 'caddy-data'));
    expect(spawnOptions.env.XDG_CONFIG_HOME).toBe(join(tmpdir(), 'caddy-config'));
    const caddyfile = readFileSync(args[2], 'utf8');
    expect(caddyfile).toContain('budget.example.com {');
    expect(caddyfile).toContain(`reverse_proxy 127.0.0.1:${settings.PORT}`);
    expect(caddyfile).toContain('email me@example.com');

    await running.close();
    running = undefined;
    expect(child.killed).toBe('SIGTERM');
  });

  it('writes the Caddyfile readable by its owner only and removes it on close', async () => {
    const child = new FakeChild();
    const spawnCaddy = vi.fn(() => child);
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: spawnCaddy as never });
    const file = (spawnCaddy.mock.calls[0] as unknown as [string, string[]])[1][2];
    expect(statSync(file).mode & 0o777).toBe(0o600);
    await running.close();
    running = undefined;
    expect(existsSync(file)).toBe(false);
  });

  it('reports Caddy dying as fatal', async () => {
    const child = new FakeChild();
    const onFatal = vi.fn();
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: asSpawn(child), onFatal });
    child.emit('exit', 1, null);
    expect(onFatal).toHaveBeenCalledWith(expect.stringMatching(/Caddy exited/));
  });

  it('does not report Caddy exiting as part of close() as fatal', async () => {
    const child = new FakeChild();
    const onFatal = vi.fn();
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: asSpawn(child), onFatal });
    await running.close();
    running = undefined;
    expect(child.killed).toBe('SIGTERM');
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('does not stop a Caddy that already exited, and does not report it twice', async () => {
    const child = new FakeChild();
    const onFatal = vi.fn();
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: asSpawn(child), onFatal });
    child.emit('exit', 1, null);
    await running.close();
    running = undefined;
    expect(child.signals).toEqual([]);
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it('kills a Caddy that ignores SIGTERM once the grace period is over, and still closes the store', async () => {
    const child = new FakeChild();
    child.ignoreTerm = true;
    const closeStore = vi.spyOn(SqliteStore.prototype, 'close');
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: asSpawn(child), shutdownGraceMs: 100 });
    await running.close();
    running = undefined;
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(closeStore).toHaveBeenCalledTimes(1);
  });

  it('reports a Caddy that cannot start', async () => {
    const child = new FakeChild();
    const onFatal = vi.fn();
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: asSpawn(child), onFatal });
    child.emit('error', new Error('spawn caddy ENOENT'));
    expect(onFatal).toHaveBeenCalledWith(expect.stringMatching(/Could not start Caddy/));
  });

  it('does not wait for a Caddy that failed to start when closing', async () => {
    const child = new FakeChild();
    child.ignoreTerm = true;
    running = await startServer(env(await tls()), { clientDir, log: () => undefined, spawnCaddy: asSpawn(child), onFatal: () => undefined, shutdownGraceMs: 5000 });
    child.emit('error', new Error('spawn caddy ENOENT'));
    const started = Date.now();
    await running.close();
    running = undefined;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('frees the port when Caddy cannot be started after the server is listening', async () => {
    const env1 = await tls();
    const throwing = (() => { throw new Error('spawn exploded'); }) as never;
    await expect(startServer(env(env1), { clientDir, log: () => undefined, spawnCaddy: throwing })).rejects.toThrow('spawn exploded');
    // Nothing is left listening on the port, and the registries are free again.
    running = await startServer(env(env1), { clientDir, log: () => undefined, spawnCaddy: asSpawn(new FakeChild()) });
    expect(running.port).toBe(Number(env1.PORT));
  });
});

describe('first-run code and password recovery', () => {
  const PASSWORD = 'a perfectly fine password';
  const NEW_PASSWORD = 'a different perfectly fine password';
  const codePath = (): string => join(dir, 'data', 'SETUP_CODE.txt');
  const markerPath = (): string => join(dir, 'data', 'RESET_PASSWORD');

  const call = (base: string, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', Origin: base, ...(init.cookie ? { Cookie: init.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const cookieOf = (res: Response): string => res.headers.getSetCookie()[0].split(';')[0];
  const status = async (base: string): Promise<{ setupRequired: boolean; recoveryOpen: boolean }> =>
    (await call(base, '/api/auth/status')).json() as Promise<{ setupRequired: boolean; recoveryOpen: boolean }>;
  const restart = async (): Promise<string> => {
    await running?.close();
    running = undefined;
    logSpy.mockClear();
    return start();
  };

  it('saves the code as an owner-only file while setup is pending and removes it once the account exists', async () => {
    const base = await start();
    const code = setupCodeFromLogs();
    expect(readFileSync(codePath(), 'utf8')).toBe(`${code}\n`);
    expect(statSync(codePath()).mode & 0o777).toBe(0o600);
    const res = await call(base, '/api/auth/setup', { body: { code, email: 'me@example.com', password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(existsSync(codePath())).toBe(false);
  });

  it('replaces a stale code file at start-up and removes the file at shutdown', async () => {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(codePath(), 'stale\n');
    await start();
    expect(readFileSync(codePath(), 'utf8')).toBe(`${setupCodeFromLogs()}\n`);
    await running?.close();
    running = undefined;
    expect(existsSync(codePath())).toBe(false);
  });

  it('just removes a marker when there is no account, and offers normal setup', async () => {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(markerPath(), '');
    const base = await start();
    expect(existsSync(markerPath())).toBe(false);
    expect(await status(base)).toEqual({ setupRequired: true, recoveryOpen: false });
    expect(logSpy.mock.calls.map((entry: unknown[]) => String(entry[0])).join('\n')).toMatch(/^Setup code: /m);
  });

  it('ignores a directory named RESET_PASSWORD and starts normally', async () => {
    mkdirSync(markerPath(), { recursive: true });
    const warn = vi.mocked(console.warn);
    const base = await start();
    expect(existsSync(markerPath())).toBe(true);
    expect(warn.mock.calls.map((entry: unknown[]) => String(entry[0])).join('\n')).toMatch(/not a regular file/);
    expect(await status(base)).toMatchObject({ recoveryOpen: false });
  });

  it('ignores a symlink named RESET_PASSWORD and starts normally', async () => {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const target = join(dir, 'elsewhere');
    writeFileSync(target, 'keep');
    symlinkSync(target, markerPath());
    const warn = vi.mocked(console.warn);
    const base = await start();
    expect(lstatSync(markerPath()).isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(warn.mock.calls.map((entry: unknown[]) => String(entry[0])).join('\n')).toMatch(/not a regular file/);
    expect(await status(base)).toMatchObject({ recoveryOpen: false });
  });

  it('removes a stale code file left by a crash when recovery is not requested', async () => {
    const base = await start();
    await call(base, '/api/auth/setup', { body: { code: setupCodeFromLogs(), email: 'me@example.com', password: PASSWORD } });
    await running?.close();
    running = undefined;
    writeFileSync(codePath(), 'stale\n');
    const next = await start();
    expect(existsSync(codePath())).toBe(false);
    expect(await status(next)).toEqual({ setupRequired: false, recoveryOpen: false });
  });

  it('recovers a forgotten password through the marker file, keeping the account and its data', async () => {
    let base = await start();
    const setup = await call(base, '/api/auth/setup', { body: { code: setupCodeFromLogs(), email: 'me@example.com', password: PASSWORD } });
    const oldCookie = cookieOf(setup);
    const { userId } = (await setup.json()) as { userId: string };

    await running?.close();
    running = undefined;
    writeFileSync(markerPath(), '');
    logSpy.mockClear();
    base = await start();

    expect(existsSync(markerPath())).toBe(false);
    expect(await status(base)).toEqual({ setupRequired: false, recoveryOpen: true });
    expect((await call(base, '/api/auth/me', { cookie: oldCookie })).status).toBe(401);
    const code = setupCodeFromLogs();
    expect(readFileSync(codePath(), 'utf8')).toBe(`${code}\n`);
    expect(logSpy.mock.calls.map((entry: unknown[]) => String(entry[0])).join('\n')).toMatch(/^Recovery code: /m);

    const recovered = await call(base, '/api/auth/setup', { body: { code, password: NEW_PASSWORD } });
    expect(recovered.status).toBe(200);
    expect(((await (await call(base, '/api/auth/me', { cookie: cookieOf(recovered) })).json()) as { userId: string }).userId).toBe(userId);
    expect((await call(base, '/api/auth/login', { body: { email: 'me@example.com', password: NEW_PASSWORD } })).status).toBe(200);
    expect((await call(base, '/api/auth/login', { body: { email: 'me@example.com', password: PASSWORD } })).status).toBe(401);
    expect(existsSync(codePath())).toBe(false);
    expect(await status(base)).toEqual({ setupRequired: false, recoveryOpen: false });
  });

  it('closes recovery again on a restart without a fresh marker, leaving no code file', async () => {
    let base = await start();
    await call(base, '/api/auth/setup', { body: { code: setupCodeFromLogs(), email: 'me@example.com', password: PASSWORD } });
    await running?.close();
    running = undefined;
    writeFileSync(markerPath(), '');
    base = await start();
    expect(await status(base)).toMatchObject({ recoveryOpen: true });
    base = await restart();
    expect(await status(base)).toMatchObject({ recoveryOpen: false });
    expect(existsSync(codePath())).toBe(false);
  });
});
