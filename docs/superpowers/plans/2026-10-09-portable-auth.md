# Portable Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a provider seam under authentication and add a built-in, single-account login (`AUTH_MODE=local`) for self-hosted instances, while the Auth0 deployment behaves exactly as today.

**Architecture:** `src/auth/` holds an `AuthProvider` interface with two implementations (`auth0.ts`, moved unchanged from `api-handler.ts`; `local.ts`, new), chosen at startup by `initAuth()` with a dynamic `import()` like `initStore()`. Local mode keeps its account, sessions and login throttle in the `Store` under an `AUTH#` partition. The browser holds only an `HttpOnly` cookie carrying a random session ID whose SHA-256 is the stored key. On the frontend, an app-owned `useAuth()` replaces direct `useAuth0()` use, and a runtime `/config.json` picks the provider.

**Tech Stack:** TypeScript, `node:crypto` (`scrypt`, `randomBytes`, `createHash`), the existing `Store`, React 19, Mantine 8, Vitest 4, Playwright (already a devDependency).

**Spec:** `docs/superpowers/specs/2026-10-09-portable-auth-design.md`

## Global Constraints

- **No new dependencies.** Hashing and sessions use `node:crypto`.
- Server code compiles under `tsc --module commonjs --target es2020 --strict` (the Lambda build) and as `"type": "module"` under Vitest. Use `import type` where only types are needed.
- Auth0 mode must behave identically: `src/api/__tests__/apiHandler.test.ts` keeps passing with **no changes to its assertions**. Its `authentication` tests are the parity proof for the move.
- **AUTH-06:** passwords, cookie values, session IDs and the setup code are never logged. The only exception is the setup code, logged once by `createLocalProvider` at startup.
- **IO-01:** validate every request body field at the boundary. Passwords are 12–128 characters, emails at most 254.
- Session `expiresAt` is **epoch seconds** (the `SqliteStore` TTL purge compares seconds). The purge runs hourly, so an expired row can still be read: `readSession` checks `expiresAt` itself.
- Cookie name `budget_session`; attributes `HttpOnly; SameSite=Strict; Path=/`, plus `Secure` unless `COOKIE_SECURE=false`.
- Local user IDs are `local|<uuid>` (the offline queue tags entries with `user.sub`, so it must stay a stable string).
- Commits: conventional, imperative, under 72 characters, each ending with `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Reference control IDs (e.g. `addresses AUTH-02`) where relevant.
- Do not push, merge or open PRs. The controller does that at finishing.

## Review Focus

The spec implies these inputs but no happy-path test would exercise them. Each has a test in the task that owns the code.

1. **An expired session row that the hourly purge hasn't removed yet** must be rejected, not accepted (Task 3).
2. **Cookie shapes:** API Gateway v2 gives `event.cookies: string[]`, a container adapter may give `headers.cookie`; values may contain `=`; a duplicate cookie name must not let a later one override (Task 4).
3. **`Origin` edge cases** on state-changing requests: absent, `null`, other host, same host with another port, `x-forwarded-host` behind a proxy (Task 4).
4. **Email and password normalisation:** login must match setup regardless of case/whitespace in the email; equivalent Unicode passwords (NFKC) must verify; a 10,000-character password must be refused without hashing (Tasks 2 and 5).
5. **Owner lock-out:** repeated failures must throttle login, and `store-cli reset-password` must clear the throttle as well as sessions, or the owner is locked out of the recovery path (Tasks 3 and 6).
6. **A garbage `/config.json`** (HTML from a SPA fallback, wrong `auth` value, missing Auth0 fields) must produce a clear error, never a guessed mode (Task 7).

## File Structure

| File | Responsibility |
|------|----------------|
| `src/auth/types.ts` | `AuthProvider`, `AuthResult` |
| `src/auth/index.ts` | `getAuth` / `setAuth` / `initAuth` registry |
| `src/auth/auth0.ts` | The existing Auth0 JWT verification, moved |
| `src/auth/password.ts` | scrypt hash/verify, password policy |
| `src/auth/localData.ts` | Account, session and throttle items in the `Store` |
| `src/auth/cookies.ts` | Cookie parse/format, `Origin` check |
| `src/auth/setupCode.ts` | The first-run setup code |
| `src/auth/routes.ts` | `/api/auth/*` handlers |
| `src/auth/local.ts` | `createLocalProvider` |
| `src/auth/prompt.ts` | Hidden password prompt for the CLI |
| `app/lib/runtimeConfig.ts` | `/config.json` loading and validation |
| `app/lib/auth.tsx` | `useAuth()` and `AuthState` |
| `app/lib/localAuth.ts` | Shared local-session store (survives per-route remounts) |
| `app/components/authentication/AuthProvider.tsx` | Config-driven provider choice |
| `app/components/authentication/LocalAuthProvider.tsx` | Local `AuthState` + modal |
| `app/components/authentication/LocalAuthForm.tsx` | Setup and login forms |

---

## PR group 1: server (Tasks 1–6)

### Task 1: Auth provider seam and the Auth0 provider

**Files:**
- Create: `src/auth/types.ts`, `src/auth/auth0.ts`, `src/auth/index.ts`, `src/auth/__tests__/index.test.ts`
- Modify: `api-handler.ts`, `src/api/types.ts`

**Interfaces:**
- Produces: `AuthProvider { authenticate(event): Promise<AuthResult>; handlePublic?(event): Promise<ApiResponse | undefined> }`, `AuthResult = { userId: string } | { rejection: ApiResponse }`, `getAuth()`, `setAuth(p | undefined)`, `initAuth(env?)`, `createAuth0Provider(env)`. `ApiResponse` gains `cookies?: string[]`.

- [ ] **Step 1: Write the failing test** `src/auth/__tests__/index.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn vitest run src/auth/__tests__/index.test.ts`
Expected: FAIL (cannot find module `..`).

- [ ] **Step 3: Implement**

`src/auth/types.ts`:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse } from '../api/types';

export type AuthResult = { userId: string } | { rejection: ApiResponse };

export interface AuthProvider {
  authenticate(event: APIGatewayProxyEventV2): Promise<AuthResult>;
  // Routes that need no session (local mode's login endpoints). Resolves to
  // undefined when the request is not one of them.
  handlePublic?(event: APIGatewayProxyEventV2): Promise<ApiResponse | undefined>;
}
```

In `src/api/types.ts`, add `cookies?: string[];` to `ApiResponse` (API Gateway v2 turns this array into `Set-Cookie` headers).

`src/auth/auth0.ts` (the logic moved verbatim from `api-handler.ts`, including its log lines and error bodies):

```ts
import { verify } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { SECURITY_HEADERS } from '../api/constants';
import type { ApiResponse } from '../api/types';
import type { AuthProvider } from './types';

function unauthorized(message = 'Unauthorized'): { rejection: ApiResponse } {
  return { rejection: { statusCode: 401, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) } };
}

export function createAuth0Provider(env: NodeJS.ProcessEnv): AuthProvider {
  const domain = env.AUTH0_DOMAIN || '';
  const audience = env.AUTH0_AUDIENCE || '';

  const jwks = jwksClient({
    cache: true,
    cacheMaxAge: 600000,
    jwksUri: `https://${domain}/.well-known/jwks.json`,
  });

  function getKey(header: any, callback: any) {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) callback(err);
      else callback(null, key?.getPublicKey());
    });
  }

  return {
    async authenticate(event) {
      const authHeader = event.headers?.authorization || '';
      const token = authHeader.replace('Bearer ', '');

      if (!token) {
        console.log('Auth failed: No token provided');
        return unauthorized('Missing authorization token');
      }

      try {
        const decoded: any = await new Promise((resolve, reject) => {
          verify(token, getKey, { audience, issuer: `https://${domain}/`, algorithms: ['RS256'] },
            (err, decoded) => err ? reject(err) : resolve(decoded),
          );
        });

        if (!decoded.sub || typeof decoded.sub !== 'string') {
          console.error('Auth failed: Invalid or missing sub claim');
          return unauthorized();
        }
        return { userId: decoded.sub };
      } catch (error) {
        console.error('Auth error:', error instanceof Error ? error.message : String(error));
        return unauthorized();
      }
    },
  };
}
```

`src/auth/index.ts`:

```ts
import type { AuthProvider } from './types';

export * from './types';

let current: AuthProvider | undefined;
let pending: Promise<AuthProvider> | undefined;

export function getAuth(): AuthProvider {
  if (!current) {
    throw new Error('Auth not initialised: call initAuth() at startup');
  }
  return current;
}

export function setAuth(provider: AuthProvider | undefined): void {
  current = provider;
  pending = undefined;
}

async function createAuth(env: NodeJS.ProcessEnv): Promise<AuthProvider> {
  const mode = env.AUTH_MODE || 'auth0';
  if (mode === 'auth0') {
    const { createAuth0Provider } = await import('./auth0');
    return createAuth0Provider(env);
  }
  throw new Error(`Unknown AUTH_MODE "${mode}": expected "auth0"`);
}

// Loads only the chosen provider, so the Lambda never loads the local-login code.
export function initAuth(env: NodeJS.ProcessEnv = process.env): Promise<AuthProvider> {
  if (current) return Promise.resolve(current);
  pending ??= createAuth(env).then(
    provider => {
      current = provider;
      return provider;
    },
    error => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}
```

(Task 5 adds the `local` branch and updates the error text.)

Now `api-handler.ts`: delete the `jsonwebtoken`/`jwks-rsa` imports, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `jwks`, `getKey`, the `ApiResponse` import and the whole `authenticate` function. Add `import { initAuth } from './src/auth';` and replace the handler body after the `console.log('Request:', …)` call with:

```ts
  // A failure inside a handler is the server's, not an authentication failure, so it is kept apart
  // from the 401s below and answered with a generic body; the detail goes to the logs only.
  try {
    const auth = await initAuth();
    const publicResponse = await auth.handlePublic?.(event);
    if (publicResponse) return publicResponse;

    const result = await auth.authenticate(event);
    if ('rejection' in result) return result.rejection;

    await initStore();
    return await router.dispatch(event, result.userId);
  } catch (error) {
    console.error(`Unhandled error in ${event.requestContext.routeKey}:`, error instanceof Error ? error.message : String(error));
    return { statusCode: 500, headers: SECURITY_HEADERS, body: INTERNAL_ERROR };
  }
```

- [ ] **Step 4: Run the new test and the parity suite**

Run: `yarn vitest run src/auth src/api/__tests__/apiHandler.test.ts && yarn typecheck`
Expected: PASS, with `apiHandler.test.ts` unmodified. If one of its tests fails, the move changed behaviour: fix the code, not the test.

- [ ] **Step 5: Check the Lambda compile flags**

Run: `npx tsc api-handler.ts --outDir /tmp/auth-compile-check --module commonjs --target es2020 --strict --esModuleInterop --skipLibCheck --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth api-handler.ts src/api/types.ts
git commit -m "refactor: move Auth0 verification behind an AuthProvider seam" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Password hashing and policy

**Files:**
- Create: `src/auth/password.ts`, `src/auth/__tests__/password.test.ts`

**Interfaces:**
- Produces: `PasswordRecord { passwordHash: string; salt: string; N: number; r: number; p: number }`, `MIN_PASSWORD_LENGTH = 12`, `MAX_PASSWORD_LENGTH = 128`, `hashPassword(password, params?)`, `verifyPassword(password, record)`, `dummyRecord()`, `validatePassword(value: unknown): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { dummyRecord, hashPassword, validatePassword, verifyPassword } from '../password';

const FAST = { N: 1024, r: 8, p: 1 };

describe('hashPassword / verifyPassword', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const record = await hashPassword('correct horse battery', FAST);
    expect(await verifyPassword('correct horse battery', record)).toBe(true);
    expect(await verifyPassword('correct horse batterz', record)).toBe(false);
  });

  it('salts every hash', async () => {
    const a = await hashPassword('same password here', FAST);
    const b = await hashPassword('same password here', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.passwordHash).not.toBe(b.passwordHash);
  });

  it('stores its parameters and verifies with the stored ones, not the defaults', async () => {
    const record = await hashPassword('parameters travel along', { N: 2048, r: 8, p: 1 });
    expect(record).toMatchObject({ N: 2048, r: 8, p: 1 });
    expect(await verifyPassword('parameters travel along', record)).toBe(true);
  });

  it('treats canonically equivalent Unicode passwords as the same', async () => {
    const record = await hashPassword('café au lait 123', FAST);
    expect(await verifyPassword('café au lait 123', record)).toBe(true);
  });

  it('uses the memory-conscious defaults when none are given', async () => {
    const record = await hashPassword('default parameters ok');
    expect(record).toMatchObject({ N: 32768, r: 8, p: 1 });
    expect(await verifyPassword('default parameters ok', record)).toBe(true);
  });

  it('never matches a tampered record', async () => {
    const record = await hashPassword('tamper evident pass', FAST);
    expect(await verifyPassword('tamper evident pass', { ...record, passwordHash: '00'.repeat(64) })).toBe(false);
    expect(await verifyPassword('tamper evident pass', { ...record, passwordHash: 'zz' })).toBe(false);
  });

  it('gives a dummy record that verifies nothing real', async () => {
    const dummy = await dummyRecord();
    expect(await verifyPassword('anything at all 123', dummy)).toBe(false);
  });
});

describe('validatePassword', () => {
  it.each([
    ['a non-string', 12345, /password/i],
    ['too short', 'x'.repeat(11), /at least 12/],
    ['too long', 'x'.repeat(129), /at most 128/],
  ])('rejects %s', (_label, value, message) => {
    expect(validatePassword(value)).toMatch(message);
  });

  it('accepts the boundaries', () => {
    expect(validatePassword('x'.repeat(12))).toBeNull();
    expect(validatePassword('x'.repeat(128))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn vitest run src/auth/__tests__/password.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/auth/password.ts`

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export interface PasswordRecord extends ScryptParams {
  passwordHash: string;
  salt: string;
}

// About 32 MB per hash, so a 256 MB container can still log in. The parameters are
// stored with every hash, so they can be raised later without invalidating accounts.
const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem is set above the default because N=2^15, r=8 needs exactly the 32 MB default.
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): Promise<PasswordRecord> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return { passwordHash: key.toString('hex'), salt: salt.toString('hex'), ...params };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const expected = Buffer.from(record.passwordHash, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(record.salt, 'hex'), record);
  return timingSafeEqual(actual, expected);
}

let dummy: Promise<PasswordRecord> | undefined;

// Verified against when no account matches, so a wrong email costs the same time as a wrong password.
export function dummyRecord(): Promise<PasswordRecord> {
  dummy ??= hashPassword(randomBytes(24).toString('hex'));
  return dummy;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'Password is required';
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (value.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}
```

- [ ] **Step 4: Run it** — `yarn vitest run src/auth/__tests__/password.test.ts && yarn typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/password.ts src/auth/__tests__/password.test.ts
git commit -m "feat: add scrypt password hashing for the built-in login" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Account, session and throttle data

**Files:**
- Create: `src/auth/localData.ts`, `src/auth/__tests__/localData.test.ts`

**Interfaces:**
- Consumes: `Store`, `ConditionFailedError` from `../store`; `hashPassword`, `PasswordRecord` from `./password`; `useTestStore`/`resetTestStore` from `../store/testing`.
- Produces: `Account`, `SESSION_LIFETIME_SECONDS`, `hashToken`, `getAccount`, `createAccount(store, email, password, nowMs?)`, `replacePassword`, `createSession(store, userId, nowSeconds)`, `readSession(store, token, nowSeconds)`, `deleteSession`, `deleteAllSessions`, `throttleRemaining`, `recordFailure`, `clearThrottle`, `normaliseEmail`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConditionFailedError } from '../../store';
import { resetTestStore, useTestStore } from '../../store/testing';
import type { SqliteStore } from '../../store/sqlite';
import { verifyPassword } from '../password';
import {
  SESSION_LIFETIME_SECONDS, clearThrottle, createAccount, createSession, deleteAllSessions, deleteSession,
  getAccount, hashToken, normaliseEmail, readSession, recordFailure, replacePassword, throttleRemaining,
} from '../localData';

let store: SqliteStore;
const NOW = 1_800_000_000;

beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

describe('account', () => {
  it('creates exactly one account and refuses a second', async () => {
    const account = await createAccount(store, '  Me@Example.com ', 'a long enough password');
    expect(account.email).toBe('me@example.com');
    expect(account.userId).toMatch(/^local\|[0-9a-f-]{36}$/);
    await expect(createAccount(store, 'other@example.com', 'another long password')).rejects.toBeInstanceOf(ConditionFailedError);
    expect((await getAccount(store))?.email).toBe('me@example.com');
  });

  it('stores a hash, never the password', async () => {
    await createAccount(store, 'me@example.com', 'a long enough password');
    const stored = JSON.stringify(await store.get({ PK: 'AUTH#ACCOUNT', SK: 'PROFILE' }));
    expect(stored).not.toContain('a long enough password');
  });

  it('replaces the password', async () => {
    await createAccount(store, 'me@example.com', 'the first password');
    await replacePassword(store, 'the second password');
    const account = await getAccount(store);
    expect(await verifyPassword('the second password', account!)).toBe(true);
    expect(await verifyPassword('the first password', account!)).toBe(false);
  });

  it('normalises emails the same way everywhere', () => {
    expect(normaliseEmail('  A@B.Com ')).toBe('a@b.com');
  });
});

describe('sessions', () => {
  it('keeps only the hash of the token', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    const rows = await store.query('AUTH#SESSIONS');
    expect(rows).toHaveLength(1);
    expect(rows[0].SK).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('reads a live session and rejects unknown, empty and expired tokens', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    expect(await readSession(store, token, NOW + 10)).toEqual({ userId: 'local|u1' });
    expect(await readSession(store, 'not-a-token', NOW)).toBeUndefined();
    expect(await readSession(store, undefined, NOW)).toBeUndefined();
    expect(await readSession(store, token, NOW + SESSION_LIFETIME_SECONDS)).toBeUndefined();
  });

  it('rejects an expired session even though the purge has not removed the row', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    expect(await store.get({ PK: 'AUTH#SESSIONS', SK: hashToken(token) })).toBeDefined();
    expect(await readSession(store, token, NOW + SESSION_LIFETIME_SECONDS + 1)).toBeUndefined();
  });

  it('extends a session only once half its lifetime has passed', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    const key = { PK: 'AUTH#SESSIONS', SK: hashToken(token) };
    const original = (await store.get(key))!.expiresAt;

    await readSession(store, token, NOW + 60);
    expect((await store.get(key))!.expiresAt).toBe(original);

    const later = NOW + Math.ceil(SESSION_LIFETIME_SECONDS * 0.6);
    await readSession(store, token, later);
    expect((await store.get(key))!.expiresAt).toBe(later + SESSION_LIFETIME_SECONDS);
  });

  it('deletes one session, or all of them', async () => {
    const a = await createSession(store, 'local|u1', NOW);
    const b = await createSession(store, 'local|u1', NOW);
    await deleteSession(store, a);
    expect(await readSession(store, a, NOW)).toBeUndefined();
    expect(await readSession(store, b, NOW)).toBeDefined();
    await deleteAllSessions(store);
    expect(await readSession(store, b, NOW)).toBeUndefined();
  });

  it('treats a session deleted mid-read as signed out', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    const racing = {
      ...store,
      get: async (key: Parameters<typeof store.get>[0]) => {
        const item = await store.get(key);
        await store.delete(key);
        return item;
      },
      patch: store.patch.bind(store),
    } as unknown as SqliteStore;
    expect(await readSession(racing, token, NOW + Math.ceil(SESSION_LIFETIME_SECONDS * 0.6))).toBeUndefined();
  });
});

describe('login throttle', () => {
  it('allows a few failures, then backs off exponentially up to a cap', async () => {
    expect(await throttleRemaining(store, NOW)).toBe(0);
    for (let i = 0; i < 3; i++) await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(0);
    await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(1);
    await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(2);
    for (let i = 0; i < 30; i++) await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(15 * 60);
    expect(await throttleRemaining(store, NOW + 15 * 60)).toBe(0);
  });

  it('clears on success', async () => {
    for (let i = 0; i < 6; i++) await recordFailure(store, NOW);
    await clearThrottle(store);
    expect(await throttleRemaining(store, NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `yarn vitest run src/auth/__tests__/localData.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/auth/localData.ts`

```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConditionFailedError } from '../store';
import type { Item, Store } from '../store';
import { hashPassword } from './password';
import type { PasswordRecord } from './password';

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const ACCOUNT_KEY = { PK: 'AUTH#ACCOUNT', SK: 'PROFILE' } as const;
const THROTTLE_KEY = { PK: 'AUTH#THROTTLE', SK: 'LOGIN' } as const;
// One shared partition, because Store.query lists a single partition and a password reset must find every session.
const SESSIONS_PK = 'AUTH#SESSIONS';

const FREE_ATTEMPTS = 3;
const MAX_DELAY_SECONDS = 15 * 60;

export interface Account extends PasswordRecord {
  userId: string;
  email: string;
  createdAt: string;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function getAccount(store: Store): Promise<Account | undefined> {
  const item = await store.get(ACCOUNT_KEY);
  return item ? (item as unknown as Account) : undefined;
}

// Throws ConditionFailedError when an account already exists, which is what closes setup for good.
export async function createAccount(store: Store, email: string, password: string, nowMs: number = Date.now()): Promise<Account> {
  const record = await hashPassword(password);
  const account: Account = {
    userId: `local|${randomUUID()}`,
    email: normaliseEmail(email),
    ...record,
    createdAt: new Date(nowMs).toISOString(),
  };
  await store.put({ ...ACCOUNT_KEY, ...account }, { ifAbsent: true });
  return account;
}

export async function replacePassword(store: Store, password: string): Promise<void> {
  const record = await hashPassword(password);
  await store.patch(ACCOUNT_KEY, { ...record }, { mustExist: true });
}

function sessionKey(token: string) {
  return { PK: SESSIONS_PK, SK: hashToken(token) };
}

export async function createSession(store: Store, userId: string, nowSeconds: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await store.put({
    ...sessionKey(token),
    userId,
    createdAt: nowSeconds,
    expiresAt: nowSeconds + SESSION_LIFETIME_SECONDS,
  });
  return token;
}

export async function readSession(store: Store, token: string | undefined, nowSeconds: number): Promise<{ userId: string } | undefined> {
  if (!token) return undefined;
  const key = sessionKey(token);
  const item = await store.get(key);
  if (!item) return undefined;

  // The TTL purge is hourly, so a row past its expiry can still be read: check it here.
  const expiresAt = Number(item.expiresAt);
  if (!(expiresAt > nowSeconds)) return undefined;

  // Slide the expiry only once half the lifetime has gone, so most requests cost no write.
  if (expiresAt - nowSeconds < SESSION_LIFETIME_SECONDS / 2) {
    try {
      await store.patch(key, { expiresAt: nowSeconds + SESSION_LIFETIME_SECONDS }, { mustExist: true });
    } catch (error) {
      if (error instanceof ConditionFailedError) return undefined; // logged out while this request was in flight
      throw error;
    }
  }
  return { userId: String(item.userId) };
}

export async function deleteSession(store: Store, token: string | undefined): Promise<void> {
  if (!token) return;
  await store.delete(sessionKey(token));
}

export async function deleteAllSessions(store: Store): Promise<void> {
  const sessions: Item[] = await store.query(SESSIONS_PK);
  for (const { PK, SK } of sessions) {
    await store.delete({ PK, SK });
  }
}

export async function throttleRemaining(store: Store, nowSeconds: number): Promise<number> {
  const item = await store.get(THROTTLE_KEY);
  if (!item) return 0;
  return Math.max(0, Number(item.nextAllowedAt) - nowSeconds);
}

// One account means one throttle. Two simultaneous failures can lose a count, which only makes an attacker's life slightly easier.
export async function recordFailure(store: Store, nowSeconds: number): Promise<void> {
  const item = await store.get(THROTTLE_KEY);
  const failures = (Number(item?.failures) || 0) + 1;
  const delay = failures <= FREE_ATTEMPTS ? 0 : Math.min(MAX_DELAY_SECONDS, 2 ** (failures - FREE_ATTEMPTS - 1));
  await store.put({ ...THROTTLE_KEY, failures, nextAllowedAt: nowSeconds + delay });
}

export async function clearThrottle(store: Store): Promise<void> {
  await store.delete(THROTTLE_KEY);
}
```

- [ ] **Step 4: Run it** — `yarn vitest run src/auth/__tests__/localData.test.ts && yarn typecheck`. Expected: PASS. If the "mid-read" test is awkward under the real `SqliteStore` typings, keep its intent (a `patch` after the row vanished yields `undefined`, not a throw) and adjust only the harness.

- [ ] **Step 5: Commit**

```bash
git add src/auth/localData.ts src/auth/__tests__/localData.test.ts
git commit -m "feat: store local accounts, sessions and login throttle" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cookies and the Origin check

**Files:**
- Create: `src/auth/cookies.ts`, `src/auth/__tests__/cookies.test.ts`

**Interfaces:**
- Produces: `COOKIE_NAME = 'budget_session'`, `readSessionCookie(event): string | undefined`, `sessionCookie(token, secure)`, `clearedCookie(secure)`, `originAllowed(event): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { clearedCookie, originAllowed, readSessionCookie, sessionCookie } from '../cookies';
import { SESSION_LIFETIME_SECONDS } from '../localData';

function event(over: { method?: string; headers?: Record<string, string>; cookies?: string[] } = {}): APIGatewayProxyEventV2 {
  return {
    headers: over.headers ?? {},
    cookies: over.cookies,
    requestContext: { http: { method: over.method ?? 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('readSessionCookie', () => {
  it('reads the API Gateway cookies array', () => {
    expect(readSessionCookie(event({ cookies: ['theme=dark', 'budget_session=abc'] }))).toBe('abc');
  });

  it('reads a Cookie header when there is no cookies array', () => {
    expect(readSessionCookie(event({ headers: { cookie: 'a=1; budget_session=xyz; b=2' } }))).toBe('xyz');
  });

  it('keeps an = inside the value', () => {
    expect(readSessionCookie(event({ cookies: ['budget_session=ab=cd'] }))).toBe('ab=cd');
  });

  it('uses the first of duplicate cookies, so a later one cannot override it', () => {
    expect(readSessionCookie(event({ cookies: ['budget_session=first', 'budget_session=second'] }))).toBe('first');
  });

  it('is undefined with no cookie, an empty value, or a lookalike name', () => {
    expect(readSessionCookie(event())).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['budget_session='] }))).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['xbudget_session=abc'] }))).toBeUndefined();
  });
});

describe('cookie formatting', () => {
  it('sets HttpOnly, SameSite=Strict, Path=/ and a 30-day Max-Age', () => {
    const cookie = sessionCookie('tok', true);
    expect(cookie).toContain('budget_session=tok');
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Secure', `Max-Age=${SESSION_LIFETIME_SECONDS}`]) {
      expect(cookie).toContain(part);
    }
  });

  it('omits Secure only when asked to', () => {
    expect(sessionCookie('tok', false)).not.toContain('Secure');
  });

  it('clears with Max-Age=0', () => {
    expect(clearedCookie(true)).toContain('Max-Age=0');
    expect(clearedCookie(true)).toContain('budget_session=;');
  });
});

describe('originAllowed', () => {
  const host = { host: 'budget.example.com' };

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not ask %s requests for an Origin', method => {
    expect(originAllowed(event({ method, headers: host }))).toBe(true);
  });

  it('accepts a state-changing request from the same host', () => {
    expect(originAllowed(event({ method: 'POST', headers: { ...host, origin: 'https://budget.example.com' } }))).toBe(true);
  });

  it.each([
    ['no Origin', {}],
    ['a null Origin', { origin: 'null' }],
    ['another host', { origin: 'https://evil.example.com' }],
    ['the same host on another port', { origin: 'https://budget.example.com:8443' }],
    ['an unparseable Origin', { origin: 'not a url' }],
  ])('refuses a POST with %s', (_label, extra) => {
    expect(originAllowed(event({ method: 'POST', headers: { ...host, ...extra } }))).toBe(false);
  });

  it('refuses when there is no host to compare with', () => {
    expect(originAllowed(event({ method: 'POST', headers: { origin: 'https://budget.example.com' } }))).toBe(false);
  });

  it('prefers x-forwarded-host behind a proxy', () => {
    const headers = { host: 'internal:3000', 'x-forwarded-host': 'budget.example.com', origin: 'https://budget.example.com' };
    expect(originAllowed(event({ method: 'DELETE', headers }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `yarn vitest run src/auth/__tests__/cookies.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/auth/cookies.ts`

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SESSION_LIFETIME_SECONDS } from './localData';

export const COOKIE_NAME = 'budget_session';

export function readSessionCookie(event: APIGatewayProxyEventV2): string | undefined {
  // API Gateway v2 hands cookies over as an array; a container adapter may only have the header.
  const raw = event.cookies?.join('; ') ?? event.headers?.cookie ?? '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) !== COOKIE_NAME) continue;
    const value = trimmed.slice(separator + 1);
    return value === '' ? undefined : value;
  }
  return undefined;
}

function attributes(secure: boolean, maxAge: number): string {
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; ${attributes(secure, SESSION_LIFETIME_SECONDS)}`;
}

export function clearedCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; ${attributes(secure, 0)}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defence in depth beside SameSite=Strict: a state-changing request must name our own host as its Origin.
// The scheme is not compared, because behind a TLS-terminating proxy it can legitimately differ.
export function originAllowed(event: APIGatewayProxyEventV2): boolean {
  if (SAFE_METHODS.has(event.requestContext.http.method.toUpperCase())) return true;

  const origin = event.headers?.origin;
  const host = (event.headers?.['x-forwarded-host'] ?? event.headers?.host)?.split(',')[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run it** — `yarn vitest run src/auth/__tests__/cookies.test.ts && yarn typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/cookies.ts src/auth/__tests__/cookies.test.ts
git commit -m "feat: add session cookie handling and an Origin check" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Setup code, auth routes and the local provider

**Files:**
- Create: `src/auth/setupCode.ts`, `src/auth/routes.ts`, `src/auth/local.ts`, `src/auth/__tests__/routes.test.ts`, `src/auth/__tests__/local.test.ts`
- Modify: `src/auth/index.ts`, `src/auth/__tests__/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `ok`, `err`, `parseJsonObject` from `../api/http`; `SECURITY_HEADERS`.
- Produces: `SetupCode` (`generate()`, `reveal()`, `matches(candidate)`, `clear()`), `AuthRouteContext { store; setupCode?; secureCookie; nowSeconds() }`, `handleAuthRoute(event, ctx)`, `createLocalProvider(env)`.

- [ ] **Step 1: Write the failing tests**

`src/auth/__tests__/routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { resetTestStore, useTestStore } from '../../store/testing';
import type { SqliteStore } from '../../store/sqlite';
import { handleAuthRoute } from '../routes';
import type { AuthRouteContext } from '../routes';
import { SetupCode } from '../setupCode';
import { createAccount, hashToken, getAccount } from '../localData';

const PASSWORD = 'a perfectly fine password';
let store: SqliteStore;
let setupCode: SetupCode;
let now: number;
let ctx: AuthRouteContext;

function post(path: string, body: unknown, over: { cookie?: string; origin?: string | null } = {}): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = { host: 'budget.example.com' };
  if (over.origin !== null) headers.origin = over.origin ?? 'https://budget.example.com';
  return {
    rawPath: path,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
    cookies: over.cookie ? [over.cookie] : undefined,
    requestContext: { routeKey: `POST ${path}`, http: { method: 'POST', sourceIp: '203.0.113.9' } },
  } as unknown as APIGatewayProxyEventV2;
}

function get(path: string, cookie?: string): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    headers: { host: 'budget.example.com' },
    cookies: cookie ? [cookie] : undefined,
    requestContext: { routeKey: `GET ${path}`, http: { method: 'GET', sourceIp: '203.0.113.9' } },
  } as unknown as APIGatewayProxyEventV2;
}

function cookieValue(res: { cookies?: string[] } | undefined): string {
  return (res?.cookies?.[0] ?? '').split(';')[0];
}

beforeEach(() => {
  store = useTestStore();
  setupCode = SetupCode.generate();
  now = 1_800_000_000;
  ctx = { store, setupCode, secureCookie: true, nowSeconds: () => now };
});
afterEach(() => {
  resetTestStore();
  vi.restoreAllMocks();
});

const setupBody = (over: Record<string, unknown> = {}) => ({ code: setupCode.reveal(), email: 'Me@Example.com', password: PASSWORD, ...over });

describe('routes that do not belong to auth', () => {
  it('returns undefined, so the normal pipeline handles them', async () => {
    expect(await handleAuthRoute(get('/api/categories'), ctx)).toBeUndefined();
    expect(await handleAuthRoute(get('/api/auth/nope'), ctx)).toBeUndefined();
  });
});

describe('GET /api/auth/status', () => {
  it('says setup is required until an account exists', async () => {
    expect(JSON.parse((await handleAuthRoute(get('/api/auth/status'), ctx))!.body)).toEqual({ setupRequired: true });
    await createAccount(store, 'me@example.com', PASSWORD);
    expect(JSON.parse((await handleAuthRoute(get('/api/auth/status'), ctx))!.body)).toEqual({ setupRequired: false });
  });
});

describe('POST /api/auth/setup', () => {
  it('creates the account, starts a session and sets a hardened cookie', async () => {
    const res = (await handleAuthRoute(post('/api/auth/setup', setupBody()), ctx))!;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ email: 'me@example.com' });
    expect(res.cookies![0]).toMatch(/HttpOnly.*SameSite=Strict/);
    expect((await getAccount(store))?.email).toBe('me@example.com');
  });

  it('refuses a wrong code and creates nothing', async () => {
    const res = (await handleAuthRoute(post('/api/auth/setup', setupBody({ code: 'wrong' })), ctx))!;
    expect(res.statusCode).toBe(403);
    expect(await getAccount(store)).toBeUndefined();
  });

  it('is closed for good once an account exists', async () => {
    await handleAuthRoute(post('/api/auth/setup', setupBody()), ctx);
    const again = (await handleAuthRoute(post('/api/auth/setup', setupBody({ email: 'x@example.com' })), ctx))!;
    expect(again.statusCode).toBe(409);
    expect((await getAccount(store))?.email).toBe('me@example.com');
  });

  it('makes exactly one account when two setups race', async () => {
    const [a, b] = await Promise.all([
      handleAuthRoute(post('/api/auth/setup', setupBody({ email: 'a@example.com' })), ctx),
      handleAuthRoute(post('/api/auth/setup', setupBody({ email: 'b@example.com' })), ctx),
    ]);
    expect([a!.statusCode, b!.statusCode].sort()).toEqual([200, 409]);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a 10,000-character password', { password: 'x'.repeat(10_000) }],
    ['a missing email', { email: undefined }],
    ['an invalid email', { email: 'not-an-email' }],
    ['a 300-character email', { email: `${'a'.repeat(300)}@example.com` }],
  ])('rejects %s with 400 and creates nothing', async (_label, over) => {
    const res = (await handleAuthRoute(post('/api/auth/setup', setupBody(over)), ctx))!;
    expect(res.statusCode).toBe(400);
    expect(await getAccount(store)).toBeUndefined();
  });

  it('rejects a body that is not a JSON object', async () => {
    expect((await handleAuthRoute(post('/api/auth/setup', '[1,2]'), ctx))!.statusCode).toBe(400);
    expect((await handleAuthRoute(post('/api/auth/setup', '{oops'), ctx))!.statusCode).toBe(400);
  });

  it('refuses a request from another origin, or with none', async () => {
    expect((await handleAuthRoute(post('/api/auth/setup', setupBody(), { origin: 'https://evil.example.com' }), ctx))!.statusCode).toBe(403);
    expect((await handleAuthRoute(post('/api/auth/setup', setupBody(), { origin: null }), ctx))!.statusCode).toBe(403);
    expect(await getAccount(store)).toBeUndefined();
  });

  it('discards the setup code after use', async () => {
    const code = setupCode.reveal();
    await handleAuthRoute(post('/api/auth/setup', setupBody()), ctx);
    expect(setupCode.matches(code)).toBe(false);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await createAccount(store, 'me@example.com', PASSWORD);
  });

  it('signs in with the right credentials, whatever the email case or spacing', async () => {
    const res = (await handleAuthRoute(post('/api/auth/login', { email: '  ME@example.com ', password: PASSWORD }), ctx))!;
    expect(res.statusCode).toBe(200);
    expect(cookieValue(res)).toMatch(/^budget_session=.+/);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = (await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: 'not the password' }), ctx))!;
    const wrongEmail = (await handleAuthRoute(post('/api/auth/login', { email: 'who@example.com', password: PASSWORD }), ctx))!;
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongEmail.statusCode).toBe(401);
    expect(wrongPassword.body).toBe(wrongEmail.body);
    expect(wrongPassword.cookies).toBeUndefined();
  });

  it('refuses an over-long password without hashing it', async () => {
    const res = (await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: 'x'.repeat(10_000) }), ctx))!;
    expect(res.statusCode).toBe(401);
  });

  it('throttles after repeated failures, even for the right password, then recovers', async () => {
    for (let i = 0; i < 4; i++) {
      await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: 'wrong wrong wrong' }), ctx);
    }
    const blocked = (await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: PASSWORD }), ctx))!;
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['Retry-After']).toBe('1');

    now += 1;
    const recovered = (await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: PASSWORD }), ctx))!;
    expect(recovered.statusCode).toBe(200);
  });

  it('refuses a request from another origin', async () => {
    const res = (await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: PASSWORD }, { origin: 'https://evil.example.com' }), ctx))!;
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  async function signIn(): Promise<string> {
    await createAccount(store, 'me@example.com', PASSWORD);
    const res = await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: PASSWORD }), ctx);
    return cookieValue(res);
  }

  it('says who is signed in', async () => {
    const cookie = await signIn();
    const res = (await handleAuthRoute(get('/api/auth/me', cookie), ctx))!;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ email: 'me@example.com', userId: expect.stringMatching(/^local\|/) });
  });

  it('answers 401 with no cookie or an unknown one', async () => {
    await signIn();
    expect((await handleAuthRoute(get('/api/auth/me'), ctx))!.statusCode).toBe(401);
    expect((await handleAuthRoute(get('/api/auth/me', 'budget_session=bogus'), ctx))!.statusCode).toBe(401);
  });

  it('ends the session on logout and clears the cookie', async () => {
    const cookie = await signIn();
    const out = (await handleAuthRoute(post('/api/auth/logout', {}, { cookie }), ctx))!;
    expect(out.cookies![0]).toContain('Max-Age=0');
    expect((await handleAuthRoute(get('/api/auth/me', cookie), ctx))!.statusCode).toBe(401);
  });

  it('keeps the session when logout comes from another origin', async () => {
    const cookie = await signIn();
    const res = (await handleAuthRoute(post('/api/auth/logout', {}, { cookie, origin: 'https://evil.example.com' }), ctx))!;
    expect(res.statusCode).toBe(403);
    expect((await handleAuthRoute(get('/api/auth/me', cookie), ctx))!.statusCode).toBe(200);
  });

  it('answers 401 once the session has expired', async () => {
    const cookie = await signIn();
    now += 31 * 24 * 60 * 60;
    expect((await handleAuthRoute(get('/api/auth/me', cookie), ctx))!.statusCode).toBe(401);
  });
});

describe('what reaches the logs and the database', () => {
  it('never logs the password, the cookie or the setup code', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}));
    const secretPassword = 'the-secret-password-123';
    const setup = (await handleAuthRoute(post('/api/auth/setup', setupBody({ password: secretPassword })), ctx))!;
    await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: 'wrong wrong wrong' }), ctx);
    await handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password: secretPassword }), ctx);

    const logged = JSON.stringify(spies.flatMap(spy => spy.mock.calls));
    expect(logged).not.toContain(secretPassword);
    expect(logged).not.toContain(cookieValue(setup).split('=')[1]);
  });

  it('stores only the hash of the cookie value', async () => {
    const res = (await handleAuthRoute(post('/api/auth/setup', setupBody()), ctx))!;
    const token = cookieValue(res).split('=')[1];
    const rows = await store.query('AUTH#SESSIONS');
    expect(rows.map(row => row.SK)).toContain(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});
```

`src/auth/__tests__/local.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { resetTestStore, useTestStore } from '../../store/testing';
import type { SqliteStore } from '../../store/sqlite';
import { createAccount, createSession } from '../localData';
import { createLocalProvider } from '../local';
import { initAuth, setAuth } from '..';

let store: SqliteStore;
const now = () => Math.floor(Date.now() / 1000);

function event(over: { method?: string; cookie?: string; origin?: string } = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: '/api/categories',
    headers: { host: 'budget.example.com', ...(over.origin ? { origin: over.origin } : {}) },
    cookies: over.cookie ? [over.cookie] : undefined,
    requestContext: { routeKey: 'GET /x', http: { method: over.method ?? 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => { store = useTestStore(); });
afterEach(() => {
  resetTestStore();
  setAuth(undefined);
  vi.restoreAllMocks();
});

describe('createLocalProvider', () => {
  it('logs the setup code exactly once when there is no account, and never when there is', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createLocalProvider({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/setup code/i);

    log.mockClear();
    await createAccount(store, 'me@example.com', 'a long enough password');
    await createLocalProvider({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(log).not.toHaveBeenCalled();
  });

  it('authenticates a live session cookie', async () => {
    const provider = await createLocalProvider({});
    const token = await createSession(store, 'local|u1', now());
    expect(await provider.authenticate(event({ cookie: `budget_session=${token}` }))).toEqual({ userId: 'local|u1' });
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown cookie', 'budget_session=bogus'],
  ])('answers 401 for %s', async (_label, cookie) => {
    const provider = await createLocalProvider({});
    const result = await provider.authenticate(event({ cookie }));
    expect('rejection' in result && result.rejection.statusCode).toBe(401);
  });

  it('answers 403 for a state-changing request from another origin, even with a valid cookie', async () => {
    const provider = await createLocalProvider({});
    const token = await createSession(store, 'local|u1', now());
    const result = await provider.authenticate(event({ method: 'DELETE', cookie: `budget_session=${token}`, origin: 'https://evil.example.com' }));
    expect('rejection' in result && result.rejection.statusCode).toBe(403);
  });

  it('is what initAuth loads for AUTH_MODE=local', async () => {
    const provider = await initAuth({ AUTH_MODE: 'local' });
    expect(typeof provider.handlePublic).toBe('function');
  });
});
```

Also in `src/auth/__tests__/index.test.ts`, change the unknown-mode assertion to `/expected "auth0" or "local"/`.

- [ ] **Step 2: Run them to see them fail** — `yarn vitest run src/auth` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/auth/setupCode.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Lives in memory only. It is logged once at start-up and discarded when the account is created.
export class SetupCode {
  private code: string | undefined;

  private constructor(code: string) {
    this.code = code;
  }

  static generate(): SetupCode {
    return new SetupCode(randomBytes(9).toString('base64url'));
  }

  reveal(): string {
    if (this.code === undefined) throw new Error('The setup code has been used');
    return this.code;
  }

  matches(candidate: string): boolean {
    if (this.code === undefined) return false;
    return timingSafeEqual(digest(candidate), digest(this.code));
  }

  clear(): void {
    this.code = undefined;
  }
}
```

`src/auth/routes.ts`:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SECURITY_HEADERS } from '../api/constants';
import { err, ok, parseJsonObject } from '../api/http';
import type { ApiResponse } from '../api/types';
import { ConditionFailedError } from '../store';
import type { Store } from '../store';
import { clearedCookie, originAllowed, readSessionCookie, sessionCookie } from './cookies';
import {
  clearThrottle, createAccount, createSession, deleteSession, getAccount, normaliseEmail,
  readSession, recordFailure, throttleRemaining,
} from './localData';
import { MAX_PASSWORD_LENGTH, dummyRecord, validatePassword, verifyPassword } from './password';
import type { SetupCode } from './setupCode';

export interface AuthRouteContext {
  store: Store;
  setupCode: SetupCode | undefined;
  secureCookie: boolean;
  nowSeconds(): number;
}

const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

function withCookie(response: ApiResponse, cookie: string): ApiResponse {
  return { ...response, headers: { ...response.headers, ...NO_STORE }, cookies: [cookie] };
}

function noStore(response: ApiResponse): ApiResponse {
  return { ...response, headers: { ...response.headers, ...NO_STORE } };
}

async function status(ctx: AuthRouteContext): Promise<ApiResponse> {
  return noStore(ok({ setupRequired: (await getAccount(ctx.store)) === undefined }));
}

async function setup(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Request body must be a JSON object');

  if (await getAccount(ctx.store)) return err(409, 'This instance is already set up');
  if (typeof body.code !== 'string' || !ctx.setupCode?.matches(body.code)) return err(403, 'Invalid setup code');

  const { email, password } = body;
  if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email.trim())) {
    return err(400, 'A valid email address is required');
  }
  const passwordProblem = validatePassword(password);
  if (passwordProblem) return err(400, passwordProblem);

  try {
    const account = await createAccount(ctx.store, email, password as string);
    ctx.setupCode.clear();
    const token = await createSession(ctx.store, account.userId, ctx.nowSeconds());
    return withCookie(ok({ userId: account.userId, email: account.email }), sessionCookie(token, ctx.secureCookie));
  } catch (error) {
    if (error instanceof ConditionFailedError) return err(409, 'This instance is already set up');
    throw error;
  }
}

async function login(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Request body must be a JSON object');
  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') return err(400, 'Email and password are required');

  const now = ctx.nowSeconds();
  const wait = await throttleRemaining(ctx.store, now);
  if (wait > 0) {
    const limited = err(429, 'Too many attempts. Try again shortly.', { retryAfter: wait });
    return noStore({ ...limited, headers: { ...limited.headers, 'Retry-After': String(wait) } });
  }

  const invalid = async (): Promise<ApiResponse> => {
    await recordFailure(ctx.store, now);
    return noStore(err(401, 'Invalid email or password'));
  };

  // Bound the hashing cost before spending any of it.
  if (password.length > MAX_PASSWORD_LENGTH) return invalid();

  const account = await getAccount(ctx.store);
  // Always verify against some record, so an unknown email takes as long as a wrong password.
  const passwordMatches = await verifyPassword(password, account ?? (await dummyRecord()));
  if (!account || normaliseEmail(email) !== account.email || !passwordMatches) return invalid();

  await clearThrottle(ctx.store);
  const token = await createSession(ctx.store, account.userId, now);
  return withCookie(ok({ userId: account.userId, email: account.email }), sessionCookie(token, ctx.secureCookie));
}

async function logout(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  await deleteSession(ctx.store, readSessionCookie(event));
  return withCookie(ok({}), clearedCookie(ctx.secureCookie));
}

async function me(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const session = await readSession(ctx.store, readSessionCookie(event), ctx.nowSeconds());
  const account = session ? await getAccount(ctx.store) : undefined;
  if (!session || !account) return noStore(err(401, 'Unauthorized'));
  return noStore(ok({ userId: session.userId, email: account.email }));
}

// A Map, not an object literal: a path like "/constructor" must not resolve to an inherited property.
const POST_ROUTES = new Map<string, (event: APIGatewayProxyEventV2, ctx: AuthRouteContext) => Promise<ApiResponse>>([
  ['/api/auth/setup', setup],
  ['/api/auth/login', login],
  ['/api/auth/logout', logout],
]);

const FORBIDDEN: ApiResponse = { statusCode: 403, headers: SECURITY_HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };

// These are the only routes that answer without a session (the AUTH-05 exceptions).
export async function handleAuthRoute(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse | undefined> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method === 'GET' && path === '/api/auth/status') return status(ctx);
  if (method === 'GET' && path === '/api/auth/me') return me(event, ctx);

  const handler = method === 'POST' ? POST_ROUTES.get(path) : undefined;
  if (!handler) return undefined;

  if (!originAllowed(event)) return FORBIDDEN;
  return handler(event, ctx);
}
```

`src/auth/local.ts`:

```ts
import { err } from '../api/http';
import { initStore } from '../store';
import { originAllowed, readSessionCookie } from './cookies';
import { getAccount, readSession } from './localData';
import { handleAuthRoute } from './routes';
import type { AuthRouteContext } from './routes';
import { SetupCode } from './setupCode';
import type { AuthProvider } from './types';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export async function createLocalProvider(env: NodeJS.ProcessEnv): Promise<AuthProvider> {
  const store = await initStore(env);

  // The one place a secret is logged, and only so the person who deployed the instance can read it.
  const setupCode = (await getAccount(store)) ? undefined : SetupCode.generate();
  if (setupCode) {
    console.log(`First-run setup: open the app and enter this setup code to create your account: ${setupCode.reveal()}`);
  }

  const ctx: AuthRouteContext = { store, setupCode, secureCookie: env.COOKIE_SECURE !== 'false', nowSeconds };

  return {
    handlePublic: event => handleAuthRoute(event, ctx),

    async authenticate(event) {
      if (!originAllowed(event)) return { rejection: err(403, 'Forbidden') };
      const session = await readSession(store, readSessionCookie(event), nowSeconds());
      if (!session) return { rejection: err(401, 'Unauthorized') };
      return { userId: session.userId };
    },
  };
}
```

In `src/auth/index.ts`, add after the `auth0` branch:

```ts
  if (mode === 'local') {
    const { createLocalProvider } = await import('./local');
    return createLocalProvider(env);
  }
```

and change the final error to `` `Unknown AUTH_MODE "${mode}": expected "auth0" or "local"` ``.

- [ ] **Step 4: Run them** — `yarn vitest run src/auth src/api/__tests__/apiHandler.test.ts && yarn typecheck`. Expected: PASS. The `local.test.ts` provider calls use `useTestStore()` (already registered with `setStore`), so `initStore` returns it.

- [ ] **Step 5: Check the Lambda compile** — `npx tsc api-handler.ts --module commonjs --target es2020 --strict --esModuleInterop --skipLibCheck --noEmit`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth
git commit -m "feat: add the built-in login routes and local auth provider" -m "Addresses AUTH-01, AUTH-05 and AUTH-06." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `store-cli reset-password`

**Files:**
- Create: `src/auth/prompt.ts`
- Modify: `src/store/cli.ts`, `src/store/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `replacePassword`, `deleteAllSessions`, `clearThrottle`, `getAccount` from `../auth/localData`; `validatePassword` from `../auth/password`.
- Produces: `runCli(argv, env?, io?)` where `io = { readPassword?: (prompt: string) => Promise<string> }`; `promptHidden(question)`.

- [ ] **Step 1: Write the failing tests** (append to `src/store/__tests__/cli.test.ts`, inside `describe('runCli', …)`; keep the file's existing `beforeEach`/`afterEach`, which already reset the store registry)

```ts
  describe('reset-password', () => {
    async function seedAccount(): Promise<void> {
      const store = new SqliteStore(env.SQLITE_PATH as string);
      await createAccount(store, 'me@example.com', 'the old password 1');
      await createSession(store, 'local|u1', Math.floor(Date.now() / 1000));
      for (let i = 0; i < 6; i++) await recordFailure(store, Math.floor(Date.now() / 1000));
      store.close();
    }

    it('sets the new password, ends every session and clears the lock-out', async () => {
      await seedAccount();
      const message = await runCli(['reset-password'], env, { readPassword: async () => 'the new password 22' });
      expect(message).toMatch(/all sessions/i);

      const store = new SqliteStore(env.SQLITE_PATH as string);
      expect(await verifyPassword('the new password 22', (await getAccount(store))!)).toBe(true);
      expect(await store.query('AUTH#SESSIONS')).toEqual([]);
      expect(await throttleRemaining(store, Math.floor(Date.now() / 1000))).toBe(0);
      store.close();
    });

    it('refuses a password that fails the policy, changing nothing', async () => {
      await seedAccount();
      await expect(runCli(['reset-password'], env, { readPassword: async () => 'short' })).rejects.toThrow(/at least 12/);
      const store = new SqliteStore(env.SQLITE_PATH as string);
      expect(await verifyPassword('the old password 1', (await getAccount(store))!)).toBe(true);
      expect((await store.query('AUTH#SESSIONS')).length).toBe(1);
      store.close();
    });

    it('refuses when no account exists yet', async () => {
      await expect(runCli(['reset-password'], env, { readPassword: async () => 'the new password 22' })).rejects.toThrow(/No account/);
    });

    it('never takes the password from argv or the environment', async () => {
      await seedAccount();
      await expect(runCli(['reset-password', 'sneaky-password-123'], env, { readPassword: async () => 'short' })).rejects.toThrow();
    });
  });
```

Add to the file's imports: `import { createAccount, createSession, getAccount, recordFailure, throttleRemaining } from '../../auth/localData';` and `import { verifyPassword } from '../../auth/password';`.

- [ ] **Step 2: Run to see them fail** — `yarn vitest run src/store/__tests__/cli.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/auth/prompt.ts`:

```ts
import { createInterface } from 'node:readline';

// Reads a line without echoing it. A password never goes through argv or the environment,
// where it would land in shell history and process listings.
export function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const lines = createInterface({ input: stdin });
      lines.once('line', line => { lines.close(); resolve(line); });
      lines.once('error', reject);
    });
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    let value = '';
    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
```

In `src/store/cli.ts`: add the imports `import { clearThrottle, deleteAllSessions, getAccount, replacePassword } from '../auth/localData';`, `import { promptHidden } from '../auth/prompt';`, `import { validatePassword } from '../auth/password';`; add this line to `USAGE` after the import entry:

```
  reset-password                           set a new password for the built-in login, end every session and clear any lock-out (prompts; the password is never taken from arguments)
```

change the signature to `export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, io: { readPassword?: (prompt: string) => Promise<string> } = {}): Promise<string>`, and add before the final `throw new Error(USAGE)`:

```ts
  if (command === 'reset-password') {
    if (userId) throw new Error(USAGE); // a password-shaped argument is a mistake, and must not be echoed back
    const store = await initStore(env);
    if (!(await getAccount(store))) {
      throw new Error('No account exists yet. Open the app and complete the first-run setup first.');
    }
    const password = await (io.readPassword ?? promptHidden)('New password: ');
    const problem = validatePassword(password);
    if (problem) throw new Error(problem);
    await replacePassword(store, password);
    await deleteAllSessions(store);
    await clearThrottle(store);
    return 'Password reset. All sessions have ended and any login lock-out is cleared.';
  }
```

- [ ] **Step 4: Run** — `yarn vitest run src/store/__tests__/cli.test.ts && yarn typecheck` → PASS.

- [ ] **Step 5: Check the CLI still builds** — `yarn store-cli --help`. Expected: prints the usage including `reset-password`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/auth/prompt.ts src/store/cli.ts src/store/__tests__/cli.test.ts
git commit -m "feat: add store-cli reset-password" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## PR group 2: frontend (Tasks 7–9)

### Task 7: Runtime config

**Files:**
- Create: `app/lib/runtimeConfig.ts`, `app/lib/__tests__/runtimeConfig.test.ts`
- Modify: `scripts/build-static-handler.cjs`

**Interfaces:**
- Produces: `RuntimeConfig`, `parseRuntimeConfig(value)`, `loadRuntimeConfig(fetchImpl?)`, `configFromViteEnv(env)`, `getRuntimeConfig()` (memoised, with the dev fallback).

- [ ] **Step 1: Write the failing test**

```ts
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
    await expect(loadRuntimeConfig(fetchImpl as unknown as typeof fetch)).rejects.toThrow();
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
```

- [ ] **Step 2: Run to see it fail** — `yarn vitest run app/lib/__tests__/runtimeConfig.test.ts` → FAIL.

- [ ] **Step 3: Implement** `app/lib/runtimeConfig.ts`

```ts
export type RuntimeConfig =
  | { auth: 'local' }
  | { auth: 'auth0'; domain: string; clientId: string; audience: string };

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (typeof value !== 'object' || value === null) throw new Error('config.json must be a JSON object');
  const record = value as Record<string, unknown>;

  if (record.auth === 'local') return { auth: 'local' };
  if (record.auth === 'auth0') {
    const { domain, clientId, audience } = record;
    if (nonEmptyString(domain) && nonEmptyString(clientId) && nonEmptyString(audience)) {
      return { auth: 'auth0', domain, clientId, audience };
    }
    throw new Error('config.json: auth0 mode needs a domain, clientId and audience');
  }
  throw new Error('config.json: "auth" must be "auth0" or "local"');
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchImpl('/config.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`config.json could not be loaded (${response.status})`);
  return parseRuntimeConfig(await response.json());
}

// `yarn dev` has no build step to write config.json, so it may fall back to the Vite variables. A production build never does.
export function configFromViteEnv(env: Record<string, unknown>): RuntimeConfig | undefined {
  const { VITE_AUTH0_DOMAIN: domain, VITE_AUTH0_CLIENT_ID: clientId, VITE_AUTH0_AUDIENCE: audience } = env;
  if (nonEmptyString(domain) && nonEmptyString(clientId) && nonEmptyString(audience)) {
    return { auth: 'auth0', domain, clientId, audience };
  }
  return undefined;
}

let loading: Promise<RuntimeConfig> | undefined;

// Every route renders its own layout, so the config is fetched once and shared.
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  loading ??= loadRuntimeConfig().catch((error: unknown) => {
    const fallback = import.meta.env.DEV ? configFromViteEnv(import.meta.env) : undefined;
    if (fallback) return fallback;
    loading = undefined; // let a retry fetch again
    throw error;
  });
  return loading;
}
```

In `scripts/build-static-handler.cjs`, after the `csp.json` write, add:

```js
// One frontend build serves both deployments, so the login mode and Auth0 values are read at runtime from /config.json.
const runtimeConfig = {
  auth: 'auth0',
  domain: auth0Domain,
  clientId: process.env.VITE_AUTH0_CLIENT_ID || '',
  audience: process.env.VITE_AUTH0_AUDIENCE || '',
};
fs.writeFileSync(path.join(root, 'build/client/config.json'), JSON.stringify(runtimeConfig) + '\n');
```

(The static handler already serves `.json` files with `Cache-Control: no-cache`, so it needs no change.)

- [ ] **Step 4: Run** — `yarn vitest run app/lib/__tests__/runtimeConfig.test.ts && yarn typecheck` → PASS.

- [ ] **Step 5: Check the build script**

Run: `mkdir -p build/client && VITE_AUTH0_DOMAIN=t.example.com VITE_AUTH0_CLIENT_ID=cid VITE_AUTH0_AUDIENCE=aud node scripts/build-static-handler.cjs && cat build/client/config.json`
Expected: `{"auth":"auth0","domain":"t.example.com","clientId":"cid","audience":"aud"}`. Then `rm -rf build` (it is git-ignored; this just tidies).

- [ ] **Step 6: Commit**

```bash
git add app/lib/runtimeConfig.ts app/lib/__tests__/runtimeConfig.test.ts scripts/build-static-handler.cjs
git commit -m "feat: read the login mode from a runtime config.json" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `useAuth()` and migrating every consumer

**Files:**
- Create: `app/lib/auth.tsx`, `app/lib/__tests__/auth.test.tsx`
- Modify: the 13 files in the table below.

**Interfaces:**
- Consumes: `useAuth0` from `@auth0/auth0-react`.
- Produces: `AuthState`, `AuthUser`, `LocalAuthContext`, `useAuth()`.

**Why a shim and not a context swap:** 18 test files mock `@auth0/auth0-react`. `useAuth()` reads `LocalAuthContext` first and otherwise adapts `useAuth0()`, so those tests keep working **unmodified**. Calling `useAuth0()` in local mode (no `Auth0Provider`) is safe: the library returns its default, not-loading-forever context.

- [ ] **Step 1: Write the failing test** `app/lib/__tests__/auth.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockUseAuth0 = vi.hoisted(() => vi.fn());
vi.mock('@auth0/auth0-react', () => ({ useAuth0: mockUseAuth0 }));

import { LocalAuthContext, useAuth } from '../auth';
import type { AuthState } from '../auth';

const auth0 = (over: Record<string, unknown> = {}) => ({
  isAuthenticated: true, isLoading: false, error: undefined, user: { sub: 'auth0|1', email: 'a@b.c' },
  getAccessTokenSilently: vi.fn().mockResolvedValue('tok'), loginWithRedirect: vi.fn(), logout: vi.fn(), ...over,
});

describe('useAuth with Auth0', () => {
  it('adapts the Auth0 hook', async () => {
    const mocked = auth0();
    mockUseAuth0.mockReturnValue(mocked);
    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({ mode: 'auth0', isAuthenticated: true, isLoading: false, user: { sub: 'auth0|1' } });
    expect(await result.current.getToken()).toBe('tok');

    await result.current.login();
    expect(mocked.loginWithRedirect).toHaveBeenCalledTimes(1);

    await result.current.logout();
    expect(mocked.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });

  it('keeps getToken, login and logout stable across renders', () => {
    const mocked = auth0();
    mockUseAuth0.mockReturnValue(mocked);
    const { result, rerender } = renderHook(() => useAuth());
    const first = result.current;
    rerender();
    expect(result.current.getToken).toBe(first.getToken);
    expect(result.current.login).toBe(first.login);
    expect(result.current.logout).toBe(first.logout);
  });

  it('copes with a partial Auth0 mock, as the existing component tests supply', () => {
    mockUseAuth0.mockReturnValue({ getAccessTokenSilently: vi.fn() });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBeUndefined();
    expect(typeof result.current.getToken).toBe('function');
  });
});

describe('useAuth with the local provider', () => {
  it('prefers the local context over Auth0', async () => {
    mockUseAuth0.mockReturnValue(auth0());
    const local: AuthState = {
      mode: 'local', isAuthenticated: false, isLoading: false, user: undefined,
      login: vi.fn(), logout: vi.fn(), getToken: async () => undefined,
    };
    const wrapper = ({ children }: { children: ReactNode }) => <LocalAuthContext.Provider value={local}>{children}</LocalAuthContext.Provider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current).toBe(local);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `yarn vitest run app/lib/__tests__/auth.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `app/lib/auth.tsx`

```tsx
import { createContext, useCallback, useContext, useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

export interface AuthState {
  mode: 'auth0' | 'local';
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: Error;
  user?: AuthUser;
  login(): void | Promise<void>;
  logout(): void | Promise<void>;
  // A bearer token for Auth0; undefined in local mode, where the session cookie travels by itself.
  getToken(): Promise<string | undefined>;
}

export const LocalAuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const local = useContext(LocalAuthContext);
  // Called unconditionally (hooks cannot be conditional). Without an Auth0Provider it is the library's inert default.
  const auth0 = useAuth0();

  const { loginWithRedirect, logout, getAccessTokenSilently } = auth0;
  const login = useCallback(() => loginWithRedirect(), [loginWithRedirect]);
  const signOut = useCallback(() => logout({ logoutParams: { returnTo: window.location.origin } }), [logout]);
  const getToken = useCallback(() => getAccessTokenSilently(), [getAccessTokenSilently]);

  const { isAuthenticated, isLoading, error, user } = auth0;
  const adapted = useMemo<AuthState>(
    () => ({ mode: 'auth0', isAuthenticated, isLoading, error, user, login, logout: signOut, getToken }),
    [isAuthenticated, isLoading, error, user, login, signOut, getToken],
  );

  return local ?? adapted;
}
```

- [ ] **Step 4: Migrate the consumers.** In each file, replace the `@auth0/auth0-react` import with `import { useAuth } from '~/lib/auth';` (use the relative path style the file already uses for `~/`), and rename as shown. `user?.sub`, `isAuthenticated`, `isLoading`, `error` keep their names.

| File | Change |
|------|--------|
| `app/components/layout/OfflineQueueBanner.tsx` | `useAuth0()` → `useAuth()` |
| `app/components/layout/SignedOutPanel.tsx` | `const { login } = useAuth();` and `await login();` (was `loginWithRedirect`) |
| `app/components/layout/LaunchIntent.tsx` | `useAuth0()` → `useAuth()` |
| `app/components/transactions/TransactionSheet.tsx` | `useAuth0().user?.sub` → `useAuth().user?.sub` |
| `app/components/authentication/Authentication.tsx` | `useAuth0()` → `useAuth()` |
| `app/components/authentication/LoginButton.tsx` | `const { login } = useAuth();` `onClick={() => login()}` |
| `app/components/authentication/Profile.tsx` | `const { …, logout } = useAuth();` `onClick={() => logout()}` (the `returnTo` now lives in the shim) |
| `app/components/recurring/DueRecurringCard.tsx` | `useAuth0().user?.sub` → `useAuth().user?.sub` |
| `app/components/budget/WelcomeBackCard.tsx` | same |
| `app/hooks/useOfflineQueue.ts` | same |
| `app/hooks/useSaveWithUndo.tsx` | same |
| `app/lib/queries.ts` | `useAuth0().isAuthenticated` → `useAuth().isAuthenticated` |
| `app/routes/catch-up.tsx` | `useAuth0().user?.sub` → `useAuth().user?.sub` |
| `app/routes/about.tsx` | `const { isAuthenticated, login } = useAuth();` `await login();`; the second use (`line 68`) → `useAuth()` |
| `app/hooks/useProtectedApi.ts` | `const { getToken } = useAuth();` `const token = await getToken();` — headers: `...(token ? { Authorization: \`Bearer ${token}\` } : {})` before `'Content-Type'`; dependency array `[getToken]` |
| `app/components/layout/DefaultLayout.tsx` | **only** the `useAuth0` use in `useSessionState` (line ~129): `import { useAuth } from '~/lib/auth'` and `useAuth()`. Leave `Auth0Provider` for Task 9. |

`Profile.test.tsx` and `Authentication.test.tsx` may assert exact `logout`/`loginWithRedirect` calls; the shim forwards `{ logoutParams: { returnTo: window.location.origin } }` and no-arg `loginWithRedirect()`, which is what those tests already expect. Do not edit any existing test unless a failure shows the shim changed an argument; if so, fix the shim.

- [ ] **Step 5: Run the whole frontend suite**

Run: `yarn vitest run --project app && yarn typecheck`
Expected: PASS with **no edits to existing tests**. Any failure means a consumer changed behaviour.

- [ ] **Step 6: Commit** (the shim and the migration together, since neither is useful alone)

```bash
git add app
git commit -m "refactor: route auth state through an app-owned useAuth hook" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Local login UI and config-driven provider

**Files:**
- Create: `app/lib/localAuth.ts`, `app/components/authentication/LocalAuthForm.tsx`, `app/components/authentication/LocalAuthProvider.tsx`, `app/components/authentication/AuthProvider.tsx`, and tests `app/lib/__tests__/localAuth.test.ts`, `app/components/authentication/__tests__/LocalAuthForm.test.tsx`, `app/components/authentication/__tests__/AuthProvider.test.tsx`
- Modify: `app/hooks/useProtectedApi.ts`, `app/components/layout/DefaultLayout.tsx`, `app/components/layout/__tests__/DefaultLayout.test.tsx`, `app/hooks/__tests__/useProtectedApi.test.tsx`

**Interfaces:**
- Consumes: `LocalAuthContext`, `AuthState` (Task 8); `getRuntimeConfig` (Task 7); `markSessionEnded`, `clearSessionEnded` from `~/lib/session`; `ApiError`.
- Produces: `localAuth` store (`getLocalAuthState`, `subscribeLocalAuth`, `ensureLocalAuth`, `refreshLocalAuth`, `loginLocal`, `setupLocal`, `logoutLocal`, `expireLocalSession`, `resetLocalAuthForTests`), `LocalAuthProvider`, `LocalAuthForm`, `AuthProvider`.

- [ ] **Step 1: Write the failing tests**

`app/lib/__tests__/localAuth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureLocalAuth, expireLocalSession, getLocalAuthState, loginLocal, logoutLocal, resetLocalAuthForTests, setupLocal,
} from '../localAuth';

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  resetLocalAuthForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local auth store', () => {
  it('starts loading, then signs in when /me succeeds', async () => {
    expect(getLocalAuthState()).toEqual({ status: 'loading' });
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedIn', user: { sub: 'local|1', email: 'me@example.com' } });
  });

  it('asks whether setup is needed when /me says 401', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { setupRequired: true }));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: true });
  });

  it('checks only once however many layouts mount', async () => {
    fetchMock.mockResolvedValue(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await Promise.all([ensureLocalAuth(), ensureLocalAuth(), ensureLocalAuth()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to signed out, and logs, when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: false });
    expect(console.error).toHaveBeenCalled();
  });

  it('signs in on a good login and surfaces the server message on a bad one', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await loginLocal('me@example.com', 'a long enough password');
    expect(getLocalAuthState()).toMatchObject({ status: 'signedIn' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));

    resetLocalAuthForTests();
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'Invalid email or password' }));
    await expect(loginLocal('me@example.com', 'wrong')).rejects.toThrow('Invalid email or password');
  });

  it('sends the setup code and fields to /setup', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await setupLocal({ code: 'abc', email: 'me@example.com', password: 'a long enough password' });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ code: 'abc', email: 'me@example.com', password: 'a long enough password' });
  });

  it('goes signed out when the session expires mid-use', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await ensureLocalAuth();
    expireLocalSession();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: false });
  });

  it('posts to /logout', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await logoutLocal();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
});
```

`app/components/authentication/__tests__/LocalAuthForm.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LocalAuthForm } from '../LocalAuthForm';

function renderForm(props: { setupRequired: boolean; onLogin?: any; onSetup?: any }) {
  return render(
    <MantineProvider env="test">
      <LocalAuthForm setupRequired={props.setupRequired} onLogin={props.onLogin ?? vi.fn()} onSetup={props.onSetup ?? vi.fn()} />
    </MantineProvider>,
  );
}

describe('LocalAuthForm', () => {
  it('shows email and password only when signing in', () => {
    renderForm({ setupRequired: false });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Setup code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks for the setup code on first run, and says where to find it', () => {
    renderForm({ setupRequired: true });
    expect(screen.getByLabelText('Setup code')).toBeInTheDocument();
    expect(screen.getByText(/server log/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('submits the login fields', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: false, onLogin });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('me@example.com', 'a long enough password'));
  });

  it('submits the setup fields', async () => {
    const onSetup = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: true, onSetup });
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(onSetup).toHaveBeenCalledWith({ code: 'abc123', email: 'me@example.com', password: 'a long enough password' }));
  });

  it('shows the server message when it fails, without clearing the email', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('Invalid email or password'));
    renderForm({ setupRequired: false, onLogin });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong password here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com');
  });

  it('does not submit a password that is too short', () => {
    const onLogin = vi.fn();
    renderForm({ setupRequired: true, onSetup: onLogin });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 12/)).toBeInTheDocument();
  });
});
```

`app/components/authentication/__tests__/AuthProvider.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const mockGetRuntimeConfig = vi.hoisted(() => vi.fn());
vi.mock('~/lib/runtimeConfig', () => ({ getRuntimeConfig: mockGetRuntimeConfig }));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children, domain }: { children: React.ReactNode; domain: string }) => <div data-testid="auth0" data-domain={domain}>{children}</div>,
  useAuth0: () => ({}),
}));
vi.mock('../LocalAuthProvider', () => ({ LocalAuthProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="local">{children}</div> }));

import { AuthProvider } from '../AuthProvider';

function renderProvider() {
  return render(<MantineProvider env="test"><AuthProvider><span>app</span></AuthProvider></MantineProvider>);
}

beforeEach(() => {
  mockGetRuntimeConfig.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AuthProvider', () => {
  it('wraps the app in Auth0 with the configured values', async () => {
    mockGetRuntimeConfig.mockResolvedValue({ auth: 'auth0', domain: 't.example.com', clientId: 'cid', audience: 'aud' });
    renderProvider();
    expect(await screen.findByTestId('auth0')).toHaveAttribute('data-domain', 't.example.com');
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('uses the local provider in local mode', async () => {
    mockGetRuntimeConfig.mockResolvedValue({ auth: 'local' });
    renderProvider();
    expect(await screen.findByTestId('local')).toBeInTheDocument();
  });

  it('shows a clear error, and no app, when the config cannot be loaded', async () => {
    mockGetRuntimeConfig.mockRejectedValue(new Error('config.json could not be loaded (404)'));
    renderProvider();
    expect(await screen.findByText(/could not start/i)).toBeInTheDocument();
    expect(screen.queryByText('app')).not.toBeInTheDocument();
  });
});
```

Add to `app/hooks/__tests__/useProtectedApi.test.tsx` (the existing mock supplies only `getAccessTokenSilently`, which still works through the shim; add a local-mode block):

```tsx
describe('useProtectedApi in local mode', () => {
  it('sends no Authorization header and reports an ended session on a 401', async () => {
    // Re-mock useAuth for this block only.
    const { LocalAuthContext } = await import('~/lib/auth');
    const { ApiError } = await import('~/lib/apiError');
    const { createElement } = await import('react');
    const localState = {
      mode: 'local' as const, isAuthenticated: true, isLoading: false, user: { sub: 'local|1' },
      login: vi.fn(), logout: vi.fn(), getToken: async () => undefined,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(LocalAuthContext.Provider, { value: localState }, children);
    const { result } = renderHook(() => useProtectedApi(), { wrapper });

    await expect(result.current.request('/api/categories')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(markSessionEnded).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to see them fail** — `yarn vitest run --project app app/lib/__tests__/localAuth.test.ts app/components/authentication` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`app/lib/localAuth.ts`:

```ts
// Every route renders its own layout, and so its own provider. The session lives here, outside React,
// so navigating does not re-check it and flash a loading state.
export interface LocalUser {
  sub: string;
  email: string;
}

export type LocalAuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; setupRequired: boolean }
  | { status: 'signedIn'; user: LocalUser };

let state: LocalAuthState = { status: 'loading' };
let started: Promise<void> | undefined;
const listeners = new Set<() => void>();

function set(next: LocalAuthState): void {
  state = next;
  listeners.forEach(listener => listener());
}

export function getLocalAuthState(): LocalAuthState {
  return state;
}

export function subscribeLocalAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return new Error(typeof body.error === 'string' ? body.error : fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function refreshLocalAuth(): Promise<void> {
  try {
    const me = await fetch('/api/auth/me');
    if (me.ok) {
      const body = (await me.json()) as { userId: string; email: string };
      set({ status: 'signedIn', user: { sub: body.userId, email: body.email } });
      return;
    }
    const status = await fetch('/api/auth/status');
    const body = (await status.json()) as { setupRequired?: unknown };
    set({ status: 'signedOut', setupRequired: body.setupRequired === true });
  } catch (error) {
    console.error('Could not check the local session:', error);
    set({ status: 'signedOut', setupRequired: false });
  }
}

export function ensureLocalAuth(): Promise<void> {
  started ??= refreshLocalAuth();
  return started;
}

async function signIn(path: string, body: unknown, fallback: string): Promise<void> {
  const response = await postJson(path, body);
  if (!response.ok) throw await readError(response, fallback);
  const user = (await response.json()) as { userId: string; email: string };
  set({ status: 'signedIn', user: { sub: user.userId, email: user.email } });
}

export function loginLocal(email: string, password: string): Promise<void> {
  return signIn('/api/auth/login', { email, password }, 'Sign in failed');
}

export function setupLocal(input: { code: string; email: string; password: string }): Promise<void> {
  return signIn('/api/auth/setup', input, 'Setup failed');
}

export async function logoutLocal(): Promise<void> {
  await postJson('/api/auth/logout', {});
}

// The API said 401: the session ended on the server (expired, or reset from the CLI).
export function expireLocalSession(): void {
  set({ status: 'signedOut', setupRequired: false });
}

export function resetLocalAuthForTests(): void {
  state = { status: 'loading' };
  started = undefined;
  listeners.clear();
}
```

`app/components/authentication/LocalAuthForm.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

interface Props {
  setupRequired: boolean;
  onLogin(email: string, password: string): Promise<void>;
  onSetup(input: { code: string; email: string; password: string }): Promise<void>;
}

export function LocalAuthForm({ setupRequired, onLogin, onSetup }: Props) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (setupRequired && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (setupRequired) await onSetup({ code: code.trim(), email: email.trim(), password });
      else await onLogin(email.trim(), password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        {setupRequired && (
          <>
            <Text size="sm">Create the account for this instance. The setup code is printed once in the server log when it first starts; restarting before you finish makes a new one.</Text>
            <TextInput label="Setup code" value={code} onChange={e => setCode(e.currentTarget.value)} required autoComplete="off" />
          </>
        )}
        <TextInput label="Email" type="email" value={email} onChange={e => setEmail(e.currentTarget.value)} required autoComplete="username" />
        <PasswordInput
          label="Password"
          value={password}
          onChange={e => setPassword(e.currentTarget.value)}
          required
          maxLength={MAX_PASSWORD_LENGTH}
          description={setupRequired ? `At least ${MIN_PASSWORD_LENGTH} characters` : undefined}
          autoComplete={setupRequired ? 'new-password' : 'current-password'}
        />
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Button type="submit" loading={busy}>{setupRequired ? 'Create account' : 'Sign in'}</Button>
      </Stack>
    </form>
  );
}
```

`app/components/authentication/LocalAuthProvider.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Modal } from '@mantine/core';
import { LocalAuthContext } from '~/lib/auth';
import type { AuthState } from '~/lib/auth';
import { clearSessionEnded } from '~/lib/session';
import {
  ensureLocalAuth, getLocalAuthState, loginLocal, logoutLocal, setupLocal, subscribeLocalAuth,
} from '~/lib/localAuth';
import { LocalAuthForm } from './LocalAuthForm';

export function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeLocalAuth, getLocalAuthState, getLocalAuthState);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => { void ensureLocalAuth(); }, []);
  useEffect(() => { if (snapshot.status === 'signedIn') clearSessionEnded(); }, [snapshot.status]);

  const login = useCallback(() => setFormOpen(true), []);
  const logout = useCallback(async () => {
    await logoutLocal();
    window.location.assign('/'); // a fresh load drops every in-memory cache, as Auth0's redirect does
  }, []);
  const getToken = useCallback(async () => undefined, []);

  const value = useMemo<AuthState>(() => ({
    mode: 'local',
    isAuthenticated: snapshot.status === 'signedIn',
    isLoading: snapshot.status === 'loading',
    user: snapshot.status === 'signedIn' ? { sub: snapshot.user.sub, email: snapshot.user.email } : undefined,
    login,
    logout,
    getToken,
  }), [snapshot, login, logout, getToken]);

  return (
    <LocalAuthContext.Provider value={value}>
      {children}
      <Modal opened={formOpen && snapshot.status === 'signedOut'} onClose={() => setFormOpen(false)} title="Sign in" centered>
        {snapshot.status === 'signedOut' && (
          <LocalAuthForm setupRequired={snapshot.setupRequired} onLogin={loginLocal} onSetup={setupLocal} />
        )}
      </Modal>
    </LocalAuthContext.Provider>
  );
}
```

`app/components/authentication/AuthProvider.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Auth0Provider } from '@auth0/auth0-react';
import { Center, Loader, Text } from '@mantine/core';
import { getRuntimeConfig } from '~/lib/runtimeConfig';
import type { RuntimeConfig } from '~/lib/runtimeConfig';
import { LocalAuthProvider } from './LocalAuthProvider';

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; config: RuntimeConfig };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getRuntimeConfig().then(
      config => { if (!cancelled) setLoaded({ status: 'ready', config }); },
      (error: unknown) => {
        console.error('Could not load the app configuration:', error);
        if (!cancelled) setLoaded({ status: 'error' });
      },
    );
    return () => { cancelled = true; };
  }, []);

  if (loaded.status === 'loading') {
    return <Center mih="100vh"><Loader aria-label="Starting the app" /></Center>;
  }
  if (loaded.status === 'error') {
    return <Center mih="100vh" p="md"><Text>The app could not start because its configuration did not load. Check your connection and reload.</Text></Center>;
  }

  const { config } = loaded;
  if (config.auth === 'local') return <LocalAuthProvider>{children}</LocalAuthProvider>;

  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      // The default in-memory cache forces a silent-auth iframe on every reload,
      // which browsers block as a third-party cookie. Persist instead and renew
      // with a rotating refresh token.
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback={false}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: config.audience,
        scope: 'openid profile email offline_access',
      }}
    >
      {children}
    </Auth0Provider>
  );
}
```

`app/hooks/useProtectedApi.ts`: add imports `import { expireLocalSession } from '~/lib/localAuth';`; read `const { getToken, mode } = useAuth();` (Task 8 already renamed); and in the `catch`, after the existing `if (isSessionEndedError(error)) markSessionEnded();` add:

```ts
        // In local mode a 401 means the server no longer knows this session (expired, or reset from the CLI).
        if (mode === 'local' && error instanceof ApiError && error.status === 401) {
          expireLocalSession();
          markSessionEnded();
        }
```

and add `mode` to the `useCallback` dependency array.

`app/components/layout/DefaultLayout.tsx`: replace the body of `DefaultLayout` with

```tsx
export function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LayoutShell>{children}</LayoutShell>
    </AuthProvider>
  );
}
```

import `AuthProvider` from `../authentication/AuthProvider`, and delete the now-unused `Auth0Provider` import.

`app/components/layout/__tests__/DefaultLayout.test.tsx`: add `vi.mock('../../authentication/AuthProvider', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));` beside its other mocks. Its existing `@auth0/auth0-react` mock stays (the shim still calls `useAuth0`).

- [ ] **Step 4: Run everything on the frontend** — `yarn vitest run --project app && yarn typecheck`. Expected: PASS, including the unmodified existing tests.

- [ ] **Step 5: Build** — `VITE_AUTH0_DOMAIN=t.example.com VITE_AUTH0_CLIENT_ID=cid VITE_AUTH0_AUDIENCE=aud yarn build`. Expected: success, and `build/client/config.json` exists. (The API step installs production dependencies and needs network; if it is unavailable, run `yarn react-router build && node scripts/build-static-handler.cjs` and say which you ran.)

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat: add the built-in login screens and runtime provider choice" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## PR group 3: policy and verification (Task 10)

### Task 10: `SECURITY.md`, docs and the browser check

**Files:**
- Modify: `SECURITY.md`, `CLAUDE.md`, `docs/ROADMAP.md`
- Create: `scripts/local-auth-check/build.cjs`, `scripts/local-auth-check/server.cjs`, `scripts/local-auth-check/check.mjs`

- [ ] **Step 1: Amend `SECURITY.md`.** Edit the control table rows (keep their IDs and mappings):

- **AUTH-01:** `Validate the credential on every API request: a JWT's signature, \`aud\`, \`iss\`, \`exp\` and \`sub\` (Auth0 mode), or a server-side session lookup that checks expiry (local mode)`
- **AUTH-02:** `Never implement custom auth — delegate to an identity provider (Auth0, Okta, etc.). **Exception:** the built-in single-account login (\`AUTH_MODE=local\`, self-hosted only), which must satisfy AUTH-07 to AUTH-10`
- **AUTH-03:** append `; session cookies must be \`HttpOnly\`, \`SameSite=Strict\` and \`Secure\` (unless \`COOKIE_SECURE=false\` on a trusted LAN)`

Add rows after AUTH-06:

| AUTH-07 | WEB-A07 | Passwords are hashed with a memory-hard KDF (scrypt), salted per hash, with parameters stored alongside; the 12–128 character policy is enforced server-side |
| AUTH-08 | WEB-A07 | Login attempts are throttled with exponential backoff; a wrong password and an unknown account are indistinguishable (body and timing) |
| AUTH-09 | WEB-A01 | The setup route is protected by a one-time code printed to the server log, and closes permanently once an account exists |
| AUTH-10 | WEB-A01, WEB-A07 | Session IDs are random, stored only as hashes, revocable (logout, password reset) and rejected once expired; state-changing requests must carry a same-host `Origin` |

(Check the file's existing table column order and `WEB-A..` mapping style first, and match it.)

- [ ] **Step 2: Update `CLAUDE.md`.** In "Key Files" add `src/auth/` (auth providers: Auth0 JWT and the built-in login) and `app/lib/auth.tsx` (`useAuth`, the app's auth hook). In "Architecture", add one sentence under the Protected API entry: auth is chosen by `AUTH_MODE` (`auth0` default, `local`), and the frontend reads `/config.json` at runtime. Keep it short.

- [ ] **Step 3: Update `docs/ROADMAP.md`.** Change the Portable Auth row's status to `Implemented on <branch>, awaiting review` and link the spec `superpowers/specs/2026-10-09-portable-auth-design.md` and this plan, in the same style as the Storage Interface row.

- [ ] **Step 4: Write the browser-check harness.** It is a throwaway verification tool, not a CI test, and not the Container Image's server.

`scripts/local-auth-check/build.cjs`:

```js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'build/local-auth-check');
fs.rmSync(out, { recursive: true, force: true });
execSync(
  'tsc api-handler.ts --outDir build/local-auth-check --module commonjs --skipLibCheck --strict --target es2020 --esModuleInterop',
  { cwd: root, stdio: 'inherit' },
);
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
console.log('✓ API compiled to build/local-auth-check');
```

`scripts/local-auth-check/server.cjs` — a minimal adapter that serves `build/client` and passes `/api/*` to the compiled handler as an API Gateway v2 event; it must set `event.cookies` from the `Cookie` header, lowercase header names, set `requestContext.http.method` and `routeKey`, and write `result.cookies` back as `Set-Cookie` headers. Config comes from env: `AUTH_MODE=local STORE=sqlite SQLITE_PATH=<tmp file> COOKIE_SECURE=false`. It serves `{"auth":"local"}` for `/config.json` instead of the built file. Use only Node built-ins. Print `listening on http://127.0.0.1:<port>` and the setup code appears in its own stdout via the provider's log line.

`scripts/local-auth-check/check.mjs` — a Playwright script (look at `scripts/screenshots/capture.mjs` for how this repo launches Chromium) that: starts `server.cjs` as a child process on a free port, reads the setup code from its stdout, opens the app, asserts the signed-out state, opens Sign in, completes the setup form, asserts the Profile menu shows the email, reloads and asserts it is **still signed in**, checks `document.cookie` does **not** contain `budget_session` (HttpOnly), logs out and asserts the signed-out state again, then signs in with the password and asserts it works. It prints a pass/fail line per step and exits non-zero on the first failure.

- [ ] **Step 5: Run the check**

Run: `yarn build` (with dummy `VITE_AUTH0_*`), then `node scripts/local-auth-check/build.cjs && node scripts/local-auth-check/check.mjs`
Expected: every step passes. If the environment cannot launch Chromium or the build cannot install, **say so plainly in the report**: the local-mode browser flow is then unverified. Do not claim it passed.

- [ ] **Step 6: Final verification**

Run: `yarn test && yarn typecheck && git diff main --stat -- infra`
Expected: all green, and an empty diff for `infra/`.

- [ ] **Step 7: Commit**

```bash
git add SECURITY.md CLAUDE.md docs/ROADMAP.md scripts/local-auth-check
git commit -m "docs: amend AUTH controls for the built-in login" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** provider seam (T1); scrypt + policy (T2); `AUTH#` items, hashed sessions, throttle, sliding expiry (T3); cookies and `Origin` (T4); setup code, five routes, local provider, logging rules (T5); CLI reset (T6); `/config.json` (T7); `useAuth()` (T8); local UI, provider choice, 401 handling (T9); `SECURITY.md` amendments and the browser check (T10).
- **Spec correction made while planning:** sessions live in one `AUTH#SESSIONS` partition (sort key = hash), because `Store.query` lists one partition and a reset must find every session. The spec table was updated to match.
- **Rulings:** (1) no localStorage fallback for `config.json` (the service worker caches nothing, so the shell already needs the network); (2) one password prompt in the CLI, not two (a mistyped reset is fixed by running it again); (3) `yarn dev` may fall back to the `VITE_AUTH0_*` variables, a production build never does.
- **Type consistency:** `AuthProvider`/`AuthResult` (T1) used by T5; `PasswordRecord` (T2) extended by `Account` (T3); `hashToken` (T3) used by T5 tests; `AuthState.mode` (T8) used by T9's `useProtectedApi`.
