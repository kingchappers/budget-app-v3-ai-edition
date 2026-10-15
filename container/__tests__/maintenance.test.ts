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

// A fake store with a clock: backup() records the time and becomes the newest backup.
function world(last?: Date): MaintenanceDeps & { logs: string[]; backups: Date[]; purges: number } {
  let newest = last?.getTime();
  const state = deps(0);
  state.newestBackupAgeSeconds = now => (newest === undefined ? Infinity : (now.getTime() - newest) / 1000);
  state.backup = now => { state.backups.push(now); newest = now.getTime(); };
  return state;
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

  it('backs up on the next day\'s first tick after a mid-morning catch-up, and not on the ticks in between', () => {
    const w = world(new Date(2026, 9, 10, 10, 0, 0));
    for (const hour of [11, 12, 23]) runTick(w, options, at(hour));
    expect(w.backups).toHaveLength(0);
    // The next day's tick at 03:00 sees a backup 17 h old: it still predates that day's backup hour.
    runTick(w, options, new Date(2026, 9, 11, 3, 0, 0));
    expect(w.backups).toHaveLength(1);
  });

  it('is not due again 20 hours after a backup taken in the backup hour (hour 3: 23:00 tick; hour 0: 21:15 tick)', () => {
    const three = world(new Date(2026, 9, 10, 3, 0, 0));
    runTick(three, options, new Date(2026, 9, 10, 23, 0, 0, 50));
    expect(three.backups).toHaveLength(0);

    const zero = world();
    const midnight = { backupHour: 0, backupKeep: 7 };
    runTick(zero, midnight, new Date(2026, 9, 10, 0, 15, 0));
    runTick(zero, midnight, new Date(2026, 9, 10, 21, 15, 0));
    expect(zero.backups).toHaveLength(1);
  });

  it('counts a backup taken at 02:30 as the previous day\'s: the 03:00 tick backs up again (accepted)', () => {
    const w = world(new Date(2026, 9, 10, 2, 30, 0));
    runTick(w, options, at(3));
    expect(w.backups).toHaveLength(1);
  });

  it('retries a failed backup on the next tick and does not run again after it succeeds', () => {
    const w = world(new Date(2026, 9, 9, 3, 0, 0));
    let fail = true;
    const backup = w.backup;
    w.backup = now => { if (fail) throw new Error('disk full'); backup(now); };
    runTick(w, options, at(3));
    expect(w.backups).toHaveLength(0);
    fail = false;
    runTick(w, options, at(4));
    runTick(w, options, at(5));
    expect(w.backups).toEqual([at(4)]);
  });

  it.each([0, 1, 2, 3, 12, 23])('makes one backup per day, in the backup hour, over 14 hourly ticks with drift (BACKUP_HOUR %i)', backupHour => {
    const opts = { backupHour, backupKeep: 7 };
    const start = new Date(2026, 9, 10, 0, 0, 0).getTime();
    const w = world();
    runCatchUp(w, opts, new Date(start));
    expect(w.backups).toHaveLength(1);
    // Ticks at :15 plus 5 ms of drift per tick, from 01:15 on day 1 to 23:15 on day 14.
    for (let tick = 1; tick < 14 * 24; tick += 1) {
      runTick(w, opts, new Date(start + tick * HOUR * 1000 + 15 * 60 * 1000 + tick * 5));
    }
    const fromTicks = w.backups.slice(1);
    const days = fromTicks.map(when => when.getDate());
    expect(new Set(days).size).toBe(days.length);
    expect(fromTicks.every(when => when.getHours() === backupHour)).toBe(true);
    // The catch-up at 00:00 is day 1's backup only when the backup hour is 0.
    expect(fromTicks).toHaveLength(backupHour === 0 ? 13 : 14);
  });

  it('makes up a missed backup hour at the next tick', () => {
    const missed = world(new Date(2026, 9, 9, 3, 0, 0));
    runTick(missed, options, new Date(2026, 9, 10, 2, 59, 0));
    expect(missed.backups).toHaveLength(0);
    runTick(missed, options, new Date(2026, 9, 10, 4, 1, 0));
    expect(missed.backups).toHaveLength(1);
  });

  it('still backs up when the backup hour does not exist that day (DST spring-forward)', () => {
    // 2026-03-29 in Europe/London: 01:00 jumps to 02:00; in US zones 2026-03-08 02:00 jumps to 03:00.
    const day = new Date(2026, 2, 8, 3, 0, 0);
    const w = world(new Date(2026, 2, 7, 3, 0, 0));
    runTick(w, { backupHour: 2, backupKeep: 7 }, day);
    expect(w.backups).toHaveLength(1);
  });

  it('does not back up again on later ticks the same day', () => {
    const w = world(new Date(2026, 9, 10, 3, 0, 0));
    for (const hour of [3, 4, 12, 23]) runTick(w, options, at(hour));
    expect(w.backups).toHaveLength(0);
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
