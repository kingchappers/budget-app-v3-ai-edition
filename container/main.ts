import { ConfigError } from './config';

export interface Started {
  port: number;
  close(): Promise<void>;
}

export interface MainDeps {
  start(onFatal: (reason: string) => void): Promise<Started>;
  exit(code: number): void;
  onSignal(handler: (signal: string) => void): void;
  // Called for an unhandled rejection or uncaught exception with the error's name only.
  onCrash(handler: (name: string) => void): void;
  log(message: string): void;
  error(message: string): void;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'Error');

// The process lifecycle: start, then shut down gracefully on a signal, a fatal Caddy failure or a crash. Only the first
// reason to stop counts; anything after it is ignored so the server is never closed twice or cut short.
export function runMain(deps: MainDeps): void {
  let stopping = false;
  let running: Started | undefined;

  const started = deps.start(reason => { void stop(reason, 1); });

  async function stop(reason: string, exitCode: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    deps.log(`Shutting down (${reason})`);
    let code = exitCode;
    try {
      // A stop that arrives before the server has finished starting has nothing to close yet; the process just exits.
      await running?.close();
    } catch (error) {
      deps.error(`Shutdown error: ${errorName(error)}`);
      code = code || 1;
    }
    deps.exit(code);
  }

  deps.onSignal(signal => { void stop(signal, 0); });
  deps.onCrash(name => {
    deps.error(`Unexpected error: ${name}`);
    void stop('unexpected error', 1);
  });

  started.then(
    server => {
      running = server;
      deps.log(`Listening on port ${server.port}`);
    },
    (error: unknown) => {
      deps.error(error instanceof ConfigError ? error.message : `Could not start: ${error instanceof Error ? error.message : String(error)}`);
      if (!stopping) {
        stopping = true;
        deps.exit(1);
      }
    },
  );
}
