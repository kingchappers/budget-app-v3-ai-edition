import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type PreferencesModule = typeof import('../preferences');

let prefs: PreferencesModule;

function brokenStorage(): Storage {
  return {
    length: 0,
    clear: () => { throw new Error('denied'); },
    getItem: () => { throw new Error('denied'); },
    key: () => null,
    removeItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
  };
}

beforeEach(async () => {
  window.localStorage.clear();
  vi.resetModules();
  prefs = await import('../preferences');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPreferences', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(prefs.readPreferences(window.localStorage)).toEqual(prefs.DEFAULT_PREFERENCES);
  });

  it('returns the defaults when storage is unavailable', () => {
    expect(prefs.readPreferences(null)).toEqual(prefs.DEFAULT_PREFERENCES);
  });

  it('reads back what was written', () => {
    prefs.writePreferences(window.localStorage, { ...prefs.DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: true });
    expect(prefs.readPreferences(window.localStorage)).toEqual({ ...prefs.DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: true });
  });

  it('carries over the old launch setting and drops the old value on the next save', () => {
    window.localStorage.setItem('budget.openAddOnLaunch', '1');
    expect(prefs.readPreferences(window.localStorage).openAddOnLaunch).toBe(true);

    prefs.writePreferences(window.localStorage, { ...prefs.DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: true });

    expect(window.localStorage.getItem('budget.openAddOnLaunch')).toBeNull();
    expect(prefs.readPreferences(window.localStorage)).toEqual({ ...prefs.DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: true });
  });

  it('ignores unreadable JSON and values of the wrong type', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, '{not json');
    expect(prefs.readPreferences(window.localStorage)).toEqual(prefs.DEFAULT_PREFERENCES);

    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ shortcutN: 'no', openAddOnLaunch: true, extra: 1 }));
    expect(prefs.readPreferences(window.localStorage)).toEqual({ ...prefs.DEFAULT_PREFERENCES, shortcutN: true, openAddOnLaunch: true });
  });

  it('survives storage that throws', () => {
    expect(prefs.readPreferences(brokenStorage())).toEqual(prefs.DEFAULT_PREFERENCES);
    expect(prefs.writePreferences(brokenStorage(), { ...prefs.DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: false })).toBe(false);
  });
});

describe('usePreferences', () => {
  it('starts from the saved preferences', () => {
    prefs.writePreferences(window.localStorage, { ...prefs.DEFAULT_PREFERENCES, shortcutN: false, openAddOnLaunch: false });
    const { result } = renderHook(() => prefs.usePreferences());
    expect(result.current[0].shortcutN).toBe(false);
  });

  it('updates every reader and persists the change', () => {
    const first = renderHook(() => prefs.usePreferences());
    const second = renderHook(() => prefs.usePreferences());

    act(() => first.result.current[1]({ shortcutN: false }));

    expect(first.result.current[0].shortcutN).toBe(false);
    expect(second.result.current[0].shortcutN).toBe(false);
    expect(prefs.readPreferences(window.localStorage).shortcutN).toBe(false);
  });

  it('keeps a change for this visit when storage cannot save it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => prefs.usePreferences());

    act(() => result.current[1]({ shortcutN: false }));

    expect(result.current[0].shortcutN).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('follows changes made in another tab', () => {
    const { result } = renderHook(() => prefs.usePreferences());

    act(() => {
      window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ shortcutN: false }));
      window.dispatchEvent(new StorageEvent('storage', { key: prefs.PREFERENCES_KEY }));
    });

    expect(result.current[0].shortcutN).toBe(false);
  });

  it('has bill reminders off by default, at 08:00 with quiet hours from 22:00 to 07:00', () => {
    expect(prefs.DEFAULT_PREFERENCES).toMatchObject({ billReminders: false, reminderHour: 8, quietHours: true, quietStart: 22, quietEnd: 7 });
  });

  it('keeps valid reminder settings', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({
      billReminders: true, reminderHour: 18, quietHours: false, quietStart: 23, quietEnd: 6,
    }));
    expect(prefs.readPreferences(window.localStorage)).toMatchObject({
      billReminders: true, reminderHour: 18, quietHours: false, quietStart: 23, quietEnd: 6,
    });
  });

  it.each([24, -1, 8.5, '8', null, Number.NaN])('ignores a reminder hour of %s and keeps the default', value => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ reminderHour: value, quietStart: value, quietEnd: value }));
    expect(prefs.readPreferences(window.localStorage)).toMatchObject({ reminderHour: 8, quietStart: 22, quietEnd: 7 });
  });

  it('accepts the first and last hour of the day', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ reminderHour: 0, quietStart: 23 }));
    expect(prefs.readPreferences(window.localStorage)).toMatchObject({ reminderHour: 0, quietStart: 23 });
  });

  it('ignores a reminders switch that is not a boolean', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ billReminders: 'yes' }));
    expect(prefs.readPreferences(window.localStorage).billReminders).toBe(false);
  });
});
