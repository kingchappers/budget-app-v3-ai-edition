import { runMain } from './main';
import { startServer } from './server';

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
