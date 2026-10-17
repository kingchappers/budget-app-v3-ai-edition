import { lstatSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CodeHooks } from '../src/auth/local';

export const SETUP_CODE_FILE = 'SETUP_CODE.txt';
export const RESET_MARKER_FILE = 'RESET_PASSWORD';

export type MarkerResult = 'none' | 'consumed' | 'refused';

type Warn = (message: string) => void;

// Names a failure without a path or message, which could carry data.
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Error';
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? `${error.name} (${code})` : error.name;
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

// Recovery is armed by creating an empty file named RESET_PASSWORD in the data folder. Anyone who can do that can already
// read or replace the whole database. The marker is deleted before recovery opens, and if it cannot be deleted recovery
// stays closed, so a marker that cannot be removed cannot re-arm recovery on every restart. Its contents are never read.
export function consumeResetMarker(dataDir: string, warn: Warn, unlink: (target: string) => void = unlinkSync): MarkerResult {
  const marker = path.join(dataDir, RESET_MARKER_FILE);

  let isFile: boolean;
  try {
    isFile = lstatSync(marker).isFile();
  } catch (error) {
    if (isMissing(error)) return 'none';
    warn(`Could not check ${RESET_MARKER_FILE}: ${describeFailure(error)}. Password recovery was not opened.`);
    return 'refused';
  }

  if (!isFile) {
    warn(`${RESET_MARKER_FILE} is not a regular file, so it was ignored. Remove it and create an empty file with that name to recover your password.`);
    return 'none';
  }

  try {
    unlink(marker);
  } catch (error) {
    warn(`Could not delete ${RESET_MARKER_FILE}: ${describeFailure(error)}. Password recovery was not opened.`);
    return 'refused';
  }
  return 'consumed';
}

function removeFile(target: string, warn: Warn): void {
  try {
    rmSync(target, { force: true });
  } catch (error) {
    warn(`Could not remove ${path.basename(target)}: ${describeFailure(error)}`);
  }
}

// Removes the code file and its temporary name: used for a stale file at start-up, at shutdown and once the code is used.
export function removeCodeFile(dataDir: string, warn: Warn): void {
  const file = path.join(dataDir, SETUP_CODE_FILE);
  removeFile(file, warn);
  removeFile(`${file}.tmp`, warn);
}

function formatBlock(code: string, kind: 'setup' | 'recovery'): string {
  const rule = '='.repeat(60);
  const [label, action] = kind === 'setup'
    ? ['Setup code', 'Open the app and enter this code to create your account.']
    : ['Recovery code', 'Open the app and enter this code to set a new password.'];
  return [
    rule,
    `${label}: ${code}`,
    action,
    `The code is also saved as ${SETUP_CODE_FILE} in your data folder until you use it.`,
    rule,
  ].join('\n');
}

export function createCodeHooks(dataDir: string, io: { print(text: string): void; warn: Warn }): CodeHooks {
  const file = path.join(dataDir, SETUP_CODE_FILE);
  const temporary = `${file}.tmp`;
  return {
    announce(code, kind) {
      io.print(formatBlock(code, kind));
      try {
        // Exclusive create applies the mode and never follows a symlink, so any stale entry is cleared first.
        rmSync(temporary, { force: true });
        writeFileSync(temporary, `${code}\n`, { mode: 0o600, flag: 'wx' });
        renameSync(temporary, file);
      } catch (error) {
        io.warn(`Could not write ${SETUP_CODE_FILE}: ${describeFailure(error)}. The code is in this log.`);
        // The temporary file may hold the code, so a failure to remove it is reported too.
        removeFile(temporary, io.warn);
      }
    },
    retire() {
      removeCodeFile(dataDir, io.warn);
    },
  };
}
