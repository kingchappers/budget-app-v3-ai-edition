import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('jsonwebtoken', () => ({ verify: vi.fn() }));
vi.mock('jwks-rsa', () => ({ default: () => ({ getSigningKey: vi.fn() }) }));

import { getAuth, initAuth, setAuth } from '..';
import type { AuthProvider } from '..';

afterEach(() => {
  setAuth(undefined);
});

describe('auth registry', () => {
  it('refuses getAuth before initAuth', () => {
    expect(() => getAuth()).toThrow(/not initialised/);
  });

  it('defaults to the Auth0 provider', async () => {
    const provider = await initAuth({ AUTH0_DOMAIN: 'tenant.example.com', AUTH0_AUDIENCE: 'aud' });
    expect(typeof provider.authenticate).toBe('function');
    expect(provider.handlePublic).toBeUndefined();
    expect(getAuth()).toBe(provider);
  });

  it('rejects an unknown AUTH_MODE and recovers on the next call', async () => {
    await expect(initAuth({ AUTH_MODE: 'ldap' })).rejects.toThrow(/Unknown AUTH_MODE "ldap"/);
    await expect(initAuth({ AUTH0_DOMAIN: 'tenant.example.com' })).resolves.toBeDefined();
  });

  it('lets a test override the provider', async () => {
    const fake: AuthProvider = { authenticate: async () => ({ userId: 'u1' }) };
    setAuth(fake);
    expect(getAuth()).toBe(fake);
    expect(await initAuth({})).toBe(fake);
  });
});
