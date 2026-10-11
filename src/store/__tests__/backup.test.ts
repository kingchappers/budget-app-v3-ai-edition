import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName, backupToFile, createBackup, integrityCheck, listBackups, newestBackupAgeSeconds, pruneBackups,
} from '../backup';
import { SqliteStore } from '../sqlite';

let dir: string;
let store: SqliteStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'backup-'));
  store = new SqliteStore(join(dir, 'budget.sqlite'));
  await store.put({ PK: 'USER#u1', SK: 'CAT#a', name: 'Food' });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

describe('backupFileName', () => {
  it('uses local time in a sortable fixed-width form', () => {
    expect(backupFileName(new Date(2026, 9, 10, 3, 4, 5))).toBe('budget-20261010-030405.sqlite');
  });
});

describe('integrityCheck', () => {
  it('passes a real database and fails garbage without throwing', () => {
    const good = join(dir, 'good.sqlite');
    new DatabaseSync(good).close();
    expect(integrityCheck(good)).toBe(true);
    const bad = join(dir, 'bad.sqlite');
    writeFileSync(bad, 'this is not a database');
    expect(integrityCheck(bad)).toBe(false);
  });
});

describe('createBackup', () => {
  it('writes an owner-only, verified copy that contains the data', () => {
    const backups = join(dir, 'backups');
    const path = createBackup(store, backups, new Date(2026, 9, 10, 3, 0, 0));
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(statSync(backups).mode & 0o077).toBe(0);
    const copy = new DatabaseSync(path, { readOnly: true });
    const rows = copy.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    copy.close();
    expect(rows.n).toBe(1);
  });

  it('creates owner-only files even when the directory already exists with looser permissions', () => {
    const backups = join(dir, 'loose');
    mkdirSync(backups);
    chmodSync(backups, 0o755);
    const path = createBackup(store, backups, new Date(2026, 9, 10, 3, 0, 0));
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it('never overwrites: a second backup in the same second leaves the first untouched', () => {
    const backups = join(dir, 'backups');
    const when = new Date(2026, 9, 10, 3, 0, 0);
    const first = createBackup(store, backups, when);
    const before = statSync(first).mtimeMs;
    expect(() => createBackup(store, backups, when)).toThrow(/already exists/);
    expect(existsSync(first)).toBe(true);
    expect(statSync(first).mtimeMs).toBe(before);
  });

  it('removes only the file it just made when verification fails', () => {
    const backups = join(dir, 'backups');
    const kept = createBackup(store, backups, new Date(2026, 9, 9, 3, 0, 0));
    expect(() => createBackup(store, backups, new Date(2026, 9, 10, 3, 0, 0), () => false)).toThrow(/integrity/);
    expect(listBackups(backups)).toEqual([basename(kept)]);
  });
});

describe('backupToFile', () => {
  it('refuses an existing target and leaves its content intact', () => {
    const target = join(dir, 'manual.sqlite');
    writeFileSync(target, 'keep me');
    expect(() => backupToFile(store, target)).toThrow(/already exists/);
    expect(readFileSync(target, 'utf8')).toBe('keep me');
  });

  it('never lets a store failure delete a file it did not create', () => {
    const target = join(dir, 'other.sqlite');
    writeFileSync(target, 'someone else wrote this');
    const failing = { backupTo: () => { throw new Error('disk exploded'); } } as unknown as SqliteStore;
    expect(() => backupToFile(failing, target)).toThrow(/already exists/);
    expect(readFileSync(target, 'utf8')).toBe('someone else wrote this');
  });

  it('removes the file it reserved when the store fails part way', () => {
    const target = join(dir, 'partial.sqlite');
    const failing = {
      backupTo: (path: string) => { writeFileSync(path, 'partial'); throw new Error('disk exploded'); },
    } as unknown as SqliteStore;
    expect(() => backupToFile(failing, target)).toThrow(/disk exploded/);
    expect(existsSync(target)).toBe(false);
  });

  it('reports a missing directory without touching anything', () => {
    expect(() => backupToFile(store, join(dir, 'missing', 'x.sqlite'))).toThrow(/ENOENT/);
  });
});

describe('pruneBackups and listing', () => {
  function seed(names: string[]): string {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    for (const name of names) writeFileSync(join(backups, name), 'x');
    return backups;
  }

  it('keeps the newest N backups and ignores files that are not backups', () => {
    const backups = seed(['budget-20261001-030000.sqlite', 'budget-20261002-030000.sqlite', 'budget-20261003-030000.sqlite', 'notes.txt', 'budget-bad.sqlite']);
    expect(pruneBackups(backups, 2)).toBe(1);
    expect(readdirSync(backups).sort()).toEqual(['budget-20261002-030000.sqlite', 'budget-20261003-030000.sqlite', 'budget-bad.sqlite', 'notes.txt']);
  });

  it('never prunes when keep is below 1', () => {
    const backups = seed(['budget-20261001-030000.sqlite']);
    expect(pruneBackups(backups, 0)).toBe(0);
    expect(pruneBackups(backups, -1)).toBe(0);
    expect(listBackups(backups)).toHaveLength(1);
  });

  it('lists nothing for a missing directory', () => {
    expect(listBackups(join(dir, 'nope'))).toEqual([]);
  });
});

describe('newestBackupAgeSeconds', () => {
  it('is Infinity with no backups, otherwise the age of the newest file', () => {
    const backups = join(dir, 'backups');
    expect(newestBackupAgeSeconds(backups)).toBe(Infinity);
    mkdirSync(backups, { recursive: true });
    const file = join(backups, 'budget-20261001-030000.sqlite');
    writeFileSync(file, 'x');
    chmodSync(file, 0o600);
    const mtime = at('2026-10-01T03:00:00Z');
    utimesSync(file, mtime, mtime);
    expect(newestBackupAgeSeconds(backups, at('2026-10-01T04:00:00Z'))).toBe(3600);
  });
});
