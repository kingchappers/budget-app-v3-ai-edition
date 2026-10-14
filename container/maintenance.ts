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
// A backup is due once the newest is older than this and the backup hour has come, so two ticks in one day cannot both run it.
const DUE_AFTER_SECONDS = 20 * 60 * 60;

// The error name, plus a Node error code such as EACCES when there is a plain one: a message can echo paths or SQL.
const SAFE_CODE = /^[A-Z0-9_]{2,40}$/;
function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && SAFE_CODE.test(code) ? `${name} (${code})` : name;
}

function attempt(deps: MaintenanceDeps, label: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    deps.log(`${label} failed: ${describeError(error)}`);
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
  // From the backup hour on, not only in it: a skipped tick (suspended process, a DST hour that does not exist,
  // a catch-up taken after the hour) is made good by the next one.
  if (options.backupKeep > 0 && now.getHours() >= options.backupHour) {
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
