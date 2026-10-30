import { describe, expect, it } from 'vitest';
import { createFailureLimiter } from '../failureLimiter';

function clock(start = 1000): { now: () => number; advance: (seconds: number) => void } {
  let t = start;
  return { now: () => t, advance: (seconds) => { t += seconds; } };
}

function fail(limiter: ReturnType<typeof createFailureLimiter>, key: string, times: number): void {
  for (let i = 0; i < times; i++) limiter.recordFailure(key);
}

describe('createFailureLimiter', () => {
  it('allows 30 failures and blocks the 31st', () => {
    const limiter = createFailureLimiter({}, clock().now);
    fail(limiter, '1.2.3.4', 30);
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
  });

  it('unblocks after 60 seconds', () => {
    const c = clock();
    const limiter = createFailureLimiter({}, c.now);
    fail(limiter, '1.2.3.4', 31);
    c.advance(59);
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    c.advance(1);
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });

  it('counts addresses separately', () => {
    const limiter = createFailureLimiter({}, clock().now);
    fail(limiter, '1.2.3.4', 31);
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    expect(limiter.isBlocked('5.6.7.8')).toBe(false);
  });

  it('forgets failures older than the window', () => {
    const c = clock();
    const limiter = createFailureLimiter({}, c.now);
    fail(limiter, '1.2.3.4', 30);
    c.advance(61);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });

  it('never holds more than maxKeys entries', () => {
    const limiter = createFailureLimiter({}, clock().now);
    for (let i = 0; i <= 10000; i++) limiter.recordFailure(`key-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(10000);
    fail(limiter, 'key-10000', 30);
    expect(limiter.isBlocked('key-10000')).toBe(true);
  });

  it('keeps a blocked key when a flood of other keys fills the table', () => {
    const limiter = createFailureLimiter({ maxKeys: 5, maxFailures: 2 }, clock().now);
    fail(limiter, 'A', 3);
    for (let i = 0; i < 10; i++) limiter.recordFailure(`other-${i}`);
    expect(limiter.isBlocked('A')).toBe(true);
    expect(limiter.size()).toBeLessThanOrEqual(5);
  });

  it('evicts an expired entry before an unexpired one', () => {
    const c = clock();
    const limiter = createFailureLimiter(
      { maxKeys: 3, maxFailures: 1, windowSeconds: 60, blockSeconds: 1000 },
      c.now,
    );
    fail(limiter, 'A', 2);
    limiter.recordFailure('B');
    c.advance(61);
    limiter.recordFailure('C');
    limiter.recordFailure('D');
    expect(limiter.isBlocked('A')).toBe(true);
    expect(limiter.size()).toBe(3);
  });
});
