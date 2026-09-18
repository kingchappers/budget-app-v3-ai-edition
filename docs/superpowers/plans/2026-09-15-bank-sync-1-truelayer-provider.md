# Bank Sync 1 — TrueLayer Provider Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Why this plan exists:** `2026-09-13-bank-sync-1-foundation.md` was built against Enable Banking, which does not support UK banks at all (lost EU passporting rights post-Brexit). Tasks 1-5 and 8 of that plan are provider-agnostic and already merged on `feat/bank-sync-1-foundation` — **they need no changes and this plan does not touch them.** Tasks 6-7 of that plan were built against Enable Banking specifically and are **already merged**; this plan's Task 24 deletes them. Everything from Task 9 onward in the original plan assumed Enable Banking's specific flow and **was never implemented** — this plan supersedes those task numbers with new ones (24+) written against TrueLayer's actual API, confirmed via the research recorded in the rewritten spec's "Provider Change Log".

**Spec:** `docs/superpowers/specs/2026-09-13-bank-sync-1-foundation-design.md` (rewritten 2026-09-15 for TrueLayer — read its "Provider Change Log" section first)
**Build order:** `docs/superpowers/plans/2026-09-13-bank-sync-build-order.md`

## What needs rework vs. what doesn't

| Original task | Status | Action |
|---|---|---|
| 1-4 (pure sync core) | Merged, provider-agnostic | **No action.** |
| 5 (`SyncStore` + DynamoDB) | Merged, provider-agnostic | **No action.** |
| 6 (Enable Banking JWT + HTTP client) | Merged, Enable-Banking-specific | **Delete** (Task 24 below), **replace** with Task 25. |
| 7 (Enable Banking provider) | Merged, Enable-Banking-specific | **Delete** (Task 24 below), **replace** with Task 26. |
| 8 (`runSync`) | Merged, provider-agnostic | **No action.** |
| 9 (worker commands) | Never implemented | Superseded by Task 27. |
| 10 (worker Lambda entry, secret, build) | Never implemented | Superseded by Task 28. |
| 11 (IAM roles, table TTL/SSE, log groups) | Never implemented | **No provider-specific change** — its content in the original plan doesn't name Enable Banking anywhere except a role's comment; implement it as originally written when its turn comes, updating the secret-ARN reference in the worker role's policy to `${app_name}/truelayer` (Task 29 covers the secret resource itself). |
| 12 (worker Lambda, secret, schedule, invoke permission) | Never implemented | Superseded by Task 29. |
| 13 (transactions `bankRef` preservation) | Never implemented | **No provider-specific change** — implement as originally written. |
| 14 (worker invoke client, banks/sync handlers) | Never implemented | Superseded by Task 30. |
| 15 (inbox endpoints) | Never implemented | **No provider-specific change** — implement as originally written. |
| 16 (register routes) | Never implemented | Superseded by Task 31. |
| 17 (frontend types, API client, query hooks) | Never implemented | Superseded by Task 32. |
| 18 (pure UI helpers for banks/sync) | Never implemented | Superseded by Task 33. |
| 19 (bank callback route, Auth0 fix) | Never implemented | Superseded by Task 34. |
| 20 (banks page) | Never implemented | Superseded by Task 35. |
| 21 (inbox page) | Never implemented | **No provider-specific change** — implement as originally written. |
| 22 (navigation, inbox badge, attention banner) | Never implemented | **No provider-specific change** — `AttentionBanner` only consumes the `needsAttention` boolean, whose shape is unchanged. Implement as originally written. |
| 23 (spec update, e2e verification, security review) | Never implemented | **No structural change** — its manual verification checklist should reference TrueLayer's sandbox instead of Enable Banking's, which the rewritten spec's Testing section already reflects. |

## Global Constraints

All constraints from the original plan still apply (amounts positive integer
pence — though TrueLayer already gives minor units, so no string parsing is
needed for this provider; GBP-only; settled/booked transactions only; lock
staleness 10 min; TDD; conventional commits with this session's attribution
lines) **except**:

- Consent validity is **not** requested with a duration parameter and no
  `consentValidUntil`-equivalent is stored, since no confirmed v3 expiry
  timestamp exists (see spec's Provider Change Log). Drop any reference to
  `min(bank maximum, 180 days)` from the original plan.
- No new third-party runtime library needed beyond what's already installed
  for Enable Banking (`@aws-sdk/client-lambda`,
  `@aws-sdk/client-secrets-manager`, already added by whichever of
  Task 10/28 lands first). **`jsonwebtoken` is no longer needed** — Task 24
  checks whether anything else in the codebase still uses it before removing
  it from `package.json`.
- PSU/user-present context is sent as `Tl-User-IP` (and possibly
  `X-Device-User-Agent` — confirm exact header name against sandbox) instead
  of Enable Banking's `Psu-Ip-Address`/`Psu-User-Agent`.

## Unconfirmed items — confirm against sandbox before or during implementation

These are carried from the spec's Provider Change Log. Wherever a task below
depends on one, it says so explicitly with a "Step 1: Confirm against
sandbox" step, following the same convention the original plan used for its
own Enable Banking unknowns (PSU header names, response shapes).

1. `TL_API_BASE` values (`https://api.truelayer.com` /
   `https://api.truelayer-sandbox.com`) are inferred from the confirmed
   auth-host naming pattern, not directly confirmed.
2. The exact field carrying a machine-readable error code in TrueLayer's
   error response bodies (`error`, `title`, or something else).
3. Whether the token endpoint expects `application/x-www-form-urlencoded`
   (the OAuth2 standard, assumed here) or JSON.
4. The terminal `status` value `GET /v3/data-connections/{id}` returns once
   ready to use (only `authorization_required`/`authorizing` are confirmed
   pending states).
5. The redirect query parameters TrueLayer appends to `return_uri`.
6. Whether `return_uri`'s domain needs pre-allowlisting in the TrueLayer
   console.
7. Whether a v3 "end/revoke connection" API call exists for disconnect.
8. Numeric rate-limit thresholds.

---

## Phase C (rewritten) — TrueLayer

### Task 24: Delete Enable Banking provider files

**Files:**
- Delete: `src/sync/providers/enableBankingClient.ts`, `src/sync/providers/enableBanking.ts`, `src/sync/__tests__/enableBankingClient.test.ts`, `src/sync/__tests__/enableBanking.test.ts`
- Modify: `package.json` (remove `jsonwebtoken` and `@types/jsonwebtoken` if present, **only if** nothing else in the codebase imports `jsonwebtoken`)

**Interfaces:**
- Nothing downstream references these files yet (Tasks 9-23 of the original plan, which would have consumed `EnableBankingApi`/`EbBank`/`isAllowedAuthUrl`, were never implemented) — this is a clean deletion, not a refactor.

- [ ] **Step 1: Confirm nothing else depends on these files or `jsonwebtoken`**

Run: `grep -rn "enableBanking\|jsonwebtoken" --include='*.ts' --include='*.tsx' src app api-handler.ts scripts | grep -v __tests__/enableBanking`

Expected: only the two provider files and their own tests reference `enableBanking*`; if `jsonwebtoken` appears anywhere outside `enableBankingClient.ts`, do not remove it from `package.json` — leave the dependency in place and note this in your report.

- [ ] **Step 2: Delete and verify**

Delete the four files listed above. Run: `yarn test && yarn typecheck`
Expected: PASS — the sync test count drops by the number of tests those two files contained (23 tests: 9 client + 14 provider, per Tasks 6-7's merged commits); no other test references these modules.

- [ ] **Step 3: Remove the dependency (only if Step 1 confirmed it's unused elsewhere)**

Run: `yarn remove jsonwebtoken @types/jsonwebtoken` (only if that package name appears in `package.json` — check first; `@types/jsonwebtoken` may not be a separate dependency if `jsonwebtoken` ships its own types).
Run: `yarn test && yarn typecheck` again to confirm removal didn't break anything.

- [ ] **Step 4: Commit**

```bash
git rm src/sync/providers/enableBankingClient.ts src/sync/providers/enableBanking.ts src/sync/__tests__/enableBankingClient.test.ts src/sync/__tests__/enableBanking.test.ts
git add package.json yarn.lock
git commit -m "chore(sync): remove Enable Banking provider (no UK support, replaced by TrueLayer)"
```

---

### Task 25: TrueLayer client (token source + retrying HTTP client)

**Files:**
- Create: `src/sync/providers/trueLayerClient.ts`
- Test: `src/sync/__tests__/trueLayerClient.test.ts`

**Interfaces:**
- Consumes: `ProviderError`, `classifyHttpStatus` (Task 1), `PsuContext` (Task 1).
- Produces:
  - `TlEnvironment = 'live' | 'sandbox'`
  - `TlCredentials { clientId: string; clientSecret: string; environment: TlEnvironment }`
  - `TL_AUTH_BASE: Record<TlEnvironment, string>`, `TL_API_BASE: Record<TlEnvironment, string>` — see unconfirmed item 1
  - `createTlTokenSource(credentials: TlCredentials, nowMs: () => number, fetchImpl?: typeof fetch): () => Promise<string>` — note this is **async**, unlike Enable Banking's synchronous JWT signing, since it fetches a real token over HTTP
  - `TlClient { get(path, query?, headers?): Promise<unknown>; post(path, body, headers?): Promise<unknown> }`
  - `createTlClient(options: { apiBase: string; token: () => Promise<string>; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): TlClient`
  - `classifyTlError(status: number, code: string | undefined): ProviderErrorType`
  - `extractTlErrorCode(body: unknown): string | undefined`

- [ ] **Step 1: Confirm token endpoint content type and error body field against sandbox**

Using a scratch script against the TrueLayer sandbox (unconfirmed items 2-3), confirm: does `POST /connect/token` expect `application/x-www-form-urlencoded` or JSON? What field name in an error response body carries the machine-readable code (e.g. `invalid_grant`) — `error`, `title`, something else? Adjust `extractTlErrorCode` and the token request body encoding below if either differs from what's assumed. Record findings in the spec's Provider Change Log during Task 23-equivalent verification.

- [ ] **Step 2: Write the failing tests**

`src/sync/__tests__/trueLayerClient.test.ts`:
```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run src/sync/__tests__/trueLayerClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/sync/providers/trueLayerClient.ts`:
```ts
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
      scope: 'data',
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run src/sync/__tests__/trueLayerClient.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sync/providers/trueLayerClient.ts src/sync/__tests__/trueLayerClient.test.ts
git commit -m "feat(sync): add TrueLayer client-credentials token source and retrying HTTP client"
```

---

### Task 26: TrueLayer provider

**Files:**
- Create: `src/sync/providers/trueLayer.ts`
- Test: `src/sync/__tests__/trueLayer.test.ts`

**Interfaces:**
- Consumes: `TlClient` (Task 25), `isRecord` (Task 1), `SessionAccount` (Task 3 — reused as-is, TrueLayer's account shape maps onto the same interface).
- Produces:
  - `TlUserInfo { name: string }`
  - `TlAccount extends SessionAccount` (adds nothing new — `accountUid`, `displayName`, `last4`, `currency` are sufficient)
  - `TrueLayerApi extends BankProvider` with `createConnection(input: CreateConnectionInput): Promise<{ providerConnectionId: string; hostedPageUrl: string }>`, `pollConnectionStatus(providerConnectionId: string): Promise<'PENDING' | 'READY' | 'FAILED'>`, `getUserInfo(providerConnectionId: string): Promise<TlUserInfo>`, `getAccounts(providerConnectionId: string): Promise<TlAccount[]>`
  - `CreateConnectionInput { returnUri: string; state: string; psu: PsuContext }`
  - `createTrueLayerProvider(client: TlClient): TrueLayerApi`
  - `isAllowedHostedPageUrl(value: string): boolean`
  - `MAX_TRANSACTION_PAGES = 50`, `MAX_STATUS_POLLS = 10`, `STATUS_POLL_INTERVAL_MS = 2000`

- [ ] **Step 1: Confirm connection-status values and hosted-page host against sandbox**

Using the sandbox app from Phase 0.2/0.3 of the build order, call `POST
/v3/data-connections` once and inspect the real `hosted_page.uri` host (for
`isAllowedHostedPageUrl`'s allowlist), then poll `GET
/v3/data-connections/{id}` before and after completing consent at the mock
bank to observe the actual sequence of `status` values (unconfirmed item 4).
Adjust the status mapping in `pollConnectionStatus` below if the ready-state
name differs from the placeholder used here. Do not commit real sandbox
responses; record findings in the spec's Provider Change Log during Task
23-equivalent verification.

- [ ] **Step 2: Write the failing test**

`src/sync/__tests__/trueLayer.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createTrueLayerProvider, isAllowedHostedPageUrl, MAX_TRANSACTION_PAGES } from '../providers/trueLayer';
import type { TlClient } from '../providers/trueLayerClient';
import type { ConnectedAccount, Connection } from '../types';

const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };

function fakeClient(overrides: Partial<TlClient> = {}): TlClient {
  return { get: vi.fn(), post: vi.fn(), ...overrides };
}

const account: ConnectedAccount = {
  accountUid: 'acc-1', dedupeId: 'acc-1', displayName: 'Current', last4: '1234', currency: 'GBP', startDate: '2026-09-01',
};
const connection: Connection = {
  connectionId: 'c1', provider: 'truelayer', displayName: 'My Bank', status: 'ACTIVE', consecutiveFailures: 0,
  accounts: [account], auth: { providerConnectionId: 'tl-conn-1' },
  createdAt: 't', updatedAt: 't',
};

const settled = (id: string) => ({
  id, timestamp: '2026-09-10T00:00:00Z', description: 'TESCO STORES', currency: 'GBP',
  amount_in_minor: -350, status: 'settled',
});

describe('isAllowedHostedPageUrl', () => {
  it.each([
    ['https://payment.truelayer.com/pay', true],
    ['https://auth.truelayer.com/authorize', true],
    ['http://payment.truelayer.com/', false],
    ['https://truelayer.com.evil.example/', false],
    ['https://eviltruelayer.com/', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isAllowedHostedPageUrl(url)).toBe(expected);
  });
});

describe('createConnection', () => {
  it('posts the connection request and returns the provider connection id and hosted page url', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ id: 'tl-conn-1', status: 'authorization_required', hosted_page: { uri: 'https://payment.truelayer.com/x' } })) });
    const result = await createTrueLayerProvider(client).createConnection({ returnUri: 'https://app.example/banks/callback', state: 'state-1', psu });
    expect(result).toEqual({ providerConnectionId: 'tl-conn-1', hostedPageUrl: 'https://payment.truelayer.com/x' });
    expect(client.post).toHaveBeenCalledWith('/v3/data-connections', expect.objectContaining({
      scopes: ['info', 'accounts', 'balance', 'transactions'],
      data_access_type: 'recurring',
    }), undefined);
  });

  it('rejects a malformed response', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ status: 'authorization_required' })) });
    await expect(createTrueLayerProvider(client).createConnection({ returnUri: 'x', state: 's', psu })).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });

  it('rejects a hosted page url on a disallowed host', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ id: 'c1', status: 'authorization_required', hosted_page: { uri: 'https://evil.example/x' } })) });
    await expect(createTrueLayerProvider(client).createConnection({ returnUri: 'x', state: 's', psu })).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});

describe('pollConnectionStatus', () => {
  it('reports PENDING for authorization_required and authorizing', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ status: 'authorization_required' })) });
    await expect(createTrueLayerProvider(client).pollConnectionStatus('tl-conn-1')).resolves.toBe('PENDING');
  });

  it('reports READY once the connection leaves the pending states', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ status: 'authorized' })) });
    await expect(createTrueLayerProvider(client).pollConnectionStatus('tl-conn-1')).resolves.toBe('READY');
  });
});

describe('getUserInfo', () => {
  it('returns the account holder name', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ name: 'A. Person' })) });
    await expect(createTrueLayerProvider(client).getUserInfo('tl-conn-1')).resolves.toEqual({ name: 'A. Person' });
    expect(client.get).toHaveBeenCalledWith('/v3/data-connections/tl-conn-1/user-info', undefined, { 'Connection-Id': 'tl-conn-1' });
  });
});

describe('getAccounts', () => {
  it('maps connected accounts and derives last4 from sort-code-account-number or iban', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        items: [
          { id: 'a1', currency: 'GBP', account_type: 'current', account_identifiers: [{ type: 'sort_code_account_number', account_number: '12345678' }] },
          { id: 'a2', currency: 'GBP', account_type: 'savings', account_identifiers: [{ type: 'iban', iban: 'GB33 BUKB 2020 1555 5555 55' }] },
          { id: 'a3', currency: 'EUR', account_type: 'current', account_identifiers: [] },
        ],
        pagination: { next_cursor: null },
      })),
    });
    const accounts = await createTrueLayerProvider(client).getAccounts('tl-conn-1');
    expect(accounts).toEqual([
      { accountUid: 'a1', displayName: 'Current Account', last4: '5678', currency: 'GBP' },
      { accountUid: 'a2', displayName: 'Savings Account', last4: '5555', currency: 'GBP' },
      { accountUid: 'a3', displayName: 'Current Account', last4: '', currency: 'EUR' },
    ]);
  });
});

describe('fetchTransactions', () => {
  it('submits a request, polls until completed, and normalises settled transactions', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'completed', results: [settled('t1')], pagination: { next_cursor: 'p2' } })
      .mockResolvedValueOnce({ status: 'completed', results: [settled('t2')], pagination: { next_cursor: null } });
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    const result = await provider.fetchTransactions(connection, account, { from: '2026-09-01', to: '2026-09-13' }, { psu, deadline: Date.now() + 60_000 });
    expect(result.map(t => t.entryReference)).toEqual(['t1', 't2']);
    expect(post).toHaveBeenCalledWith('/v3/connected-accounts/acc-1/transactions/requests', { from: '2026-09-01', to: '2026-09-13' }, { 'Connection-Id': 'tl-conn-1' });
  });

  it('skips pending (unsettled) transactions', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({
      status: 'completed',
      results: [{ ...settled('t1'), status: 'pending' }, settled('t2')],
      pagination: { next_cursor: null },
    }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    const result = await provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 });
    expect(result.map(t => t.entryReference)).toEqual(['t2']);
  });

  it('derives direction and amount from the signed minor-unit amount', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({
      status: 'completed',
      results: [settled('debit'), { ...settled('credit'), amount_in_minor: 500 }],
      pagination: { next_cursor: null },
    }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    const [debit, credit] = await provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 });
    expect(debit).toMatchObject({ amountPence: 350, direction: 'OUT' });
    expect(credit).toMatchObject({ amountPence: 500, direction: 'IN' });
  });

  it('throws INVALID_RESPONSE when the transactions request itself fails', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({ status: 'failed' }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });

  it('throws TRANSIENT if the request never completes within the poll budget', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({ status: 'pending' }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 }))
      .rejects.toMatchObject({ type: 'TRANSIENT' });
    expect(get).toHaveBeenCalledTimes(10); // MAX_STATUS_POLLS
  });

  it('fails rather than silently truncating after the page cap', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({ status: 'completed', results: [], pagination: { next_cursor: 'again' } }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/trueLayer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/sync/providers/trueLayer.ts`:
```ts
import { isRecord } from '../../api/body';
import type { SessionAccount } from '../accounts';
import { ProviderError } from '../errors';
import type { BankProvider, PsuContext, ProviderTransaction } from '../types';
import type { TlClient } from './trueLayerClient';

export const MAX_TRANSACTION_PAGES = 50;
export const MAX_STATUS_POLLS = 10;
export const STATUS_POLL_INTERVAL_MS = 2000;
const HOSTED_PAGE_HOST = 'truelayer.com';
// Unconfirmed item 4: placeholder terminal status name — confirm during
// Task 26 Step 1 against the sandbox and adjust the check below.
const CONNECTION_PENDING_STATUSES = new Set(['authorization_required', 'authorizing']);

export interface TlUserInfo {
  name: string;
}

export type TlAccount = SessionAccount;

export interface CreateConnectionInput {
  returnUri: string;
  state: string;
  psu: PsuContext;
}

export interface TrueLayerApi extends BankProvider {
  createConnection(input: CreateConnectionInput): Promise<{ providerConnectionId: string; hostedPageUrl: string }>;
  pollConnectionStatus(providerConnectionId: string): Promise<'PENDING' | 'READY' | 'FAILED'>;
  getUserInfo(providerConnectionId: string): Promise<TlUserInfo>;
  getAccounts(providerConnectionId: string): Promise<TlAccount[]>;
}

export function isAllowedHostedPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === HOSTED_PAGE_HOST || url.hostname.endsWith(`.${HOSTED_PAGE_HOST}`));
  } catch {
    return false;
  }
}

function invalid(what: string): ProviderError {
  return new ProviderError('INVALID_RESPONSE', `TrueLayer ${what} has an unexpected shape`);
}

function connectionIdHeader(providerConnectionId: string): Record<string, string> {
  return { 'Connection-Id': providerConnectionId };
}

function lastFour(identifiers: unknown): string {
  if (!Array.isArray(identifiers)) return '';
  for (const raw of identifiers) {
    if (!isRecord(raw)) continue;
    const identifier = typeof raw.account_number === 'string' ? raw.account_number : typeof raw.iban === 'string' ? raw.iban : undefined;
    if (identifier) return identifier.replace(/\s/g, '').slice(-4);
  }
  return '';
}

function accountDisplayName(accountType: unknown): string {
  if (accountType === 'savings') return 'Savings Account';
  return 'Current Account';
}

function parseTlAccount(raw: unknown): TlAccount {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.currency !== 'string') throw invalid('connected account');
  return {
    accountUid: raw.id,
    displayName: accountDisplayName(raw.account_type),
    last4: lastFour(raw.account_identifiers),
    currency: raw.currency,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normaliseTlTransaction(raw: unknown, startDate: string): ProviderTransaction | null {
  if (
    !isRecord(raw)
    || typeof raw.id !== 'string'
    || typeof raw.timestamp !== 'string'
    || typeof raw.currency !== 'string'
    || typeof raw.amount_in_minor !== 'number'
    || typeof raw.status !== 'string'
  ) {
    throw invalid('transaction');
  }

  if (raw.status !== 'settled') return null;
  if (raw.currency !== 'GBP') return null;

  const bookingDate = raw.timestamp.slice(0, 10);
  if (bookingDate < startDate) return null;

  const amountPence = Math.abs(raw.amount_in_minor);
  if (amountPence === 0) return null;

  const direction = raw.amount_in_minor < 0 ? 'OUT' : 'IN';
  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim().slice(0, 200) : 'Bank transaction';

  return {
    entryReference: raw.id,
    amountPence,
    direction,
    bookingDate,
    description,
    currency: raw.currency,
    fallbackBasis: [bookingDate, amountPence, direction, description].join('|'),
  };
}

export function createTrueLayerProvider(client: TlClient): TrueLayerApi {
  return {
    id: 'truelayer',

    async createConnection(input) {
      const response = await client.post('/v3/data-connections', {
        scopes: ['info', 'accounts', 'balance', 'transactions'],
        data_access_type: 'recurring',
        authorization_flow: { redirect: { return_uri: input.returnUri } },
        user_consent: { state: input.state },
      }, undefined);

      if (!isRecord(response) || typeof response.id !== 'string' || !isRecord(response.hosted_page) || typeof response.hosted_page.uri !== 'string') {
        throw invalid('connection response');
      }
      if (!isAllowedHostedPageUrl(response.hosted_page.uri)) throw invalid('hosted page url');

      return { providerConnectionId: response.id, hostedPageUrl: response.hosted_page.uri };
    },

    async pollConnectionStatus(providerConnectionId) {
      const response = await client.get(`/v3/data-connections/${encodeURIComponent(providerConnectionId)}`, undefined, connectionIdHeader(providerConnectionId));
      if (!isRecord(response) || typeof response.status !== 'string') throw invalid('connection status response');
      if (response.status === 'failed') return 'FAILED';
      return CONNECTION_PENDING_STATUSES.has(response.status) ? 'PENDING' : 'READY';
    },

    async getUserInfo(providerConnectionId) {
      const response = await client.get(`/v3/data-connections/${encodeURIComponent(providerConnectionId)}/user-info`, undefined, connectionIdHeader(providerConnectionId));
      if (!isRecord(response) || typeof response.name !== 'string') throw invalid('user-info response');
      return { name: response.name };
    },

    async getAccounts(providerConnectionId) {
      const response = await client.get('/v3/connected-accounts', undefined, connectionIdHeader(providerConnectionId));
      if (!isRecord(response) || !Array.isArray(response.items)) throw invalid('connected accounts response');
      return response.items.map(parseTlAccount);
    },

    async fetchTransactions(connection, account, window, ctx) {
      if (connection.provider !== 'truelayer') throw invalid('connection (not a TrueLayer connection)');
      const headers = connectionIdHeader(connection.auth.providerConnectionId);

      const createResponse = await client.post(`/v3/connected-accounts/${encodeURIComponent(account.accountUid)}/transactions/requests`, {
        from: window.from,
        to: window.to,
      }, headers);
      if (!isRecord(createResponse) || typeof createResponse.id !== 'string') throw invalid('transactions request response');
      const requestId = createResponse.id;

      const results: ProviderTransaction[] = [];
      let cursor: string | undefined;
      let pollCount = 0;

      for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
        let statusResponse: unknown;
        for (;;) {
          const query = cursor ? { cursor } : undefined;
          statusResponse = await client.get(`/v3/connected-accounts/${encodeURIComponent(account.accountUid)}/transactions/requests/${encodeURIComponent(requestId)}`, query, headers);
          if (!isRecord(statusResponse) || typeof statusResponse.status !== 'string') throw invalid('transactions-request status response');
          if (statusResponse.status === 'completed') break;
          if (statusResponse.status === 'failed') throw invalid('transactions-request (failed)');
          pollCount += 1;
          if (pollCount >= MAX_STATUS_POLLS) throw new ProviderError('TRANSIENT', 'TrueLayer transactions request did not complete in time');
          await sleep(STATUS_POLL_INTERVAL_MS);
        }

        const page_ = statusResponse as Record<string, unknown>;
        if (!Array.isArray(page_.results)) throw invalid('transactions-request results');
        for (const raw of page_.results) {
          const transaction = normaliseTlTransaction(raw, account.startDate);
          if (transaction) results.push(transaction);
        }

        const pagination = page_.pagination;
        cursor = isRecord(pagination) && typeof pagination.next_cursor === 'string' ? pagination.next_cursor : undefined;
        if (!cursor) return results;
      }

      throw new ProviderError('INVALID_RESPONSE', `TrueLayer returned more than ${MAX_TRANSACTION_PAGES} pages`);
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run src/sync/__tests__/trueLayer.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Update `Connection` and `ConnectionStatus` types for the new provider**

`src/sync/types.ts` — replace the Enable-Banking-specific `EnableBankingConnection`/`Connection` with:
```ts
export interface TrueLayerConnection extends ConnectionBase {
  provider: 'truelayer';
  auth: { providerConnectionId: string };
}

export type Connection = TrueLayerConnection;
```
and change `ProviderId` from `'enable-banking'` to `'truelayer'`. Run `yarn typecheck` — this will surface every remaining reference to the old provider id/connection shape across the codebase (there should be none outside test fixtures, since Tasks 9-23 were never implemented against the old shape); fix any that appear.

- [ ] **Step 7: Commit**

```bash
git add src/sync/providers/trueLayer.ts src/sync/__tests__/trueLayer.test.ts src/sync/types.ts
git commit -m "feat(sync): add TrueLayer provider for connections, accounts and transactions"
```

---

## Phase E (rewritten) — Bank worker

### Task 27: Worker command parsing and execution (TrueLayer)

Same file layout as the original Task 9 (`src/sync/commands.ts`,
`src/sync/__tests__/commands.test.ts`). Differences from the original task's
design:

- `WorkerCommand` union becomes: `createConnection { userId, startDate, connectionId?, psu }`, `completeConnection { userId, state, psu }`, `syncNow { userId, psu }`, `disconnect { userId, connectionId }` — **`listBanks`/`startAuth`/`completeAuth` are removed**; there is no bank-picker command since TrueLayer's hosted page shows its own bank search (see spec's Product Decisions).
- `WorkerDeps extends RunSyncDeps { tl: TrueLayerApi; redirectUrl: string; newId: () => string }` (renamed `eb` → `tl`).
- Result values: `createConnection` → `{ url: string }`; `completeConnection` → `{ connection: Connection }`; `syncNow` → `UserSyncOutcome`; `disconnect` → `{ disconnected: true }`.
- `createConnection`'s execution: generate `state` via `newId()`, put `BANKAUTH#state` with the pending auth's `startDate`/`connectionId?`, call `tl.createConnection({ returnUri: deps.redirectUrl, state, psu })`, store the returned `providerConnectionId` on the same `BANKAUTH#state` item (new field vs. the original `PendingAuth` type — add `providerConnectionId?: string` to `PendingAuth` in `src/sync/types.ts`), return `{ url: hostedPageUrl }`.
- `completeConnection`'s execution: read `BANKAUTH#state`, call `tl.pollConnectionStatus(providerConnectionId)`; if `FAILED` return a `WorkerResult` error; if still `PENDING` after `MAX_STATUS_POLLS` (Task 26) return an error asking the caller to retry (the callback UI can poll `/api/banks/callback` again); if `READY`, call `tl.getUserInfo` and `tl.getAccounts`, build/update the `Connection` record (matching accounts via `matchAccounts` from Task 3, same as the original design), delete `BANKAUTH#state`, return `{ connection }`.
- Validation: no `aspspName`/`country`/`code` fields anywhere in the command union (they don't exist for this provider). `startDate` and UUID validation rules are unchanged from the original Task 9.

Write this task's tests and implementation following the exact TDD process the original Task 9 used (failing test → implementation → passing test → commit), adapting its test fixtures to the command/result shapes above. Use the `FakeProvider`/`FakeSyncStore` fakes from Task 8 (unchanged) plus a hand-written fake `TrueLayerApi` in the test file (mirroring how the original Task 9 test faked `EnableBankingApi`).

---

### Task 28: Worker Lambda entry, secret loading and build (TrueLayer)

Same file layout as the original Task 10 (`src/sync/secrets.ts`,
`sync-handler.ts`, `scripts/build-api-handler.cjs`, `package.json`,
`.gitignore`). Differences:

- `parseTlCredentials(secretString: string | undefined): TlCredentials` replaces `parseEbCredentials` — expects `{ "clientId": "...", "clientSecret": "...", "environment": "live" | "sandbox" }` (three fields, not two — `environment` selects which of `TL_AUTH_BASE`/`TL_API_BASE` to use, with no Enable-Banking equivalent since that provider used one host for both sandbox and production, differentiated by application id instead).
- `loadTlCredentials(secretId: string, client?: SecretsManagerClient): Promise<TlCredentials>` replaces `loadEbCredentials`.
- Env var `EB_SECRET_ID` becomes `TL_SECRET_ID`.
- `handler` wiring builds `TrueLayerApi` via `createTrueLayerProvider(createTlClient({ apiBase: TL_API_BASE[credentials.environment], token: createTlTokenSource(credentials, Date.now), ... }))` instead of the Enable Banking JWT-source wiring.
- No RSA/PEM validation in the credential parser (TrueLayer's `clientSecret` is an opaque string, not a private key) — validate `clientId`/`clientSecret` are non-empty strings and `environment` is exactly `'live'` or `'sandbox'`.

Write this task's tests and implementation following the exact TDD process the original Task 10 used.

---

## Phase F (rewritten) — Infrastructure

### Task 29: Worker Lambda, secret, schedule and invoke permission (TrueLayer)

Same file layout as the original Task 12 (`infra/sync-lambda.tf`,
`infra/variables.tf`, `infra/api-lambda.tf`). Differences:

- Secret resource renamed: `aws_secretsmanager_secret.truelayer` with `name = "${var.app_name}/truelayer"`, description updated to "TrueLayer clientId, clientSecret and environment for the bank worker".
- Every other reference to `enable_banking`/`enable-banking` in the original Task 12 code (IAM policy resource ARN, environment variable name, output name) becomes `truelayer`/`TL_SECRET_ID` accordingly.
- No other structural change — the worker Lambda's timeout/memory/schedule/log-group/IAM-role shape from the original Task 11/12 is provider-agnostic and stands as originally planned.

Write this task's implementation following the exact process the original Task 12 used (OpenTofu, no test suite — `tofu validate` and plan review as the original task specified).

---

## Phase G (rewritten) — API

### Task 30: Worker invoke client and banks/sync handlers (TrueLayer)

Same file layout as the original Task 14 (`src/api/worker.ts`,
`src/api/banks.ts`, `src/api/__tests__/banks.test.ts`). Differences:

- Handlers: `listAspsps` is **removed** entirely (no bank-picker route). Remaining handlers: `connectBank`, `completeBankCallback`, `clearPendingAuth`, `listBankConnections`, `disconnectBank`, `triggerSync`, `getSyncStatus`.
- `connectBank`'s request body: `{ startDate, connectionId? }` — no `aspspName`/`country`. Invokes the `createConnection` worker command (Task 27) and returns `{ url }`.
- `completeBankCallback`'s request body: `{ state }` — no `code`. Invokes the `completeConnection` worker command and returns 201 `{ connection }`, or an appropriate error status if the command reports the connection is still pending/failed (design a specific response, e.g. 202 `{ status: 'PENDING' }`, so the frontend callback page can poll rather than treating "not ready yet" as an error — see Task 34).
- `PublicConnection = Omit<Connection, 'auth'> & { needsAttention: boolean }` — **`expiresInDays` is dropped** (no confirmed expiry timestamp to derive it from, per the spec).
- `toPublicConnection`'s `needsAttention` computation becomes purely `status === 'EXPIRED' || status === 'ERROR'` (drops the `expiresInDays <= 7` clause).
- `validateStartDate` is unchanged.

Write this task's tests and implementation following the exact TDD process the original Task 14 used, adapting fixtures to drop `aspspName`/`country`/`code`/`expiresInDays` throughout.

---

### Task 31: Register routes (TrueLayer)

Same as the original Task 16, except:
- **Remove** `router.get('/api/banks/aspsps', listAspsps);` and the `listAspsps` import — there is no such route or handler.
- All other route registrations (`connect`, `callback`, `auth/{state}` delete, `connections`, `connections/{connectionId}` delete, `sync`, `sync/status`, inbox routes) are unchanged.

---

## Phase H (rewritten) — Frontend

### Task 32: Frontend types, API errors, API client and query hooks (TrueLayer)

Same file layout as the original Task 17. Differences:

- **Remove** `BankAspsp` type, `getAspsps(country)` API method, `useAspsps(enabled)` hook, and the `aspsps` query key.
- `connectBank(input)`'s input type becomes `{ startDate: string; connectionId?: string }` (no `aspspName`/`country`).
- `completeBankCallback(state)` — **drops the `code` parameter** entirely (was `completeBankCallback(code, state)`).
- `BankConnection` type drops `expiresInDays` (matches Task 30's `PublicConnection`).
- Everything else (`ApiError`, `TYPE_OPTIONS`, `categoryTypeFor`, `ConnectedAccount`, `InboxItem`, `InboxPage`, `SyncResult`, `SyncStatus`, `PendingSync`, and the inbox/sync/disconnect/connections hooks) is unchanged from the original Task 17.

Write this task's tests and implementation following the exact TDD process the original Task 17 used, with the fixtures above adjusted.

---

### Task 33: Pure UI helpers for banks and sync (TrueLayer)

Same file layout as the original Task 18. Differences:

- `consentLabel(connection: BankConnection): string | null` — since there is no `expiresInDays` to format, this function either returns `null` unconditionally (simplest: drop the concept, remove its call site in `ConnectionCard`) or is removed entirely along with its call site. **Recommendation: remove it** — write this task to delete `consentLabel` from both `app/lib/banks.ts` and wherever it's called (it wasn't called anywhere yet since Task 20 was never built, so this is a clean omission, not a removal from working code).
- `statusBadge(connection: BankConnection)` — unchanged logic (`ACTIVE`/`EXPIRED`/`ERROR` → badge colour/label), just no longer needs to consider `expiresInDays` for a "expiring soon" warning state if the original task had one (check the original Task 18's full text when implementing; if it did fold `expiresInDays` into the badge colour, drop that branch).
- Everything else (`earliestStartDate`, `lastSyncedAt`, `describeSyncAge`, `accountLabel`, `isSyncFinished`, `shouldPollSync`, `syncErrorMessage`, `SYNC_MAX_WAIT_MS`, `useSyncStatus`) is unchanged from the original Task 18.

Write this task's tests and implementation following the exact TDD process the original Task 18 used, with `consentLabel`-related tests removed and `statusBadge` tests adjusted if needed.

---

### Task 34: Bank callback route and Auth0 redirect fix (TrueLayer)

Same file layout as the original Task 19 (`app/lib/bankCallback.ts`,
`app/components/banks/BankCallback.tsx`, `app/routes/banks.callback.tsx`,
modifying `app/components/layout/DefaultLayout.tsx`). Substantial behaviour
change from the original task:

- `readBankCallback(search)` **no longer reads a `code` param** (unconfirmed item 5 — TrueLayer's actual redirect params are unknown). Redesign it to read only whatever error-indicating params TrueLayer might send, treating **absence of an error param as "assume success, go verify"** rather than requiring specific success params. Concretely: `{ kind: 'unknown' } | { kind: 'error'; message: string }` — drop the `success`/`invalid` variants tied to `code`/`state` presence, since `state` alone (stored in `sessionStorage` from before the redirect, not read from the URL) is enough context to call `completeBankCallback`.
- `stashBankCallback`/`readStashedBankCallback`/`clearStashedBankCallback` now stash just `{ state }` (no `code`) before the Auth0 redirect round-trip.
- `<BankCallback />`'s behaviour: on mount, read the stashed `state`, call `completeBankCallback(state)`. If the API returns 202 `{ status: 'PENDING' }` (per Task 30), **poll again after a short delay** (bounded retry count, similar in spirit to `shouldPollSync`/`SYNC_MAX_WAIT_MS` from Task 18/33) rather than treating "not ready yet" as failure. On 201, redirect to `/banks`. On a genuine error (4xx/timeout), show the error + Retry.
- `safeReturnTo` is unchanged.

Write this task's tests and implementation following the same TDD process and component structure the original Task 19 used, with the polling behaviour above replacing the original's single-shot code exchange.

---

### Task 35: Banks page (TrueLayer)

Same file layout as the original Task 20 (`app/components/banks/ConnectBankModal.tsx`,
`ConnectionCard.tsx`, `SyncNowButton.tsx`, `app/routes/banks.tsx`).
Substantial simplification from the original task:

- `<ConnectBankModal>` **loses its bank-search `Select`** entirely (no `useAspsps` dependency, since that hook no longer exists per Task 32). It becomes: a start-date `DateInput` (default today, max today, min `earliestStartDate(today)`) and a "Connect" button. Submitting calls `useConnectBank()` with `{ startDate, connectionId? }` and redirects the browser to the returned `url` (unchanged mechanism from the original design — `window.location = url`).
- `<ConnectionCard>` drops any consent-expiry display (`consentLabel` no longer exists per Task 33) — shows bank name, accounts, status badge, "Last synced", Reconnect, Disconnect.
- `<SyncNowButton>` is unchanged.

Write this task's tests and implementation following the same TDD process and component structure the original Task 20 used, with the bank-picker test cases removed and start-date-only submission tested instead.

---

## Verification (unchanged in structure from the original Task 23)

When all tasks above are complete, follow the original plan's Task 23
process (spec update, end-to-end verification, security review), but run
the manual verification checklist from the rewritten spec's Testing section
against the **TrueLayer sandbox**, not Enable Banking's. Record the
resolutions to every item in this plan's "Unconfirmed items" list in the
spec's Provider Change Log as part of that task, the same way the original
plan required recording Enable Banking's confirmed PSU header names and
response shapes.
