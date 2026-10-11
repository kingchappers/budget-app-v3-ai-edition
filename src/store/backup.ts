import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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
export function backupToFile(store: SqliteStore, path: string, verify: (path: string) => boolean = integrityCheck): void {
  if (existsSync(path)) throw new Error(`Backup ${path} already exists`);
  try {
    store.backupTo(path);
    chmodSync(path, 0o600);
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

export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => BACKUP_PATTERN.test(name)).sort();
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
