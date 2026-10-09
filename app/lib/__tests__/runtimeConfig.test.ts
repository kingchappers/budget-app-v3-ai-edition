import { describe, expect, it, vi } from 'vitest';
import { configFromViteEnv, loadRuntimeConfig, parseRuntimeConfig } from '../runtimeConfig';

const AUTH0 = { auth: 'auth0', domain: 't.example.com', clientId: 'cid', audience: 'https://api' };

describe('parseRuntimeConfig', () => {
  it('accepts local mode', () => {
    expect(parseRuntimeConfig({ auth: 'local' })).toEqual({ auth: 'local' });
  });

  it('accepts a complete Auth0 config', () => {
    expect(parseRuntimeConfig(AUTH0)).toEqual(AUTH0);
  });

  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an unknown mode', { auth: 'ldap' }],
    ['no mode', {}],
    ['Auth0 without a domain', { ...AUTH0, domain: '' }],
    ['Auth0 without a client id', { ...AUTH0, clientId: undefined }],
    ['Auth0 with a non-string audience', { ...AUTH0, audience: 5 }],
  ])('rejects %s with a clear error', (_label, value) => {
    expect(() => parseRuntimeConfig(value)).toThrow(/config\.json/);
  });
});

describe('loadRuntimeConfig', () => {
  it('fetches /config.json without using a stale copy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ auth: 'local' }) });
    expect(await loadRuntimeConfig(fetchImpl as unknown as typeof fetch)).toEqual({ auth: 'local' });
    expect(fetchImpl).toHaveBeenCalledWith('/config.json', { cache: 'no-cache' });
  });

  it('fails on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(loadRuntimeConfig(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/404/);
  });

  it('fails on HTML served in place of JSON (a SPA fallback)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await expect(loadRuntimeConfig(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/config\.json/);
  });

  it('fails clearly when the request itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loadRuntimeConfig(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/config\.json/);
  });
});

describe('configFromViteEnv', () => {
  it('builds an Auth0 config from the Vite variables', () => {
    expect(configFromViteEnv({ VITE_AUTH0_DOMAIN: 't.example.com', VITE_AUTH0_CLIENT_ID: 'cid', VITE_AUTH0_AUDIENCE: 'aud' }))
      .toEqual({ auth: 'auth0', domain: 't.example.com', clientId: 'cid', audience: 'aud' });
  });

  it('is undefined when any variable is missing, so nothing is guessed', () => {
    expect(configFromViteEnv({ VITE_AUTH0_DOMAIN: 't.example.com' })).toBeUndefined();
  });
});

describe('peekRuntimeConfig', () => {
  it('is undefined until the config has loaded, then returns it', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ auth: 'local' }) }));
    try {
      const fresh = await import('../runtimeConfig');
      expect(fresh.peekRuntimeConfig()).toBeUndefined();
      await fresh.getRuntimeConfig();
      expect(fresh.peekRuntimeConfig()).toEqual({ auth: 'local' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
