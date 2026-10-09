import { createInterface } from 'node:readline';

interface PromptStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

// Reads a line without echoing it. A password never goes through argv or the environment,
// where it would land in shell history and process listings.
export function promptHidden(
  question: string,
  streams: PromptStreams = { stdin: process.stdin, stdout: process.stdout },
): Promise<string> {
  const { stdin, stdout } = streams;

  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const lines = createInterface({ input: stdin });
      lines.once('close', () => reject(new Error('No password was provided on stdin')));
      lines.once('line', line => { resolve(line); lines.close(); });
      stdin.once('error', reject);
    });
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    let value = '';
    let escape: 'none' | 'started' | 'csi' = 'none';

    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const cancel = (error: Error): void => {
      cleanup();
      stdout.write('\n');
      reject(error);
    };
    const onEnd = (): void => cancel(new Error('Cancelled'));
    const onError = (error: Error): void => cancel(error);
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (escape === 'started') { escape = char === '[' ? 'csi' : 'none'; continue; }
        if (escape === 'csi') { if (char >= '@' && char <= '~') escape = 'none'; continue; }
        if (char === '\u001b') { escape = 'started'; continue; }
        if (char === '\u0003' || char === '\u0004') { cancel(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        value += char;
      }
    };

    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.once('error', onError);
  });
}
