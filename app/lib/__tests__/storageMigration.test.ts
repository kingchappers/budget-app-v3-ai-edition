import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyBrowserStorage, migrateLegacyStorage } from '../storageMigration';

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const savedKeys = (): string[] => Object.keys(window.localStorage).sort();

describe('migrateLegacyStorage', () => {
  it('copies an old key to its new name and removes the old one', () => {
    window.localStorage.setItem('budget.preferences', '{"textSize":"large"}');

    migrateLegacyStorage(window.localStorage);

    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"textSize":"large"}');
    expect(window.localStorage.getItem('budget.preferences')).toBeNull();
  });

  it('keeps the value already saved under the new name and still removes the old key', () => {
    window.localStorage.setItem('budget.preferences', '{"textSize":"standard"}');
    window.localStorage.setItem('hoardwise.preferences', '{"textSize":"largest"}');

    migrateLegacyStorage(window.localStorage);

    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"textSize":"largest"}');
    expect(window.localStorage.getItem('budget.preferences')).toBeNull();
  });

  it('moves the per-user key families and the older open-on-launch key', () => {
    window.localStorage.setItem('budget.billSnoozes.user-1', '{"a":"2026-10-01"}');
    window.localStorage.setItem('budget.billDismissedMatches.user-1', '["x"]');
    window.localStorage.setItem('budget.openAddOnLaunch', '1');
    window.localStorage.setItem('budget.targetsCardDismissed', 'true');

    migrateLegacyStorage(window.localStorage);

    expect(savedKeys()).toEqual([
      'hoardwise.billDismissedMatches.user-1',
      'hoardwise.billSnoozes.user-1',
      'hoardwise.openAddOnLaunch',
      'hoardwise.targetsCardDismissed',
    ]);
    expect(window.localStorage.getItem('hoardwise.billSnoozes.user-1')).toBe('{"a":"2026-10-01"}');
  });

  it('leaves keys that do not start with the old prefix alone', () => {
    window.localStorage.setItem('mantine-color-scheme-value', 'dark');
    window.localStorage.setItem('budgetary', 'x');
    window.localStorage.setItem('hoardwise.preferences', '{}');

    migrateLegacyStorage(window.localStorage);

    expect(savedKeys()).toEqual(['budgetary', 'hoardwise.preferences', 'mantine-color-scheme-value']);
  });

  it('does nothing when nothing is saved, and when there is no storage', () => {
    migrateLegacyStorage(window.localStorage);
    expect(savedKeys()).toEqual([]);
    expect(() => migrateLegacyStorage(null)).not.toThrow();
  });

  it('keeps the old key when the new one cannot be written, and still moves the others', () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'hoardwise.a') throw new Error('quota exceeded');
      original.call(this, key, value);
    });
    window.localStorage.setItem('budget.a', '1');
    window.localStorage.setItem('budget.b', '2');

    migrateLegacyStorage(window.localStorage);

    expect(window.localStorage.getItem('budget.a')).toBe('1');
    expect(window.localStorage.getItem('hoardwise.a')).toBeNull();
    expect(window.localStorage.getItem('hoardwise.b')).toBe('2');
    expect(window.localStorage.getItem('budget.b')).toBeNull();
  });

  it('does not throw when the saved keys cannot be listed', () => {
    window.localStorage.setItem('budget.a', '1');
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(() => migrateLegacyStorage(window.localStorage)).not.toThrow();
    expect(window.localStorage.getItem('budget.a')).toBe('1');
  });

  it('is safe to run twice', () => {
    window.localStorage.setItem('budget.preferences', '{"payDay":25}');

    migrateLegacyStorage(window.localStorage);
    migrateLegacyStorage(window.localStorage);

    expect(savedKeys()).toEqual(['hoardwise.preferences']);
    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"payDay":25}');
  });
});

describe('migrateLegacyBrowserStorage', () => {
  it('moves settings saved in the real browser storage', () => {
    window.localStorage.setItem('budget.preferences', '{"payDay":15}');

    migrateLegacyBrowserStorage();

    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"payDay":15}');
  });

  it('does not throw when the browser refuses access to localStorage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => migrateLegacyBrowserStorage()).not.toThrow();
  });
});
