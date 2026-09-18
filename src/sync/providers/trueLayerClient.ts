import { ProviderError, classifyHttpStatus } from '../errors';
import type { ProviderErrorType } from '../errors';

export type TlEnvironment = 'live' | 'sandbox';

export interface TlCredentials {
  clientId: string;
  clientSecret: string;
  environment: TlEnvironment;
}

// Unconfirmed item 1: inferred from the confirmed auth-host pair, not directly verified.
export const TL_AUTH_BASE: Record<TlEnvironment, string> = {
  live: 'https://auth.truelayer.com',
  sandbox: 'https://auth.truelayer-sandbox.com',
};
export const TL_API_BASE: Record<TlEnvironment, string> = {
  live: 'https://api.truelayer.com',
  sandbox: 'https://api.truelayer-sandbox.com',
};

const TOKEN_LIFETIME_REFRESH_MARGIN_S = 300;
const RETRY_DELAYS_MS = [1000, 4000];

// `scope=data` (the original assumption) does not exist and is rejected with
// `invalid_scope` — confirmed against a real sandbox app during the Phase 0.3
// walkthrough. TrueLayer's client-credentials scopes are granular: `connections:create`
// authorises the connections-management calls this app makes (create/poll a
// connection), and the four product scopes authorise reading data via an
// established connection (used for get-user-info/get-accounts/fetchTransactions).
export const TOKEN_SCOPE = 'connections:create accounts balance info transactions';

const EXPIRED_CODES = new Set(['invalid_grant', 'access_denied', 'unauthorized', 'invalid_token']);
const RATE_LIMITED_CODES = new Set(['provider_too_many_requests', 'provider_request_limit_exceeded']);
const TRANSIENT_CODES = new Set([
  'internal_server_error', 'provider_error', 'connector_overload', 'temporarily_unavailable',
  'provider_timeout', 'connector_timeout',
]);
const INVALID_RESPONSE_CODES = new Set([
  'validation_error', 'invalid_date_range', 'invalid_client', 'invalid_authorization_code',
]);

export function extractTlErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (typeof record.title === 'string') return record.title;
  return undefined;
}

export function classifyTlError(status: number, code: string | undefined): ProviderErrorType {
  if (code && EXPIRED_CODES.has(code)) return 'EXPIRED';
  if (code && RATE_LIMITED_CODES.has(code)) return 'RATE_LIMITED';
  if (code && TRANSIENT_CODES.has(code)) return 'TRANSIENT';
  if (code && INVALID_RESPONSE_CODES.has(code)) return 'INVALID_RESPONSE';
  return classifyHttpStatus(status);
}

async function parseErrorBody(response: Response): Promise<string | undefined> {
  try {
    return extractTlErrorCode(await response.json());
  } catch {
    return undefined;
  }
}

export function createTlTokenSource(
  credentials: TlCredentials,
  nowMs: () => number,
  fetchImpl: typeof fetch = fetch,
): () => Promise<string> {
  let cached: { token: string; exp: number } | null = null;
  return async () => {
    const now = Math.floor(nowMs() / 1000);
    if (cached && cached.exp - now > TOKEN_LIFETIME_REFRESH_MARGIN_S) return cached.token;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: TOKEN_SCOPE,
    }).toString();

    const response = await fetchImpl(`${TL_AUTH_BASE[credentials.environment]}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const code = await parseErrorBody(response);
      throw new ProviderError(classifyTlError(response.status, code), `TrueLayer token request returned HTTP ${response.status}`);
    }

    const parsed = (await response.json()) as { access_token: string; expires_in: number };
    const exp = now + parsed.expires_in;
    cached = { token: parsed.access_token, exp };
    return parsed.access_token;
  };
}

export interface TlClient {
  get(path: string, query?: Record<string, string>, headers?: Record<string, string>): Promise<unknown>;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<unknown>;
}

export interface TlClientOptions {
  apiBase: string;
  token: () => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

export function createTlClient(options: TlClientOptions): TlClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  async function attempt(spec: RequestSpec): Promise<unknown> {
    const url = new URL(spec.path, options.apiBase);
    for (const [key, value] of Object.entries(spec.query ?? {})) url.searchParams.set(key, value);

    const token = await options.token();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...spec.headers };
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      });
    } catch {
      throw new ProviderError('TRANSIENT', `TrueLayer ${spec.method} request failed to connect`);
    }

    if (!response.ok) {
      const code = await parseErrorBody(response);
      throw new ProviderError(classifyTlError(response.status, code), `TrueLayer ${spec.method} returned HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('INVALID_RESPONSE', `TrueLayer ${spec.method} returned a non-JSON body`);
    }
  }

  async function send(spec: RequestSpec): Promise<unknown> {
    for (let attemptIndex = 0; ; attemptIndex++) {
      try {
        return await attempt(spec);
      } catch (error) {
        const retryable = error instanceof ProviderError && error.type === 'TRANSIENT';
        if (!retryable || attemptIndex >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attemptIndex]);
      }
    }
  }

  return {
    get: (path, query, headers) => send({ method: 'GET', path, query, headers }),
    post: (path, body, headers) => send({ method: 'POST', path, body, headers }),
  };
}
