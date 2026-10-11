import type { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import type { Context } from 'aws-lambda';
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
}

const SHUTDOWN_GRACE_MS = 10_000;

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
  const store = await initStore(runtimeEnv);
  if (!(store instanceof SqliteStore)) throw new Error('The container requires the SQLite store');

  let maintenance: { stop(): void } | undefined;
  const releaseInternals = (): void => {
    maintenance?.stop();
    store.close();
    setStore(undefined);
    setAuth(undefined);
  };

  try {
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
    const server = createServer(createRequestListener({
      apiHandler: async event => (await apiLambda(event, {} as Context, () => undefined)) as HandlerResult,
      staticHandler: event => staticHandler(event) as Promise<HandlerResult>,
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

    // With Caddy in front, only the loopback interface is exposed.
    const host = config.tlsDomain ? '127.0.0.1' : '0.0.0.0';
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(error.code === 'EADDRINUSE' ? new Error(`Port ${config.port} is already in use`) : error);
      });
      server.listen(config.port, host, resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;

    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        maintenance?.stop();
        await new Promise<void>(resolve => {
          const force = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
          server.close(() => {
            clearTimeout(force);
            resolve();
          });
          server.closeIdleConnections();
        });
        store.close();
        setStore(undefined);
        setAuth(undefined);
      })();
      return closing;
    };

    return { config, port, close };
  } catch (error) {
    releaseInternals();
    throw error;
  }
}
