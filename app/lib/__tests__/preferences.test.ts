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

  it('remembers pinned chips, the keep-open answer, the entry mode and the dismissed tip', () => {
    const chosen: import('../preferences').Preferences = { ...prefs.DEFAULT_PREFERENCES, pinnedCategoryIds: ['a', 'b'], keepSheetOpen: 'yes', entryMode: 'quick', quickAddTipDismissed: true };
    prefs.writePreferences(window.localStorage, chosen);
    expect(prefs.readPreferences(window.localStorage)).toEqual(chosen);
  });

  it('repairs pinned chips: only text ids, no repeats, at most six', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ pinnedCategoryIds: ['a', 1, 'a', '', 'b', 'c', 'd', 'e', 'f', 'g', null] }));
    expect(prefs.readPreferences(window.localStorage).pinnedCategoryIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ pinnedCategoryIds: 'a' }));
    expect(prefs.readPreferences(window.localStorage).pinnedCategoryIds).toEqual([]);
  });

  it('falls back to the default for an unknown keep-open answer or entry mode', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ keepSheetOpen: 'sometimes', entryMode: 'voice' }));
    const read = prefs.readPreferences(window.localStorage);
    expect(read.keepSheetOpen).toBe('ask');
    expect(read.entryMode).toBe('form');
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

  it('keeps the guided tour step within range and ignores a bad one', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ tourStep: 99 }));
    expect(prefs.readPreferences(window.localStorage).tourStep).toBe(prefs.TOUR_SCREENS);

    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ tourStep: -4 }));
    expect(prefs.readPreferences(window.localStorage).tourStep).toBe(0);

    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ tourStep: 1.5 }));
    expect(prefs.readPreferences(window.localStorage).tourStep).toBe(0);

    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ tourStep: 2 }));
    expect(prefs.readPreferences(window.localStorage).tourStep).toBe(2);
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

  it('keeps "nothing to log" days per user, valid, unique and sorted', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({
      nothingToLog: {
        'auth0|a': ['2026-09-03', '2026-09-01', '2026-09-03', '2026-9-1', 7],
        'auth0|b': 'nope',
        '': ['2026-09-01'],
      },
    }));
    expect(prefs.readPreferences(window.localStorage).nothingToLog).toEqual({ 'auth0|a': ['2026-09-01', '2026-09-03'] });
  });

  it('ignores a malformed nothing-to-log value', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ nothingToLog: ['2026-09-01'] }));
    expect(prefs.readPreferences(window.localStorage).nothingToLog).toEqual({});
  });

  it('only accepts a real date, or nothing, for when the welcome card is hidden until', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ welcomeBackHiddenUntil: '2026-10-05' }));
    expect(prefs.readPreferences(window.localStorage).welcomeBackHiddenUntil).toBe('2026-10-05');
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ welcomeBackHiddenUntil: 'soon' }));
    expect(prefs.readPreferences(window.localStorage).welcomeBackHiddenUntil).toBe('');
  });

  it('keeps dismissed release notes as unique, non-empty keys', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ seenReleases: ['a', 'b', 'a', '', 7, 'x'.repeat(65)] }));
    expect(prefs.readPreferences(window.localStorage).seenReleases).toEqual(['a', 'b']);
  });

  it('starts with no release notes dismissed, and ignores a malformed value', () => {
    expect(prefs.DEFAULT_PREFERENCES.seenReleases).toEqual([]);
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ seenReleases: 'menu' }));
    expect(prefs.readPreferences(window.localStorage).seenReleases).toEqual([]);
  });

  it('defaults to standard text and messages that stay until closed', () => {
    expect(prefs.DEFAULT_PREFERENCES.textSize).toBe('standard');
    expect(prefs.DEFAULT_PREFERENCES.undoDuration).toBe('until-closed');
  });

  it('keeps a valid text size and undo duration, and falls back for anything else', () => {
    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ textSize: 'largest', undoDuration: '10s' }));
    expect(prefs.readPreferences(window.localStorage)).toMatchObject({ textSize: 'largest', undoDuration: '10s' });

    window.localStorage.setItem(prefs.PREFERENCES_KEY, JSON.stringify({ textSize: 'huge', undoDuration: 5000 }));
    expect(prefs.readPreferences(window.localStorage)).toMatchObject({ textSize: 'standard', undoDuration: 'until-closed' });
  });
});
