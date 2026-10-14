import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCatchUp, runTick, startMaintenance, type MaintenanceDeps } from '../maintenance';

const HOUR = 3600;
const options = { backupHour: 3, backupKeep: 7 };
const at = (hour: number) => new Date(2026, 9, 10, hour, 0, 0);

function deps(ageSeconds: number): MaintenanceDeps & { logs: string[]; backups: Date[]; purges: number } {
  const state = { logs: [] as string[], backups: [] as Date[], purges: 0 };
  return Object.assign(state, {
    purgeExpired: () => { state.purges += 1; return 0; },
    backup: (now: Date) => { state.backups.push(now); },
    newestBackupAgeSeconds: () => ageSeconds,
    log: (message: string) => { state.logs.push(message); },
  });
}

describe('runTick', () => {
  it('purges every tick and backs up from the backup hour on, never before it', () => {
    const due = deps(25 * HOUR);
    runTick(due, options, at(3));
    expect(due.purges).toBe(1);
    expect(due.backups).toHaveLength(1);

    const beforeHour = deps(25 * HOUR);
    runTick(beforeHour, options, at(2));
    expect(beforeHour.purges).toBe(1);
    expect(beforeHour.backups).toHaveLength(0);
  });

  it('does not skip the day after a catch-up taken mid-morning (17 h old at 03:00, 41 h old the next day)', () => {
    const afterCatchUp = deps(17 * HOUR);
    runTick(afterCatchUp, options, at(3));
    expect(afterCatchUp.backups).toHaveLength(0);

    const nextDay = deps(41 * HOUR);
    runTick(nextDay, options, at(3));
    expect(nextDay.backups).toHaveLength(1);
  });

  it('treats exactly 20 hours as not yet due and 20 hours and a second as due', () => {
    const boundary = deps(20 * HOUR);
    runTick(boundary, options, at(3));
    expect(boundary.backups).toHaveLength(0);

    const over = deps(20 * HOUR + 1);
    runTick(over, options, at(3));
    expect(over.backups).toHaveLength(1);
  });

  it('makes up a missed backup hour at the next tick', () => {
    const missed = deps(30 * HOUR);
    runTick(missed, options, new Date(2026, 9, 10, 2, 59, 0));
    expect(missed.backups).toHaveLength(0);
    runTick(missed, options, new Date(2026, 9, 10, 4, 1, 0));
    expect(missed.backups).toHaveLength(1);
  });

  it('still backs up when the backup hour does not exist that day (DST spring-forward)', () => {
    const skippedHour = deps(30 * HOUR);
    runTick(skippedHour, { backupHour: 2, backupKeep: 7 }, at(3));
    expect(skippedHour.backups).toHaveLength(1);
  });

  it('runs once for two ticks in the same day', () => {
    const start = at(3).getTime();
    let lastBackup = start - 30 * HOUR * 1000;
    const clocked = deps(0);
    clocked.newestBackupAgeSeconds = now => (now.getTime() - lastBackup) / 1000;
    clocked.backup = now => { clocked.backups.push(now); lastBackup = now.getTime(); };
    runTick(clocked, options, at(3));
    runTick(clocked, options, at(4));
    runTick(clocked, options, at(23));
    expect(clocked.backups).toHaveLength(1);
  });

  it('does not back up twice in a day', () => {
    const recent = deps(1 * HOUR);
    runTick(recent, options, at(3));
    expect(recent.backups).toHaveLength(0);
  });

  it('never backs up when BACKUP_KEEP is 0', () => {
    const off = deps(Infinity);
    runTick(off, { backupHour: 3, backupKeep: 0 }, at(3));
    runCatchUp(off, { backupHour: 3, backupKeep: 0 }, at(3));
    expect(off.backups).toHaveLength(0);
  });

  it('logs a failure by error name only and never throws', () => {
    const failing = deps(25 * HOUR);
    failing.backup = () => { throw Object.assign(new Error('path /data/secret leaked'), { name: 'SqliteError' }); };
    failing.purgeExpired = () => { throw new Error('boom'); };
    expect(() => runTick(failing, options, at(3))).not.toThrow();
    const logged = failing.logs.join(' ');
    expect(logged).toContain('SqliteError');
    expect(logged).not.toContain('/data/secret');
    expect(logged).not.toContain('boom');
  });

  it('adds a plain Node error code to the failure line, but never the message or a path', () => {
    const denied = deps(25 * HOUR);
    denied.backup = () => { throw Object.assign(new Error("EACCES: permission denied, open '/data/backups/x'"), { code: 'EACCES' }); };
    denied.purgeExpired = () => { throw Object.assign(new Error('disk /data/full'), { code: 'ENOSPC' }); };
    runTick(denied, options, at(3));
    expect(denied.logs).toContain('Backup failed: Error (EACCES)');
    expect(denied.logs).toContain('Expired-item purge failed: Error (ENOSPC)');
    expect(denied.logs.join(' ')).not.toContain('/data');
  });

  it('leaves out an error code with odd characters', () => {
    const odd = deps(25 * HOUR);
    odd.backup = () => { throw Object.assign(new Error('x'), { code: '/data/secret path' }); };
    runTick(odd, options, at(3));
    expect(odd.logs).toEqual(['Backup failed: Error']);
  });

  it('survives the age lookup throwing', () => {
    const broken = deps(0);
    broken.newestBackupAgeSeconds = () => { throw new Error('unreadable'); };
    expect(() => runTick(broken, options, at(3))).not.toThrow();
  });
});

describe('runCatchUp', () => {
  it('backs up at start when there is none, or the newest is over a day old', () => {
    const none = deps(Infinity);
    runCatchUp(none, options, at(10));
    expect(none.backups).toHaveLength(1);

    const stale = deps(25 * HOUR);
    runCatchUp(stale, options, at(10));
    expect(stale.backups).toHaveLength(1);
  });

  it('does nothing when the newest backup is recent', () => {
    const fresh = deps(2 * HOUR);
    runCatchUp(fresh, options, at(10));
    expect(fresh.backups).toHaveLength(0);
  });
});

describe('startMaintenance', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('catches up at start, ticks hourly and stops cleanly', () => {
    const d = deps(Infinity);
    const maintenance = startMaintenance(d, options, () => new Date());
    expect(d.backups).toHaveLength(1);
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(d.purges).toBe(3);
    maintenance.stop();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(d.purges).toBe(3);
  });
});
