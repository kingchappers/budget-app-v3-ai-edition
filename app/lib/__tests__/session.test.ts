import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type SessionModule = typeof import('../session');
let session: SessionModule;

beforeEach(async () => {
  vi.resetModules();
  session = await import('../session');
});

function authError(code: string): Error {
  return Object.assign(new Error(`${code}: detail`), { error: code });
}

describe('isSessionEndedError', () => {
  it.each(['login_required', 'missing_refresh_token', 'invalid_grant'])('recognises %s', code => {
    expect(session.isSessionEndedError(authError(code))).toBe(true);
  });

  it('ignores other errors', () => {
    expect(session.isSessionEndedError(undefined)).toBe(false);
    expect(session.isSessionEndedError(new Error('network'))).toBe(false);
    expect(session.isSessionEndedError(authError('invalid_state'))).toBe(false);
    expect(session.isSessionEndedError('login_required')).toBe(false);
  });
});

describe('useSessionEnded', () => {
  it('starts false and turns true once a request finds the session has ended', () => {
    const { result } = renderHook(() => session.useSessionEnded());
    expect(result.current).toBe(false);

    act(() => session.markSessionEnded());

    expect(result.current).toBe(true);
  });
});
