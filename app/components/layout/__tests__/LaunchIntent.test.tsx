import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth }));

import { LaunchIntent } from '../LaunchIntent';
import { PENDING_ADD_KEY, writeOpenOnLaunch } from '~/lib/launchIntent';

const originalMatchMedia = window.matchMedia;

function setStandalone(enabled: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: enabled && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function ui(onOpenAdd: () => void) {
  return (
    <StrictMode>
      <LaunchIntent onOpenAdd={onOpenAdd} />
    </StrictMode>
  );
}

beforeEach(() => {
  auth.isAuthenticated = true;
  auth.isLoading = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('LaunchIntent with ?add=1', () => {
  it('opens the sheet once and cleans the URL', () => {
    window.history.replaceState(null, '', '/?add=1');
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
  });

  it('does not open again on a re-render', () => {
    window.history.replaceState(null, '', '/?add=1');
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));

    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('waits for Auth0 to finish loading, then opens', () => {
    window.history.replaceState(null, '', '/?add=1');
    auth.isLoading = true;
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));
    expect(onOpenAdd).not.toHaveBeenCalled();

    auth.isLoading = false;
    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('keeps the intent while signed out and opens after sign-in', () => {
    window.history.replaceState(null, '', '/?add=1');
    auth.isAuthenticated = false;
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBe('1');

    auth.isAuthenticated = true;
    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the param', () => {
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
  });
});

describe('LaunchIntent with the launch toggle', () => {
  it('opens on a standalone launch when the toggle is on', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('does not open again on a reload in the same session', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    const first = vi.fn();
    const { unmount } = render(ui(first));
    expect(first).toHaveBeenCalledTimes(1);
    unmount();

    const second = vi.fn();
    render(ui(second));

    expect(second).not.toHaveBeenCalled();
  });

  it('does nothing in a normal browser tab', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(false);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
  });

  it('does nothing when the toggle is off', () => {
    setStandalone(true);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
  });

  it('waits until signed in on a signed-out standalone launch', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    auth.isAuthenticated = false;
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));
    expect(onOpenAdd).not.toHaveBeenCalled();

    auth.isAuthenticated = true;
    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('opens once when the param and the toggle both apply', () => {
    window.history.replaceState(null, '', '/?add=1');
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });
});
