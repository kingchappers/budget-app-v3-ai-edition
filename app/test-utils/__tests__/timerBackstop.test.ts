import { describe, expect, it, vi } from 'vitest';
import { installTimerBackstop } from '../timerBackstop';

type Callback = (...args: unknown[]) => void;

// A timer host that never schedules anything: the test fires callbacks itself, so nothing depends on real time.
function fakeHost() {
  let nextId = 1;
  const live = new Map<number, Callback>();
  const clearCalls: number[] = [];
  const clear = (id: number): void => {
    clearCalls.push(id);
    live.delete(id);
  };
  const schedule = (callback: Callback, _delay?: number): number => {
    const id = nextId;
    nextId += 1;
    live.set(id, callback);
    return id;
  };
  return {
    setTimeout: schedule,
    clearTimeout: clear,
    setInterval: schedule,
    clearInterval: clear,
    requestAnimationFrame: schedule,
    cancelAnimationFrame: clear,
    live,
    clearCalls,
    fire(id: number, ...args: unknown[]): void {
      const callback = live.get(id);
      if (callback) callback(...args);
    },
  };
}

describe('installTimerBackstop', () => {
  it('clears timers that are still pending, so their callbacks can never run', () => {
    const host = fakeHost();
    const backstop = installTimerBackstop(host);
    const callback = vi.fn();

    host.setTimeout(callback, 150);
    expect(host.live.size).toBe(1);
    backstop.clearPending();

    expect(host.live.size).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it('forgets a timer once it has fired and does not clear it again', () => {
    const host = fakeHost();
    const backstop = installTimerBackstop(host);
    const callback = vi.fn();

    const id = host.setTimeout(callback, 10);
    host.fire(id);
    host.clearCalls.length = 0;

    expect(backstop.clearPending()).toBe(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(host.clearCalls).toEqual([]);
  });

  it('does not clear a timer the code under test already cleared', () => {
    const host = fakeHost();
    const backstop = installTimerBackstop(host);

    const id = host.setTimeout(vi.fn(), 10);
    host.clearTimeout(id);
    host.clearCalls.length = 0;

    expect(backstop.clearPending()).toBe(0);
    expect(host.clearCalls).toEqual([]);
  });

  it('keeps an interval tracked until it is cleared, even after it has fired', () => {
    const host = fakeHost();
    const backstop = installTimerBackstop(host);
    const callback = vi.fn();

    const id = host.setInterval(callback, 100);
    host.fire(id);
    host.fire(id);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(backstop.clearPending()).toBe(1);
    expect(host.live.size).toBe(0);
  });

  it('cancels animation frames that have not run, because a frame can start a timer after the tests end', () => {
    const host = fakeHost();
    const backstop = installTimerBackstop(host);
    const callback = vi.fn();

    host.requestAnimationFrame(callback);

    expect(backstop.clearPending()).toBe(1);
    expect(host.live.size).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it('passes the callback arguments through, such as the animation frame time', () => {
    const host = fakeHost();
    installTimerBackstop(host);
    const callback = vi.fn();

    const id = host.requestAnimationFrame(callback);
    host.fire(id, 16.5);

    expect(callback).toHaveBeenCalledWith(16.5);
  });

  it('counts every kind of pending timer in the number it returns', () => {
    const host = fakeHost();
    const backstop = installTimerBackstop(host);

    host.setTimeout(vi.fn(), 1);
    host.setInterval(vi.fn(), 1);
    host.requestAnimationFrame(vi.fn());

    expect(backstop.clearPending()).toBe(3);
  });

  it('works on a host without requestAnimationFrame', () => {
    const { requestAnimationFrame: _frame, cancelAnimationFrame: _cancel, ...host } = fakeHost();
    const backstop = installTimerBackstop(host);

    host.setTimeout(vi.fn(), 1);

    expect(backstop.clearPending()).toBe(1);
  });

  it('puts the original functions back on restore', () => {
    const host = fakeHost();
    const originals = { setTimeout: host.setTimeout, clearTimeout: host.clearTimeout, requestAnimationFrame: host.requestAnimationFrame };
    const backstop = installTimerBackstop(host);

    expect(host.setTimeout).not.toBe(originals.setTimeout);
    backstop.restore();

    expect(host.setTimeout).toBe(originals.setTimeout);
    expect(host.clearTimeout).toBe(originals.clearTimeout);
    expect(host.requestAnimationFrame).toBe(originals.requestAnimationFrame);
  });
});
