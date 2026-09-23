import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LAUNCH_HANDLED_KEY,
  OPEN_ON_LAUNCH_KEY,
  PENDING_ADD_KEY,
  captureAddParam,
  consumeLaunchIntent,
  isStandalone,
  readOpenOnLaunch,
  safeStorage,
  writeOpenOnLaunch,
  type StandaloneEnv,
} from '../launchIntent';

function brokenStorage(): Storage {
  const fail = (): never => {
    throw new Error('blocked');
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 } as unknown as Storage;
}

function env(displayModeStandalone: boolean, iosStandalone?: boolean): StandaloneEnv {
  return {
    matchMedia: (query: string) => ({ matches: displayModeStandalone && query === '(display-mode: standalone)' }),
    navigator: { standalone: iosStandalone } as unknown as Navigator,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('captureAddParam', () => {
  it('stores the intent and returns the URL without the param', () => {
    const cleaned = captureAddParam({ pathname: '/', search: '?add=1', hash: '' }, window.sessionStorage);

    expect(cleaned).toBe('/');
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBe('1');
  });

  it('keeps the path, other params and the hash', () => {
    const cleaned = captureAddParam(
      { pathname: '/transactions', search: '?add=1&month=2026-09', hash: '#top' },
      window.sessionStorage,
    );

    expect(cleaned).toBe('/transactions?month=2026-09#top');
  });

  it('ignores other values of the param and its absence', () => {
    expect(captureAddParam({ pathname: '/', search: '?add=2', hash: '' }, window.sessionStorage)).toBeNull();
    expect(captureAddParam({ pathname: '/', search: '', hash: '' }, window.sessionStorage)).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
  });

  it('does nothing when storage is unavailable', () => {
    expect(captureAddParam({ pathname: '/', search: '?add=1', hash: '' }, null)).toBeNull();
  });

  it('leaves the URL alone when the intent cannot be stored', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(captureAddParam({ pathname: '/', search: '?add=1', hash: '' }, brokenStorage())).toBeNull();
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('isStandalone', () => {
  it('is true for the display-mode media query', () => {
    expect(isStandalone(env(true))).toBe(true);
  });

  it('is true for iOS navigator.standalone', () => {
    expect(isStandalone(env(false, true))).toBe(true);
  });

  it('is false in a normal browser tab', () => {
    expect(isStandalone(env(false, false))).toBe(false);
    expect(isStandalone(env(false))).toBe(false);
  });
});

describe('open-on-launch setting', () => {
  it('defaults to off', () => {
    expect(readOpenOnLaunch(window.localStorage)).toBe(false);
  });

  it('persists on and off', () => {
    writeOpenOnLaunch(window.localStorage, true);
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBe('1');
    expect(readOpenOnLaunch(window.localStorage)).toBe(true);

    writeOpenOnLaunch(window.localStorage, false);
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBeNull();
    expect(readOpenOnLaunch(window.localStorage)).toBe(false);
  });

  it('degrades to off when storage is missing or blocked', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(readOpenOnLaunch(null)).toBe(false);
      expect(() => writeOpenOnLaunch(null, true)).not.toThrow();
      expect(readOpenOnLaunch(brokenStorage())).toBe(false);
      expect(() => writeOpenOnLaunch(brokenStorage(), true)).not.toThrow();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('consumeLaunchIntent', () => {
  it('opens for a pending ?add=1 intent exactly once', () => {
    window.sessionStorage.setItem(PENDING_ADD_KEY, '1');
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: false };

    expect(consumeLaunchIntent(context)).toBe(true);
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('opens on the first authenticated evaluation when the toggle is on and the app is standalone', () => {
    writeOpenOnLaunch(window.localStorage, true);
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: true };

    expect(consumeLaunchIntent(context)).toBe(true);
    expect(window.sessionStorage.getItem(LAUNCH_HANDLED_KEY)).toBe('1');
    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('does nothing for the toggle in a normal browser tab', () => {
    writeOpenOnLaunch(window.localStorage, true);

    expect(consumeLaunchIntent({ session: window.sessionStorage, local: window.localStorage, standalone: false })).toBe(false);
  });

  it('does nothing when the toggle is off', () => {
    expect(consumeLaunchIntent({ session: window.sessionStorage, local: window.localStorage, standalone: true })).toBe(false);
  });

  it('does not pop up when the toggle is switched on later in the same session', () => {
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: true };
    expect(consumeLaunchIntent(context)).toBe(false);

    writeOpenOnLaunch(window.localStorage, true);

    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('opens once when both triggers apply', () => {
    window.sessionStorage.setItem(PENDING_ADD_KEY, '1');
    writeOpenOnLaunch(window.localStorage, true);
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: true };

    expect(consumeLaunchIntent(context)).toBe(true);
    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('never opens without session storage when the toggle is off', () => {
    expect(consumeLaunchIntent({ session: null, local: window.localStorage, standalone: true })).toBe(false);
  });
});

describe('safeStorage', () => {
  it('returns the real storages', () => {
    expect(safeStorage('session')).toBe(window.sessionStorage);
    expect(safeStorage('local')).toBe(window.localStorage);
  });
});
