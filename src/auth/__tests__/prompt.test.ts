import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { promptHidden } from '../prompt';

function setup(tty: boolean) {
  const setRawMode = vi.fn();
  const stdin = Object.assign(new PassThrough(), { isTTY: tty, setRawMode }) as unknown as NodeJS.ReadStream & { setRawMode: typeof setRawMode };
  const stdout = new PassThrough();
  let written = '';
  stdout.on('data', chunk => { written += chunk.toString(); });
  const run = promptHidden('New password: ', { stdin, stdout: stdout as unknown as NodeJS.WriteStream });
  return { stdin, run, written: () => written };
}

function rawModeRestored(stdin: { setRawMode: ReturnType<typeof vi.fn> }): boolean {
  const calls = stdin.setRawMode.mock.calls;
  return calls.length >= 2 && calls[calls.length - 1][0] === false;
}

describe('promptHidden (TTY)', () => {
  it('resolves with the typed text on Enter, restores raw mode and never echoes', async () => {
    const { stdin, run, written } = setup(true);
    stdin.write('hunter two');
    stdin.write('\r');
    await expect(run).resolves.toBe('hunter two');
    expect(rawModeRestored(stdin)).toBe(true);
    expect(written()).toBe('New password: \n');
  });

  it('rejects on Ctrl-C and restores raw mode', async () => {
    const { stdin, run } = setup(true);
    stdin.write('abc\u0003');
    await expect(run).rejects.toThrow('Cancelled');
    expect(rawModeRestored(stdin)).toBe(true);
  });

  it('rejects on Ctrl-D, restores raw mode and never puts it in a value', async () => {
    const { stdin, run } = setup(true);
    stdin.write('\u0004');
    await expect(run).rejects.toThrow('Cancelled');
    expect(rawModeRestored(stdin)).toBe(true);
  });

  it('rejects when the stream ends and restores raw mode', async () => {
    const { stdin, run } = setup(true);
    stdin.end();
    await expect(run).rejects.toThrow('Cancelled');
    expect(rawModeRestored(stdin)).toBe(true);
  });

  it('removes the last character on backspace', async () => {
    const { stdin, run } = setup(true);
    stdin.write('abcd\u007f\u007fx\r');
    await expect(run).resolves.toBe('abx');
  });

  it('ignores escape sequences such as arrow keys', async () => {
    const { stdin, run } = setup(true);
    stdin.write('a\u001b[Db\r');
    await expect(run).resolves.toBe('ab');
  });
});

describe('promptHidden (not a TTY)', () => {
  it('rejects on an empty stream', async () => {
    const { stdin, run } = setup(false);
    stdin.end();
    await expect(run).rejects.toThrow('No password was provided on stdin');
  });

  it('resolves with the first line', async () => {
    const { stdin, run } = setup(false);
    stdin.write('a long enough password\n');
    await expect(run).resolves.toBe('a long enough password');
  });
});
