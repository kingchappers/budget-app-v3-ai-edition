import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { ReduceMotion } from '../ReduceMotion';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, writePreferences } from '~/lib/preferences';

beforeEach(() => window.localStorage.clear());
afterEach(() => document.documentElement.removeAttribute('data-reduce-motion'));

describe('ReduceMotion', () => {
  it('leaves the page alone by default', () => {
    render(<ReduceMotion />);
    expect(document.documentElement).not.toHaveAttribute('data-reduce-motion');
  });

  it('marks the page when the setting is on', () => {
    writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, reduceMotion: true });
    render(<ReduceMotion />);
    expect(document.documentElement).toHaveAttribute('data-reduce-motion');
  });

  it('follows the setting as it changes and clears the mark when unmounted', () => {
    const { unmount } = render(<ReduceMotion />);
    act(() => {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_PREFERENCES, reduceMotion: true }));
      window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCES_KEY }));
    });
    expect(document.documentElement).toHaveAttribute('data-reduce-motion');

    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-reduce-motion');
  });
});
