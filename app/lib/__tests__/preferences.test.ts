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

  it('keeps milestones off unless asked for', () => {
    expect(prefs.DEFAULT_PREFERENCES.showMilestones).toBe(false);
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ showMilestones: 'yes' }));
    expect(prefs.readPreferences(window.localStorage).showMilestones).toBe(false);
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ showMilestones: true }));
    expect(prefs.readPreferences(window.localStorage).showMilestones).toBe(true);
  });

  it('keeps only valid, unique, sorted not-tracked months', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({
      notTrackedMonths: ['2026-03', '2026-01', '2026-03', '2026-13', 'March', 7, '2026-1'],
    }));
    expect(prefs.readPreferences(window.localStorage).notTrackedMonths).toEqual(['2026-01', '2026-03']);

    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ notTrackedMonths: 'nope' }));
    expect(prefs.readPreferences(window.localStorage).notTrackedMonths).toEqual([]);
  });

  it('caps how many not-tracked months are kept, dropping the oldest', () => {
    const months = Array.from({ length: 130 }, (_, index) => `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ notTrackedMonths: months }));
    const kept = prefs.readPreferences(window.localStorage).notTrackedMonths;
    expect(kept).toHaveLength(120);
    expect(kept[kept.length - 1]).toBe(months[months.length - 1]);
  });

  it('starts with every Insights section closed and ignores unknown ones', () => {
    expect(prefs.DEFAULT_PREFERENCES.insightsOpenSections).toEqual([]);
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ insightsOpenSections: ['trend', 'bogus', 'groups', 'trend'] }));
    expect(prefs.readPreferences(window.localStorage).insightsOpenSections).toEqual(['groups', 'trend']);
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
});
