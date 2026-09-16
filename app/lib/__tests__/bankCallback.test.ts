import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearStashedBankCallback, readBankCallback, readStashedBankCallback, safeReturnTo, stashBankCallback,
} from '../bankCallback';

describe('readBankCallback', () => {
  it('treats an ordinary redirect as unknown, pending a status check', () => {
    expect(readBankCallback('?state=s1')).toEqual({ kind: 'unknown' });
  });

  it('treats an empty query string as unknown', () => {
    expect(readBankCallback('')).toEqual({ kind: 'unknown' });
  });

  it('reads a bank error with a capped description', () => {
    const result = readBankCallback(`?error=access_denied&error_description=${'x'.repeat(300)}`);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message.length).toBe(200);
  });

  it('uses a default message when the bank gives none', () => {
    expect(readBankCallback('?error=access_denied')).toEqual({
      kind: 'error', message: 'The bank connection was cancelled or failed.',
    });
  });
});

describe('stash', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('reads repeatedly until cleared', () => {
    stashBankCallback(window.sessionStorage, { state: 's1' });
    expect(readStashedBankCallback(window.sessionStorage)).toEqual({ state: 's1' });
    expect(readStashedBankCallback(window.sessionStorage)).not.toBeNull();
    clearStashedBankCallback(window.sessionStorage);
    expect(readStashedBankCallback(window.sessionStorage)).toBeNull();
  });

  it('ignores corrupted values', () => {
    window.sessionStorage.setItem('budget.bankCallback', '{nope');
    expect(readStashedBankCallback(window.sessionStorage)).toBeNull();
  });

  it('ignores a stashed value with the wrong shape', () => {
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ code: 'abc' }));
    expect(readStashedBankCallback(window.sessionStorage)).toBeNull();
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/banks/callback', '/banks/callback'],
    ['//evil.example', null],
    ['https://evil.example', null],
    ['/\\evil.example', null],
    [42, null],
  ])('%s → %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
