import { createInterface } from 'node:readline';

// Reads a line without echoing it. A password never goes through argv or the environment,
// where it would land in shell history and process listings.
export function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const lines = createInterface({ input: stdin });
      lines.once('line', line => { lines.close(); resolve(line); });
      lines.once('error', reject);
    });
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    let value = '';
    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
