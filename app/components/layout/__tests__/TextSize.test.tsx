import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { PREFERENCES_KEY, writePreferences, DEFAULT_PREFERENCES, usePreferences } from '~/lib/preferences';
import { TextSize } from '../TextSize';

function attribute(): string | null {
  return document.documentElement.getAttribute('data-text-size');
}

function Setter({ size }: { size: 'standard' | 'large' | 'largest' }) {
  const [, setPreferences] = usePreferences();
  return <button onClick={() => setPreferences({ textSize: size })}>set {size}</button>;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-text-size');
});

afterEach(cleanup);

describe('TextSize', () => {
  it('leaves the page at standard size by default', () => {
    render(<TextSize />);
    expect(attribute()).toBeNull();
  });

  it('applies the saved size', () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ textSize: 'large' }));
    render(<TextSize />);
    expect(attribute()).toBe('large');
  });

  it('follows a change straight away, and goes back to standard', () => {
    const { getByText } = render(<><TextSize /><Setter size="largest" /></>);
    act(() => getByText('set largest').click());
    expect(attribute()).toBe('largest');

    writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, textSize: 'standard' });
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCES_KEY })));
    expect(attribute()).toBeNull();
  });
});
