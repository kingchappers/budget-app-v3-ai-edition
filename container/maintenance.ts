export interface MaintenanceDeps {
  purgeExpired(): number;
  backup(now: Date): void;
  newestBackupAgeSeconds(now: Date): number;
  log(message: string): void;
}

export interface MaintenanceOptions {
  backupHour: number;
  backupKeep: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;
// A day's backup is due once the newest is older than this, so a restart inside the backup hour cannot double-run it.
const DUE_AFTER_SECONDS = 20 * 60 * 60;

// The error name only: a message can echo paths or SQL.
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'Error');

function attempt(deps: MaintenanceDeps, label: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    deps.log(`${label} failed: ${errorName(error)}`);
  }
}

function backupIfOlderThan(deps: MaintenanceDeps, now: Date, seconds: number): void {
  attempt(deps, 'Backup', () => {
    if (deps.newestBackupAgeSeconds(now) > seconds) {
      deps.backup(now);
      deps.log('Backup completed');
    }
  });
}

export function runTick(deps: MaintenanceDeps, options: MaintenanceOptions, now: Date): void {
  attempt(deps, 'Expired-item purge', () => { deps.purgeExpired(); });
  if (options.backupKeep > 0 && now.getHours() === options.backupHour) {
    backupIfOlderThan(deps, now, DUE_AFTER_SECONDS);
  }
}

export function runCatchUp(deps: MaintenanceDeps, options: MaintenanceOptions, now: Date): void {
  if (options.backupKeep > 0) backupIfOlderThan(deps, now, DAY_SECONDS);
}

export function startMaintenance(
  deps: MaintenanceDeps,
  options: MaintenanceOptions,
  now: () => Date = () => new Date(),
  timers: { setInterval: typeof setInterval; clearInterval: typeof clearInterval } = { setInterval, clearInterval },
): { stop(): void } {
  runCatchUp(deps, options, now());
  const handle = timers.setInterval(() => runTick(deps, options, now()), HOUR_MS);
  handle.unref();
  return { stop: () => timers.clearInterval(handle) };
}
