export interface FailureLimiterOptions {
  maxFailures?: number;
  windowSeconds?: number;
  blockSeconds?: number;
  maxKeys?: number;
}

export interface FailureLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
  size(): number;
}

interface Entry {
  windowStart: number;
  failures: number;
  blockedUntil: number;
}

export function createFailureLimiter(
  options: FailureLimiterOptions = {},
  now: () => number = () => Math.floor(Date.now() / 1000),
): FailureLimiter {
  const maxFailures = options.maxFailures ?? 30;
  const windowSeconds = options.windowSeconds ?? 60;
  const blockSeconds = options.blockSeconds ?? 60;
  const maxKeys = options.maxKeys ?? 10000;
  const entries = new Map<string, Entry>();

  function isBlocked(key: string): boolean {
    const entry = entries.get(key);
    if (!entry) return false;
    return entry.blockedUntil > now();
  }

  function recordFailure(key: string): void {
    const time = now();
    const existing = entries.get(key);

    if (existing && time - existing.windowStart < windowSeconds) {
      existing.failures += 1;
      if (existing.failures > maxFailures) existing.blockedUntil = time + blockSeconds;
      return;
    }

    if (existing) {
      entries.delete(key);
    } else if (entries.size >= maxKeys) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key, { windowStart: time, failures: 1, blockedUntil: existing?.blockedUntil ?? 0 });
  }

  return { isBlocked, recordFailure, size: () => entries.size };
}
