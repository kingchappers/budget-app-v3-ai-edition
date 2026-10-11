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
  it('purges every tick and backs up only in the backup hour when the newest backup is old enough', () => {
    const due = deps(25 * HOUR);
    runTick(due, options, at(3));
    expect(due.purges).toBe(1);
    expect(due.backups).toHaveLength(1);

    const wrongHour = deps(25 * HOUR);
    runTick(wrongHour, options, at(4));
    expect(wrongHour.purges).toBe(1);
    expect(wrongHour.backups).toHaveLength(0);
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
