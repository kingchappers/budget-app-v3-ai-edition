import { runCli } from './src/store/cli';

runCli(process.argv.slice(2))
  .then(message => { console.log(message); })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
