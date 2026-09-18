import { describe, it, expect, vi } from 'vitest';
import {
  createTlClient, createTlTokenSource, classifyTlError, extractTlErrorCode, TL_AUTH_BASE,
} from '../providers/trueLayerClient';
import { ProviderError } from '../errors';

const credentials = { clientId: 'client-1', clientSecret: 'secret-1', environment: 'sandbox' as const };

function tokenResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('createTlTokenSource', () => {
  it('exchanges client credentials for a bearer token and caches it', async () => {
    const now = 1_760_000_000_000;
    const fetchImpl = vi.fn(async () => tokenResponse(200, { access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer', scope: 'data' }));
    const source = createTlTokenSource(credentials, () => now, fetchImpl);

    await expect(source()).resolves.toBe('tok-1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect(String(url)).toBe(`${TL_AUTH_BASE.sandbox}/connect/token`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(init.body).toBe('grant_type=client_credentials&client_id=client-1&client_secret=secret-1&scope=data');

    await source();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached, not re-fetched
  });

  it('refreshes within five minutes of expiry', async () => {
    let now = 1_760_000_000_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tokenResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(tokenResponse(200, { access_token: 'tok-2', expires_in: 3600 }));
    const source = createTlTokenSource(credentials, () => now, fetchImpl);

    await expect(source()).resolves.toBe('tok-1');
    now += 56 * 60_000;
    await expect(source()).resolves.toBe('tok-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws EXPIRED for invalid_grant', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(400, { error: 'invalid_grant' }));
    const source = createTlTokenSource(credentials, () => 0, fetchImpl);
    await expect(source()).rejects.toMatchObject({ type: 'EXPIRED' });
  });
});

describe('extractTlErrorCode', () => {
  it('reads the error field', () => {
    expect(extractTlErrorCode({ error: 'invalid_grant' })).toBe('invalid_grant');
  });

  it('falls back to title', () => {
    expect(extractTlErrorCode({ title: 'validation_error' })).toBe('validation_error');
  });

  it('returns undefined for an unrecognised shape', () => {
    expect(extractTlErrorCode({ foo: 'bar' })).toBeUndefined();
    expect(extractTlErrorCode(null)).toBeUndefined();
  });
});

describe('classifyTlError', () => {
  it.each([
    ['invalid_grant', 400, 'EXPIRED'],
    ['access_denied', 403, 'EXPIRED'],
    ['unauthorized', 401, 'EXPIRED'],
    ['invalid_token', 401, 'EXPIRED'],
    ['provider_too_many_requests', 429, 'RATE_LIMITED'],
    ['provider_request_limit_exceeded', 429, 'RATE_LIMITED'],
    ['internal_server_error', 500, 'TRANSIENT'],
    ['provider_error', 503, 'TRANSIENT'],
    ['connector_overload', 503, 'TRANSIENT'],
    ['temporarily_unavailable', 503, 'TRANSIENT'],
    ['provider_timeout', 504, 'TRANSIENT'],
    ['connector_timeout', 504, 'TRANSIENT'],
    ['validation_error', 400, 'INVALID_RESPONSE'],
    ['invalid_date_range', 400, 'INVALID_RESPONSE'],
    ['invalid_client', 400, 'INVALID_RESPONSE'],
    ['invalid_authorization_code', 400, 'INVALID_RESPONSE'],
  ])('classifies %s (%i) as %s', (code, status, expected) => {
    expect(classifyTlError(status, code)).toBe(expected);
  });

  it('falls back to HTTP-status classification for an unrecognised code', () => {
    expect(classifyTlError(500, 'some_new_code_not_in_the_docs')).toBe('TRANSIENT');
    expect(classifyTlError(404, undefined)).toBe('INVALID_RESPONSE');
  });
});

describe('createTlClient', () => {
  const sleep = vi.fn(async () => {});
  const token = vi.fn(async () => 'jwt-1');
  const apiBase = 'https://api.truelayer-sandbox.com';

  it('sends the bearer token and extra headers', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(200, { ok: true }));
    const client = createTlClient({ apiBase, token, fetchImpl, sleep });
    await expect(client.get('/v3/connected-accounts', undefined, { 'Connection-Id': 'conn-1', 'Tl-User-IP': '203.0.113.5' }))
      .resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.truelayer-sandbox.com/v3/connected-accounts');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-1');
    expect(headers['Connection-Id']).toBe('conn-1');
    expect(headers['Tl-User-IP']).toBe('203.0.113.5');
  });

  it('posts JSON bodies', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(202, { id: 'req-1', status: 'pending' }));
    const client = createTlClient({ apiBase, token, fetchImpl, sleep });
    await client.post('/v3/connected-accounts/acc-1/transactions/requests', { from: '2026-09-01', to: '2026-09-13' }, { 'Connection-Id': 'conn-1' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"from":"2026-09-01","to":"2026-09-13"}');
  });

  it('retries transient failures twice with backoff then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tokenResponse(503, { error: 'provider_error' }))
      .mockResolvedValueOnce(tokenResponse(503, { error: 'connector_overload' }))
      .mockResolvedValueOnce(tokenResponse(200, { ok: true }));
    const client = createTlClient({ apiBase, token, fetchImpl, sleep });
    await expect(client.get('/v3/connected-accounts')).resolves.toEqual({ ok: true });
    expect(sleep.mock.calls.slice(-2)).toEqual([[1000], [4000]]);
  });

  it('does not retry an EXPIRED-classified error', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(403, { error: 'access_denied' }));
    const client = createTlClient({ apiBase, token, fetchImpl, sleep });
    await expect(client.get('/v3/connected-accounts')).rejects.toMatchObject({ type: 'EXPIRED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('distinguishes two different 400 codes into different classifications', async () => {
    const grantFetch = vi.fn(async () => tokenResponse(400, { error: 'invalid_grant' }));
    const client1 = createTlClient({ apiBase, token, fetchImpl: grantFetch, sleep });
    await expect(client1.get('/x')).rejects.toMatchObject({ type: 'EXPIRED' });

    const validationFetch = vi.fn(async () => tokenResponse(400, { error: 'validation_error' }));
    const client2 = createTlClient({ apiBase, token, fetchImpl: validationFetch, sleep });
    await expect(client2.get('/x')).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });

  it('never puts the request path in error messages', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(404));
    const client = createTlClient({ apiBase, token, fetchImpl, sleep });
    await expect(client.get('/v3/connected-accounts/secret-account-id')).rejects.not.toThrow(/secret-account-id/);
  });
});
