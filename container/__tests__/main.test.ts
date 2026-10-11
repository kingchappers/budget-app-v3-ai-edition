import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../config';
import { runMain, type MainDeps, type Started } from '../main';

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function harness(startResult: () => Promise<Started>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const exit = vi.fn();
  let signal!: (name: string) => void;
  let crash!: (name: string) => void;
  let fatal!: (reason: string) => void;
  const deps: MainDeps = {
    start: onFatal => { fatal = onFatal; return startResult(); },
    exit,
    onSignal: handler => { signal = handler; },
    onCrash: handler => { crash = handler; },
    log: message => logs.push(message),
    error: message => errors.push(message),
  };
  runMain(deps);
  return { logs, errors, exit, signal: (name: string) => signal(name), crash: (name: string) => crash(name), fatal: (reason: string) => fatal(reason) };
}

const server = (close: () => Promise<void> = async () => undefined): Started & { close: ReturnType<typeof vi.fn> } =>
  ({ port: 8080, close: vi.fn(close) });

describe('runMain', () => {
  it('announces the port once started', async () => {
    const h = harness(async () => server());
    await flush();
    expect(h.logs).toEqual(['Listening on port 8080']);
  });

  it('closes once on SIGTERM and exits 0', async () => {
    const s = server();
    const h = harness(async () => s);
    await flush();
    h.signal('SIGTERM');
    await flush();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(h.logs).toContain('Shutting down (SIGTERM)');
  });

  it('ignores a second signal while stopping: one close, no early exit', async () => {
    let release!: () => void;
    const s = server(() => new Promise<void>(resolve => { release = resolve; }));
    const h = harness(async () => s);
    await flush();
    h.signal('SIGTERM');
    h.signal('SIGTERM');
    h.signal('SIGINT');
    await flush();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(h.exit).not.toHaveBeenCalled();
    release();
    await flush();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 after closing when something fatal happens', async () => {
    const s = server();
    const h = harness(async () => s);
    await flush();
    h.fatal('Caddy exited (1)');
    await flush();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(h.logs).toContain('Shutting down (Caddy exited (1))');
  });

  it('prints a ConfigError message verbatim and exits 1 when the start fails', async () => {
    const h = harness(async () => { throw new ConfigError(['PORT must be a whole number']); });
    await flush();
    expect(h.errors[0]).toContain('Invalid configuration');
    expect(h.errors[0]).toContain('PORT must be a whole number');
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('prefixes any other start failure', async () => {
    const h = harness(async () => { throw new Error('Port 80 is already in use'); });
    await flush();
    expect(h.errors).toEqual(['Could not start: Port 80 is already in use']);
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('still exits non-zero when closing fails, without leaking the message', async () => {
    const s = server(async () => { throw new TypeError('secret detail'); });
    const h = harness(async () => s);
    await flush();
    h.signal('SIGTERM');
    await flush();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(h.errors.join()).toContain('TypeError');
    expect(h.errors.join()).not.toContain('secret');
  });

  it('closes then exits 1 on a crash, logging only the error name', async () => {
    const s = server();
    const h = harness(async () => s);
    await flush();
    h.crash('RangeError');
    await flush();
    expect(h.errors).toEqual(['Unexpected error: RangeError']);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits 1 on a crash before the server has started', async () => {
    const h = harness(() => new Promise<Started>(() => undefined));
    h.crash('Error');
    await flush();
    await flush();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
