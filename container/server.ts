import type { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handler as apiLambda } from '../api-handler';
import { initAuth, setAuth } from '../src/auth';
import { initStore, setStore } from '../src/store';
import { createBackup, newestBackupAgeSeconds, pruneBackups } from '../src/store/backup';
import { SqliteStore } from '../src/store/sqlite';
import { createStaticHandler } from '../src/static/handler';
import { createRequestListener, type HandlerResult } from './adapter';
import { parseConfig, type ContainerConfig } from './config';
import { startMaintenance } from './maintenance';

export interface RunningServer {
  config: ContainerConfig;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  clientDir?: string;
  log?: (message: string) => void;
  // Used by Task 8 (Caddy supervision).
  onFatal?: (reason: string) => void;
  spawnCaddy?: typeof spawn;
  // Test seam: replaces the real API Lambda handler.
  apiHandler?: (event: APIGatewayProxyEventV2) => Promise<HandlerResult>;
  // How long close() lets connections finish before cutting them (default 10 s).
  shutdownGraceMs?: number;
  // How long close() then waits for handlers still running before releasing the store (default 2 s).
  handlerGraceMs?: number;
}

const SHUTDOWN_GRACE_MS = 10_000;
const HANDLER_GRACE_MS = 2_000;

const SHUTTING_DOWN: HandlerResult = {
  statusCode: 503,
  headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
  body: '{"error":"Shutting down"}',
};

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'Error');

// Turns a listen failure into a message an operator can act on.
export function describeListenError(error: NodeJS.ErrnoException, port: number): Error {
  if (error.code === 'EADDRINUSE') return new Error(`Port ${port} is already in use`);
  if (error.code === 'EACCES') {
    return new Error(`Cannot listen on port ${port}: permission denied (use a port above 1023, or run the container with the right capability)`);
  }
  return error;
}

export async function startServer(env: NodeJS.ProcessEnv, options: StartOptions = {}): Promise<RunningServer> {
  const log = options.log ?? ((message: string) => console.log(message));
  const config = parseConfig(env);
  for (const warning of config.warnings) console.warn(warning);

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

  // The handlers read the registries on their first call, so initialising them here with an explicit environment is enough.
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...env,
    AUTH_MODE: 'local',
    STORE: 'sqlite',
    SQLITE_PATH: config.sqlitePath,
    COOKIE_SECURE: String(config.secureCookie),
    APP_ORIGIN: config.appOrigin ?? '',
  };
  const opened = await initStore(runtimeEnv);

  let maintenance: { stop(): void } | undefined;
  const releaseInternals = (): void => {
    maintenance?.stop();
    (opened as { close?: () => void }).close?.();
    setStore(undefined);
    setAuth(undefined);
  };

  try {
    if (!(opened instanceof SqliteStore)) throw new Error('The container requires the SQLite store');
    const store: SqliteStore = opened;
    // Logs the one-time setup code when there is no account yet.
    await initAuth(runtimeEnv);

    maintenance = startMaintenance(
      {
        purgeExpired: () => store.purgeExpired(),
        backup: now => {
          createBackup(store, config.backupDir, now);
          pruneBackups(config.backupDir, config.backupKeep);
        },
        newestBackupAgeSeconds: now => newestBackupAgeSeconds(config.backupDir, now),
        log,
      },
      { backupHour: config.backupHour, backupKeep: config.backupKeep },
    );

    const staticHandler = createStaticHandler(options.clientDir ?? env.CLIENT_DIR ?? path.resolve(process.cwd(), 'build/client'));
    const realApi = async (event: APIGatewayProxyEventV2): Promise<HandlerResult> =>
      (await apiLambda(event, {} as Context, () => undefined)) as HandlerResult;

    // Handlers still running at shutdown are waited for (briefly) before the store is released, and
    // nothing new starts once shutdown has begun, so no handler can touch the cleared registries.
    let shuttingDown = false;
    const inflight = new Set<Promise<unknown>>();
    const tracked = <E>(handle: (event: E) => Promise<HandlerResult>) => (event: E): Promise<HandlerResult> => {
      if (shuttingDown) return Promise.resolve(SHUTTING_DOWN);
      const promise: Promise<HandlerResult> = handle(event).finally(() => { inflight.delete(promise); });
      inflight.add(promise);
      return promise;
    };

    const server = createServer(createRequestListener({
      apiHandler: tracked(options.apiHandler ?? realApi),
      staticHandler: tracked((event: { rawPath: string }) => staticHandler(event) as Promise<HandlerResult>),
      configBody: JSON.stringify({ auth: 'local' }),
      trustProxy: config.trustProxy,
      isHealthy: async () => {
        await store.get({ PK: 'HEALTH', SK: 'PING' });
        return true;
      },
      log,
    }));
    server.headersTimeout = 15_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    // The request timeout is only checked this often, so it is enforced within ~5 s of its deadline.
    (server as { connectionsCheckingInterval?: number }).connectionsCheckingInterval = 5_000;
    server.on('error', (error: Error) => log(`Server error: ${errorName(error)}`));

    // With Caddy in front, only the loopback interface is exposed.
    const host = config.tlsDomain ? '127.0.0.1' : '0.0.0.0';
    await new Promise<void>((resolve, reject) => {
      const onListenError = (error: NodeJS.ErrnoException): void => reject(describeListenError(error, config.port));
      server.once('error', onListenError);
      server.listen(config.port, host, () => {
        server.off('error', onListenError);
        resolve();
      });
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;

    // close() waits up to shutdownGraceMs for connections, then at most handlerGraceMs more for handlers
    // still running (10 s + 2 s by default) before it releases the store. It never rejects.
    const shutdownGraceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
    const handlerGraceMs = options.handlerGraceMs ?? HANDLER_GRACE_MS;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        shuttingDown = true;
        maintenance?.stop();
        try {
          await new Promise<void>(resolve => {
            const force = setTimeout(() => server.closeAllConnections(), shutdownGraceMs);
            server.close(() => {
              clearTimeout(force);
              resolve();
            });
            server.closeIdleConnections();
          });
          let giveUp: NodeJS.Timeout | undefined;
          const timeout = new Promise<void>(resolve => {
            giveUp = setTimeout(resolve, handlerGraceMs);
            giveUp.unref();
          });
          await Promise.race([Promise.allSettled([...inflight]), timeout]);
          clearTimeout(giveUp);
        } catch (error) {
          log(`Shutdown error: ${errorName(error)}`);
        } finally {
          try {
            store.close();
          } catch (error) {
            log(`Closing the database failed: ${errorName(error)}`);
          }
          setStore(undefined);
          setAuth(undefined);
        }
      })();
      return closing;
    };

    return { config, port, close };
  } catch (error) {
    releaseInternals();
    throw error;
  }
}
