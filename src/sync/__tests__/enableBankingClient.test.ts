import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decode, verify } from 'jsonwebtoken';
import { createEbClient, createJwtSource, PSU_IP_HEADER, PSU_USER_AGENT_HEADER } from '../providers/enableBankingClient';
import { ProviderError } from '../errors';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const credentials = { applicationId: '11111111-1111-4111-8111-111111111111', privateKeyPem: privateKey };

describe('createJwtSource', () => {
  it('signs an RS256 JWT with the application id as kid and a one-hour lifetime', () => {
    const now = 1_760_000_000_000;
    const token = createJwtSource(credentials, () => now)();
    const payload = verify(token, publicKey, { algorithms: ['RS256'], clockTimestamp: now / 1000 }) as Record<string, number | string>;
    const header = decode(token, { complete: true })?.header;
    expect(header?.kid).toBe(credentials.applicationId);
    expect(payload.iss).toBe('enablebanking.com');
    expect(payload.aud).toBe('api.enablebanking.com');
    expect(payload.iat).toBe(now / 1000);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(3600);
  });

  it('reuses the token until five minutes before expiry', () => {
    let now = 1_760_000_000_000;
    const jwt = createJwtSource(credentials, () => now);
    const first = jwt();
    now += 54 * 60_000;
    expect(jwt()).toBe(first);
    now += 2 * 60_000;
    expect(jwt()).not.toBe(first);
  });
});

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('createEbClient', () => {
  const sleep = vi.fn(async () => {});

  it('sends the bearer token, query and PSU headers', async () => {
    const fetchImpl = vi.fn(async () => response(200, { ok: true }));
    const client = createEbClient({ jwt: () => 'jwt-1', fetchImpl, sleep });
    await expect(client.get('/aspsps', { country: 'GB' }, { ipAddress: '203.0.113.5', userAgent: 'Firefox' })).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.enablebanking.com/aspsps?country=GB');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-1');
    expect(headers[PSU_IP_HEADER]).toBe('203.0.113.5');
    expect(headers[PSU_USER_AGENT_HEADER]).toBe('Firefox');
  });

  it('posts JSON bodies', async () => {
    const fetchImpl = vi.fn(async () => response(200, { session_id: 's' }));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await client.post('/sessions', { code: 'abc' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"code":"abc"}');
  });

  it('retries transient failures twice with backoff then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/aspsps')).resolves.toEqual({ ok: true });
    expect(sleep.mock.calls.slice(-2)).toEqual([[1000], [4000]]);
  });

  it('gives up after three transient failures', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/aspsps')).rejects.toMatchObject({ type: 'TRANSIENT' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry an expired consent', async () => {
    const fetchImpl = vi.fn(async () => response(401));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/accounts/x/transactions')).rejects.toMatchObject({ type: 'EXPIRED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON bodies as invalid responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/aspsps')).rejects.toBeInstanceOf(ProviderError);
  });

  it('never puts the request path in error messages', async () => {
    const fetchImpl = vi.fn(async () => response(404));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.delete('/sessions/secret-session-id')).rejects.not.toThrow(/secret-session-id/);
  });
});
