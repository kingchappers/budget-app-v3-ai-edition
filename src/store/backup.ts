import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteStore } from './sqlite';

export const BACKUP_PATTERN = /^budget-\d{8}-\d{6}\.sqlite$/;

const pad = (value: number): string => String(value).padStart(2, '0');

// Local time (the container sets TZ), fixed width, so names sort chronologically.
export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `budget-${date}-${time}.sqlite`;
}

export function integrityCheck(path: string): boolean {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      return rows.length === 1 && rows[0].integrity_check === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

// Writes one verified, owner-only copy of the database. Never overwrites, and removes only the file it created.
// The name is reserved exclusively (0600) first, so a file made by someone else can never reach the cleanup below.
export function backupToFile(store: SqliteStore, path: string, verify: (path: string) => boolean = integrityCheck): void {
  try {
    closeSync(openSync(path, 'wx', 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Backup ${path} already exists`);
    throw error;
  }
  try {
    store.backupTo(path);
    if (!verify(path)) throw new Error('The backup failed its integrity check');
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

export function createBackup(
  store: SqliteStore,
  dir: string,
  now: Date = new Date(),
  verify: (path: string) => boolean = integrityCheck,
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, backupFileName(now));
  backupToFile(store, path, verify);
  return path;
}

// Oldest first, by file mtime with the name as the tiebreak: a TZ change or a DST fall-back can make a newer
// backup sort earlier by name. Zero-byte files (a name reserved by a crashed backup) are not backups.
export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of readdirSync(dir)) {
    if (!BACKUP_PATTERN.test(name)) continue;
    const info = statSync(join(dir, name), { throwIfNoEntry: false });
    if (!info || !info.isFile() || info.size === 0) continue;
    found.push({ name, mtimeMs: info.mtimeMs });
  }
  found.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found.map(entry => entry.name);
}

// Call only after a backup has been verified, so a corrupt backup can never push out a good one.
export function pruneBackups(dir: string, keep: number): number {
  if (keep < 1) return 0;
  const stale = listBackups(dir).slice(0, -keep);
  for (const name of stale) rmSync(join(dir, name), { force: true });
  return stale.length;
}

export function newestBackupAgeSeconds(dir: string, now: Date = new Date()): number {
  const newest = listBackups(dir).pop();
  if (!newest) return Infinity;
  return Math.max(0, (now.getTime() - statSync(join(dir, newest)).mtimeMs) / 1000);
}
