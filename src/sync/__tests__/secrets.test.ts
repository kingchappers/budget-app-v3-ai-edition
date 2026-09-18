import { describe, it, expect } from 'vitest';
import { parseTlCredentials } from '../secrets';

describe('parseTlCredentials', () => {
  it('returns credentials from valid JSON', () => {
    const secret = JSON.stringify({ clientId: 'client-1', clientSecret: 'shh', environment: 'sandbox' });
    expect(parseTlCredentials(secret)).toEqual({ clientId: 'client-1', clientSecret: 'shh', environment: 'sandbox' });
  });

  it('accepts the live environment', () => {
    const secret = JSON.stringify({ clientId: 'client-1', clientSecret: 'shh', environment: 'live' });
    expect(parseTlCredentials(secret)).toEqual({ clientId: 'client-1', clientSecret: 'shh', environment: 'live' });
  });

  it('explains how to set an empty secret', () => {
    expect(() => parseTlCredentials(undefined)).toThrow(/put-secret-value/);
  });

  it.each([
    ['invalid JSON', '{nope'],
    ['missing key', JSON.stringify({ clientId: 'client-1', environment: 'sandbox' })],
    ['empty clientId', JSON.stringify({ clientId: '', clientSecret: 'shh', environment: 'sandbox' })],
    ['empty clientSecret', JSON.stringify({ clientId: 'client-1', clientSecret: '', environment: 'sandbox' })],
    ['bad environment', JSON.stringify({ clientId: 'client-1', clientSecret: 'shh', environment: 'production' })],
  ])('rejects %s without echoing the secret', (_label, secret) => {
    expect(() => parseTlCredentials(secret)).toThrow(/^TrueLayer secret/);
    try { parseTlCredentials(secret); } catch (error) { expect(String(error)).not.toContain('shh'); }
  });
});
