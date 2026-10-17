import { runMain } from './main';
import { startServer } from './server';

// User data must be owner-only; Caddy's files also become owner-only, which is fine.
process.umask(0o077);

runMain({
  start: onFatal => startServer(process.env, { onFatal }),
  exit: code => process.exit(code),
  onSignal: handler => {
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGINT', () => handler('SIGINT'));
  },
  onCrash: handler => {
    const crashed = (error: unknown): void => handler(error instanceof Error ? error.name : 'Error');
    process.on('unhandledRejection', crashed);
    process.on('uncaughtException', crashed);
  },
  log: message => console.log(message),
  error: message => console.error(message),
});
