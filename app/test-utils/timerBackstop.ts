// Timers and animation frames a test file leaves pending can fire after the test environment has been torn down.
// Their callbacks then touch `window` or call a React state setter and throw "window is not defined" as an unhandled
// error, which fails the whole run although every test passed. The backstop records what a host schedules and lets
// the setup file cancel whatever is still pending once the file's tests are done.

type Scheduler = (callback: (...args: unknown[]) => unknown, ...rest: unknown[]) => unknown;
type Canceller = (id: unknown) => void;
type TimerHost = Record<string, unknown>;

interface Pair {
  set: string;
  clear: string;
  // A timeout or frame runs once and then needs no clearing; an interval stays pending until it is cleared.
  oneShot: boolean;
}

const PAIRS: readonly Pair[] = [
  { set: 'setTimeout', clear: 'clearTimeout', oneShot: true },
  { set: 'setInterval', clear: 'clearInterval', oneShot: false },
  { set: 'requestAnimationFrame', clear: 'cancelAnimationFrame', oneShot: true },
];

export interface TimerBackstop {
  // Cancels every timer, interval and frame scheduled through the host that has not run or been cleared. Returns how many.
  clearPending(): number;
  // Puts the host's original functions back.
  restore(): void;
}

export function installTimerBackstop(host: object): TimerBackstop {
  const target = host as TimerHost;
  const pending = new Map<unknown, Canceller>();
  const originals = new Map<string, unknown>();

  for (const { set, clear, oneShot } of PAIRS) {
    const realSet = target[set] as Scheduler | undefined;
    const realClear = target[clear] as Canceller | undefined;
    if (typeof realSet !== 'function' || typeof realClear !== 'function') continue;
    originals.set(set, realSet);
    originals.set(clear, realClear);

    target[set] = (callback: (...args: unknown[]) => unknown, ...rest: unknown[]): unknown => {
      const wrapped = oneShot
        ? (...args: unknown[]): unknown => {
            pending.delete(id);
            return callback(...args);
          }
        : callback;
      const id = realSet.call(host, wrapped, ...rest);
      pending.set(id, realClear);
      return id;
    };
    target[clear] = (id: unknown): void => {
      pending.delete(id);
      realClear.call(host, id);
    };
  }

  return {
    clearPending(): number {
      const count = pending.size;
      for (const [id, realClear] of [...pending]) realClear.call(host, id);
      pending.clear();
      return count;
    },
    restore(): void {
      for (const [name, original] of originals) target[name] = original;
    },
  };
}
