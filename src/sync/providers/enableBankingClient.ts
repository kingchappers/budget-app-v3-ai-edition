import { sign } from 'jsonwebtoken';
import { ProviderError, classifyHttpStatus } from '../errors';
import type { PsuContext } from '../types';

export const EB_API_BASE = 'https://api.enablebanking.com';
export const PSU_IP_HEADER = 'Psu-Ip-Address';
export const PSU_USER_AGENT_HEADER = 'Psu-User-Agent';

const JWT_LIFETIME_S = 3600;
const JWT_REFRESH_MARGIN_S = 300;
const RETRY_DELAYS_MS = [1000, 4000];

export interface EbCredentials {
  applicationId: string;
  privateKeyPem: string;
}

export function createJwtSource(credentials: EbCredentials, nowMs: () => number): () => string {
  let cached: { token: string; exp: number } | null = null;
  return () => {
    const now = Math.floor(nowMs() / 1000);
    if (cached && cached.exp - now > JWT_REFRESH_MARGIN_S) return cached.token;
    const exp = now + JWT_LIFETIME_S;
    const token = sign(
      { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp },
      credentials.privateKeyPem,
      { algorithm: 'RS256', keyid: credentials.applicationId },
    );
    cached = { token, exp };
    return token;
  };
}

export interface EbClient {
  get(path: string, query?: Record<string, string>, psu?: PsuContext): Promise<unknown>;
  post(path: string, body: unknown, psu?: PsuContext): Promise<unknown>;
  delete(path: string): Promise<void>;
}

export interface EbClientOptions {
  jwt: () => string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestSpec {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  psu?: PsuContext;
}

export function createEbClient(options: EbClientOptions): EbClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  async function attempt(spec: RequestSpec): Promise<unknown> {
    const url = new URL(spec.path, EB_API_BASE);
    for (const [key, value] of Object.entries(spec.query ?? {})) url.searchParams.set(key, value);

    const headers: Record<string, string> = { Authorization: `Bearer ${options.jwt()}`, Accept: 'application/json' };
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.psu) {
      headers[PSU_IP_HEADER] = spec.psu.ipAddress;
      headers[PSU_USER_AGENT_HEADER] = spec.psu.userAgent;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      });
    } catch {
      throw new ProviderError('TRANSIENT', `Enable Banking ${spec.method} request failed to connect`);
    }

    if (!response.ok) {
      throw new ProviderError(classifyHttpStatus(response.status), `Enable Banking ${spec.method} returned HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('INVALID_RESPONSE', `Enable Banking ${spec.method} returned a non-JSON body`);
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
    get: (path, query, psu) => send({ method: 'GET', path, query, psu }),
    post: (path, body, psu) => send({ method: 'POST', path, body, psu }),
    delete: async path => { await send({ method: 'DELETE', path }); },
  };
}
