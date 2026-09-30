import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dismissMatch, isMatchDismissed, isSnoozed, snoozeUntilTomorrow } from '../billPrefs';

describe('bill snooze', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('hides an item for the rest of today and shows it again tomorrow', () => {
    snoozeUntilTomorrow('user-1', 'r1', '2026-09', '2026-09-30');
    expect(isSnoozed('user-1', 'r1', '2026-09', '2026-09-30')).toBe(true);
    expect(isSnoozed('user-1', 'r1', '2026-09', '2026-10-01')).toBe(false);
  });

  it('is kept per user, per bill and per period', () => {
    snoozeUntilTomorrow('user-1', 'r1', '2026-09', '2026-09-30');
    expect(isSnoozed('user-2', 'r1', '2026-09', '2026-09-30')).toBe(false);
    expect(isSnoozed('user-1', 'r2', '2026-09', '2026-09-30')).toBe(false);
    expect(isSnoozed('user-1', 'r1', '2026-10', '2026-09-30')).toBe(false);
  });

  it('drops expired snoozes when a new one is saved', () => {
    snoozeUntilTomorrow('user-1', 'r1', '2026-09', '2026-09-01');
    snoozeUntilTomorrow('user-1', 'r2', '2026-09', '2026-09-30');
    const stored = Object.values(window.localStorage).join('');
    expect(stored).not.toContain('r1');
    expect(stored).toContain('r2');
  });

  it('treats unreadable or broken storage as not snoozed, and logs it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.localStorage.setItem('budget.billSnoozes.user-1', '{not json');
    expect(isSnoozed('user-1', 'r1', '2026-09', '2026-09-30')).toBe(false);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => snoozeUntilTomorrow('user-1', 'r1', '2026-09', '2026-09-30')).not.toThrow();
    expect(isSnoozed('user-1', 'r1', '2026-09', '2026-09-30')).toBe(false);
    expect(logged).toHaveBeenCalled();
  });
});

describe('dismissed likely matches', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('remembers a No per user, bill and transaction', () => {
    dismissMatch('user-1', 'r1', 't1');
    expect(isMatchDismissed('user-1', 'r1', 't1')).toBe(true);
    expect(isMatchDismissed('user-1', 'r1', 't2')).toBe(false);
    expect(isMatchDismissed('user-1', 'r2', 't1')).toBe(false);
    expect(isMatchDismissed('user-2', 'r1', 't1')).toBe(false);
  });

  it('keeps only the most recent answers', () => {
    for (let i = 0; i < 205; i += 1) dismissMatch('user-1', 'r1', `t${i}`);
    expect(isMatchDismissed('user-1', 'r1', 't0')).toBe(false);
    expect(isMatchDismissed('user-1', 'r1', 't204')).toBe(true);
  });
});
