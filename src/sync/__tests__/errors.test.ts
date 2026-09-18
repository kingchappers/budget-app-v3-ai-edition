import { describe, it, expect } from 'vitest';
import { ProviderError, classifyHttpStatus, classifyProviderError } from '../errors';

describe('classifyHttpStatus', () => {
  it.each([
    [401, 'EXPIRED'],
    [403, 'EXPIRED'],
    [429, 'RATE_LIMITED'],
    [500, 'TRANSIENT'],
    [503, 'TRANSIENT'],
    [400, 'INVALID_RESPONSE'],
    [404, 'INVALID_RESPONSE'],
  ])('maps %i to %s', (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });
});

describe('classifyProviderError', () => {
  it('returns the type of a ProviderError', () => {
    expect(classifyProviderError(new ProviderError('RATE_LIMITED', 'slow down'))).toBe('RATE_LIMITED');
  });

  it('treats any other error as transient', () => {
    expect(classifyProviderError(new TypeError('fetch failed'))).toBe('TRANSIENT');
  });
});
