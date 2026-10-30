# Personal API Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user creates read-only or read and write API tokens in Settings, and a client holding one can call `/api/*` as that user.

**Architecture:** A new first step in `api-handler.ts` recognises a `Bearer hwr_…`/`Bearer hww_…` header, looks up its SHA-256 hash in the store, and answers as that user; anything else takes the existing Auth0 or session path. Read-only and "no token management" are enforced in one pure function in front of the router. Token management is three new routes that tokens themselves cannot call. Ships as two PRs: server (Tasks 1 to 7), then Settings UI (Tasks 8 to 10).

**Tech Stack:** TypeScript, Vitest, the existing `Store` (DynamoDB, SQLite, `MemoryStore` in tests), React 19, Mantine 8, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-30-api-tokens-design.md`. Read it first; this plan only records decisions the spec leaves open.

## Global Constraints

- Token format: `hwr_` (read) or `hww_` (write) + 43 characters, the base64url of 32 bytes from `crypto.randomBytes`. 47 characters in all. The server never trusts the prefix; scope comes from the stored record.
- Only the SHA-256 hash (`hashToken` in `src/auth/localData.ts`) is stored. Never log, return after creation, export or put in a URL a token, its hash or its prefix.
- Expiry options: 90, 180, 365, 730 days, or never. The server computes `expiresAt` (epoch seconds); a token is valid only while `expiresAt > now`.
- At most 25 tokens per user. Name 1 to 60 characters.
- Credential items live outside every `USER#` partition (`AUTH#TOKENS`, `AUTH#TOKENLIST#<userId>`).
- A read token may make `GET`/`HEAD` only; deny by default. A token may never reach `/api/auth/*`, `/api/tokens*` or `/api/push/*`.
- `Cache-Control: no-store` on every token-management response.
- Rate limit failed token lookups: over 30 in 60 seconds per address answers 429 for 60 seconds.
- Follow `SECURITY.md` and `docs/brand.md`: Mantine theme tokens, WCAG AA, colour never carries meaning alone, no animation. Conventional commits; end commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests use Vitest. `src/**` tests run in the node project, `app/**` tests in jsdom.

## Review Focus

Failure modes the spec implies that no single task would otherwise pin, most likely first. Each has a test in the task named.

1. A revoked token sent together with a still-valid session cookie must be refused, not fall back to the cookie (Task 4).
2. A header that starts `Bearer hwr_` or `Bearer hww_` but is malformed (short, long, odd characters, trailing space) must be 401, never handed to the Auth0 JWT check (Task 2).
3. A token expiring at exactly the current second is already expired (Task 1).
4. Re-entering the password to create a write token must not become a password-guessing endpoint for someone holding a session: it uses the existing login throttle (Task 5).
5. A new `GET` route that writes would silently let read tokens write: a pinned route inventory fails until it is reviewed (Task 4).

## File Structure

- Create `src/auth/tokens.ts`: token model, generation, storage. One responsibility: tokens at rest.
- Create `src/auth/tokenAuth.ts`: reading a token off a request and the access rules. One responsibility: tokens on the wire.
- Create `src/auth/failureLimiter.ts`: a small in-memory failed-attempt limiter.
- Create `src/api/tokens.ts`: the three management handlers.
- Modify `api-handler.ts`: the new first step and route registration.
- Modify the three places that end every session: `src/auth/routes.ts:71`, `src/auth/local.ts:42`, `src/store/cli.ts:81`.
- Modify `SECURITY.md`, `CHANGELOG.md`.
- UI: modify `app/lib/api.ts`, `app/lib/queries.ts`, `app/lib/types.ts`, `app/routes/settings.tsx`; create `app/components/settings/AccessTokens.tsx`.

---

## PR 1: Server

### Task 1: Token model and storage

**Files:**
- Create: `src/auth/tokens.ts`
- Test: `src/auth/__tests__/tokens.test.ts` (use `MemoryStore` from `src/store/memory.ts`)

**Interfaces:**
- Produces:
  - `type TokenScope = 'read' | 'write'`
  - `const TOKEN_PATTERN: RegExp` (`/^hw[rw]_[A-Za-z0-9_-]{43}$/`), `MAX_TOKENS_PER_USER = 25`, `MAX_TOKEN_NAME_LENGTH = 60`, `TOKEN_EXPIRY_DAYS = [90, 180, 365, 730] as const`, `LAST_USED_INTERVAL_SECONDS = 3600`
  - `interface TokenRecord { tokenId: string; name: string; scope: TokenScope; createdAt: number; expiresAt: number | null; lastUsedAt: number | null; prefix: string }` (`prefix` is the token's first 8 characters; times are epoch seconds)
  - `interface StoredToken extends TokenRecord { userId: string; hash: string }`
  - `class TokenLimitError extends Error`
  - `createToken(store: Store, input: { userId: string; name: string; scope: TokenScope; expiryDays: number | null }, nowSeconds: number): Promise<{ token: string; record: TokenRecord }>`
  - `findToken(store: Store, token: string, nowSeconds: number): Promise<StoredToken | undefined>`
  - `touchToken(store: Store, stored: StoredToken, nowSeconds: number): Promise<void>`
  - `listTokens(store: Store, userId: string): Promise<TokenRecord[]>` (newest first; no hash)
  - `revokeToken(store: Store, userId: string, tokenId: string): Promise<boolean>`
  - `revokeAllTokens(store: Store): Promise<void>`

- [ ] **Step 1: Write the failing tests** in `tokens.test.ts`, each with real assertions:
  - `'makes a read token that starts hwr_ and is 47 characters'`, and a write token that starts `hww_`; both match `TOKEN_PATTERN`; two tokens differ.
  - `'stores only a hash: the token appears nowhere in the store'` (serialise every item from `store.query('AUTH#TOKENS')` and `store.query('AUTH#TOKENLIST#u1')`; expect it not to contain the token).
  - `'finds a token and returns the stored scope, ignoring the prefix'` (put a lookup item with scope `read` under the hash of a token that begins `hww_`; expect `scope === 'read'`).
  - `'sets expiresAt to now plus the chosen days, and null for never'`.
  - `'does not find a token at its exact expiry second, but does one second earlier'`.
  - `'finds a never-expiring token ten years later'`.
  - `'refuses a 26th token with TokenLimitError and allows one after a revoke'`.
  - `'lists only the owner's tokens, newest first, without hash or secret'`.
  - `'revokes the lookup and the listing together; another user's tokenId returns false and removes nothing'`.
  - `'revokeAllTokens removes every token of every user'`.
  - `'touchToken writes lastUsedAt at most once an hour'` (two calls 10 s apart change it once; a call 3601 s later changes it again).
  - `'touchToken after a revoke does not bring the token back'` (swallow `ConditionFailedError`).
- [ ] **Step 2: Run** `yarn vitest run src/auth/__tests__/tokens.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the interface above in `src/auth/tokens.ts`. Lookup item: `PK 'AUTH#TOKENS'`, `SK` = `hashToken(token)`, holding `tokenId`, `userId`, `scope`, `expiresAt`. Listing item: `PK 'AUTH#TOKENLIST#<userId>'`, `SK` = `tokenId`, holding the `TokenRecord` fields plus `hash` (kept only so a revoke can find the lookup item; `listTokens` must strip it). Write both with one `store.transact`. `touchToken` patches both items with `mustExist: true`. The 25-token check counts `listTokens`; a rare race that allows 26 is accepted.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: store personal API tokens (HOA-5)`.

### Task 2: Reading a token off a request

**Files:**
- Create: `src/auth/tokenAuth.ts`
- Test: `src/auth/__tests__/tokenAuth.test.ts`

**Interfaces:**
- Consumes: `findToken`, `TOKEN_PATTERN`, `TokenScope` (Task 1); `err` from `src/api/http.ts`.
- Produces:
  - `presentsAccessToken(event: APIGatewayProxyEventV2): boolean` (true when `authorization` starts with `Bearer hwr_` or `Bearer hww_`; touches no store)
  - `type TokenAuthResult = { userId: string; scope: TokenScope; stored: StoredToken } | { rejection: ApiResponse }`
  - `authenticateToken(event: APIGatewayProxyEventV2, store: Store, nowSeconds: number): Promise<TokenAuthResult>`
  - `tokenAccessRejection(scope: TokenScope, method: string, path: string): ApiResponse | undefined`

- [ ] **Step 1: Write the failing tests:**
  - `presentsAccessToken`: true for `Bearer hwr_x` and `Bearer hww_x`; false for an Auth0-style JWT, a missing header, `bearer hwr_x` (wrong case) and `hwr_x` without `Bearer `.
  - `authenticateToken`: a valid token returns `{ userId, scope }`; an unknown token, an expired token and a revoked token each return a 401 whose body is exactly `{"error":"Unauthorized"}` (assert all three bodies are identical).
  - `'rejects a malformed token without touching the store'`: for `hwr_` + 42 characters, + 44 characters, + a `!`, and with a trailing space, expect 401 and a store whose `get` was never called (spy).
  - `tokenAccessRejection`: a `read` scope with `GET` and `HEAD` → `undefined`; with `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS` and a lowercase `get`-like unknown method → 403 `This token is read-only`; both scopes on `/api/auth/me`, `/api/tokens`, `/api/tokens/abc` and `/api/push/subscriptions` → 403 `Not available to access tokens` (checked before the read-only rule); a `write` scope on `POST /api/transactions` → `undefined`.
  - `'logs a failure without the token'`: spy on `console.warn`; expect the logged text not to contain any part of the presented token.
- [ ] **Step 2: Run** `yarn vitest run src/auth/__tests__/tokenAuth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four exports in `src/auth/tokenAuth.ts`. The header is read from `event.headers?.authorization`. Log failures as `console.warn('Token auth rejected:', reason)` with reason `malformed` or `unknown-or-expired`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: read access tokens off a request (HOA-6)`.

### Task 3: Failed-lookup limiter

**Files:**
- Create: `src/auth/failureLimiter.ts`
- Test: `src/auth/__tests__/failureLimiter.test.ts`

**Interfaces:**
- Produces: `createFailureLimiter(options?: { maxFailures?: number; windowSeconds?: number; blockSeconds?: number; maxKeys?: number }, now?: () => number): { isBlocked(key: string): boolean; recordFailure(key: string): void }` with defaults 30, 60, 60 and 10 000 keys.

- [ ] **Step 1: Write the failing tests:** `'allows 30 failures and blocks the 31st'`; `'unblocks after 60 seconds'`; `'counts addresses separately'`; `'forgets failures older than the window'`; `'never holds more than maxKeys entries'` (record failures for 10 001 keys, expect the internal size not to exceed 10 000 and the newest key to be tracked).
- [ ] **Step 2: Run** `yarn vitest run src/auth/__tests__/failureLimiter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with a `Map` keyed by address; evict the oldest entry when full. Clock injected for tests.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: limit failed access-token lookups (HOA-6)`.

### Task 4: Wire it into the handler

**Files:**
- Modify: `api-handler.ts`
- Test: `src/api/__tests__/tokenRequests.test.ts` (new; drives the real `handler` with `setStore(new MemoryStore())` and a fake `setAuth` provider; do not extend the heavily mocked `apiHandler.test.ts`)

**Interfaces:**
- Consumes: `presentsAccessToken`, `authenticateToken`, `tokenAccessRejection` (Task 2), `touchToken` (Task 1), `createFailureLimiter` (Task 3).

- [ ] **Step 1: Write the failing tests** (each calls `handler` with a built event, using `createToken` from Task 1 for real tokens):
  - `'a read token can list categories'` → 200; `'a read token cannot create a transaction'` → 403, and the store has no new transaction.
  - `'a write token can create a transaction'` → 201.
  - `'a token acts only on its owner's data'`: user A's write token creates a transaction; user B's token lists transactions and sees none.
  - `'a revoked token with a valid session cookie is refused'` (Review Focus 1): in local mode (`createLocalProvider` on the same store, a real session cookie in the headers) → 401.
  - `'a write token works on a POST with no Origin header'` in local mode (the cookie path would answer 403).
  - `'a token cannot reach /api/auth/me, /api/tokens or /api/push/subscriptions'` → 403.
  - `'the 31st failed lookup from one address is answered 429 with Retry-After'`, and a good token from another address still works.
  - `'a request without a token behaves exactly as before'` (an Auth0-style bearer reaches the existing path; the store is not read for token lookups).
  - `'every GET route is on the reviewed list'` (Review Focus 5): register routes on a recording router (`registerCoreRoutes`) and assert the sorted list of `GET` paths equals the pinned array, with a comment: adding a `GET` route? Confirm it has no side effects, then add it here.
- [ ] **Step 2: Audit** every `GET` handler registered in `src/api/routes.ts` (categories, transactions, transactions/range, targets, pots, recurring, accounts, trash). Confirm none calls `put`, `patch`, `delete` or `transact`. If one does, stop and tell the owner: a read token would be able to write through it.
- [ ] **Step 3: Run** `yarn vitest run src/api/__tests__/tokenRequests.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** in `api-handler.ts`: at the top of the handler, `if (presentsAccessToken(event))` then, in order: check the limiter (429 with `Retry-After: 60`); `await initStore()`; `authenticateToken` (on rejection, record the failure and return it); `tokenAccessRejection` (return if set); `touchToken` (log and ignore errors); `router.dispatch(event, userId)`. Return from this branch without calling `initAuth`. A module-level limiter keyed by `event.requestContext.http.sourceIp`. When `tokenAccessRejection` refuses a request, log `console.warn('Token access refused:', event.requestContext.routeKey, reason)` (the templated route, never the raw path, never the token). The existing flow below is unchanged. The limiter lives in this shared handler, so it is exact in the container (one process) and best-effort per instance on AWS, where API Gateway's own throttling is the main limit; this is a small widening of the spec's "container only".
- [ ] **Step 5: Run** the new file and `yarn vitest run src/api`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: accept personal API tokens on /api/* (HOA-6)`.

### Task 5: Token management routes

**Files:**
- Create: `src/api/tokens.ts`
- Modify: `api-handler.ts` (register beside the push routes)
- Test: `src/api/__tests__/tokens.test.ts`

**Interfaces:**
- Consumes: Task 1 functions; `getAccount`, `recordFailure`, `throttleRemaining`, `clearThrottle` from `src/auth/localData.ts`; `verifyPassword`; `ok`, `err`, `parseJsonObject`.
- Produces: `createAccessToken`, `listAccessTokens`, `revokeAccessToken` with the router `Handler` signature. Contract:
  - `POST /api/tokens`, body `{ name: string; scope: 'read' | 'write'; expiryDays: 90 | 180 | 365 | 730 | null; password?: string }`. 201 `{ token: string, record: TokenRecord }`. 400 for an unknown field, a bad type, a name that is empty after trimming, over 60 characters or containing control characters, a scope or expiry outside the allow-lists. 409 `You can have at most 25 access tokens. Revoke one first.` at the limit.
  - In local mode (`process.env.AUTH_MODE === 'local'`) a `write` scope needs `password`: missing → 403 `Password required`; wrong → 403 `Incorrect password` and `recordFailure`; while `throttleRemaining > 0` → 429 before the password is checked; a correct password calls `clearThrottle`. Read tokens never ask for it.
  - `GET /api/tokens` → 200 `{ tokens: TokenRecord[] }`. `DELETE /api/tokens/{tokenId}` → 200 `{}`; 404 `Token not found` for both an unknown id and another user's.
  - All three responses carry `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests:** the happy paths; one test per 400 case (including an array body and a name of only spaces); the 409; the local-mode password cases (missing, wrong, throttled, correct; read token never asks; Auth0 mode never asks); `'the password check cannot be used to guess: 20 wrong passwords hit the throttle'` (Review Focus 4); `'list returns neither hash nor full token'`; `'revoke of another user's token answers the same 404 as an unknown id'`; every response has `no-store`.
- [ ] **Step 2: Run** `yarn vitest run src/api/__tests__/tokens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three handlers in `src/api/tokens.ts` and register `router.post('/api/tokens', …)`, `router.get('/api/tokens', …)`, `router.delete('/api/tokens/{tokenId}', …)` in `api-handler.ts`, not in `registerCoreRoutes` (the demo must not have them). Validate with allow-lists (IO-01, IO-02) and reject unknown fields (IO-07). Compute `expiresAt` in `createToken`, never from client input. Log creation and revocation as `console.log('Access token created:', tokenId, scope)` and `console.log('Access token revoked:', tokenId)`; add tests that spy on `console.log` and assert the logged text contains the `tokenId` and none of the token.
- [ ] **Step 4: Run** the file and `yarn vitest run src/api`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: create, list and revoke access tokens (HOA-5)`.

### Task 6: A password reset revokes every token

**Files:**
- Modify: `src/auth/routes.ts:71`, `src/auth/local.ts:42`, `src/store/cli.ts:81` (add `await revokeAllTokens(store)` after each `deleteAllSessions`)
- Test: extend `src/auth/__tests__/routes.test.ts`, `src/auth/__tests__/local.test.ts`, `src/store/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing tests**, one per site: completing a recovery, opening recovery at start-up, and `store-cli reset-password` each leave `listTokens` empty for a user who had two tokens, and leave an unrelated `USER#` item untouched.
- [ ] **Step 2: Run** the three test files. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the three one-line additions and their imports.
- [ ] **Step 4: Run** `yarn vitest run src/auth src/store`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: revoke access tokens when the password is reset (HOA-5)`.

### Task 7: Security documentation, review and PR

**Files:**
- Modify: `SECURITY.md`, `CHANGELOG.md`

- [ ] **Step 1: Add AUTH-12 to AUTH-16** to the AUTH table in `SECURITY.md`, using the five control texts in the spec's "Controls to add" section, with framework refs `WEB-A01`, `WEB-A07`, `API1`, `API2`, `API4`, `API5`, `CWE-287`, `CWE-862`, `CWE-863`. Add a line to the AUTH "Key points" about tokens and read-only.
- [ ] **Step 2: Add a CHANGELOG entry** under Unreleased: personal API tokens, read-only by default, how to create one is added in the UI PR.
- [ ] **Step 3: Verify:** `yarn typecheck`, `yarn test`, `yarn build`. All exit 0.
- [ ] **Step 4: Run the `security-review` skill** on the branch and fix findings, then the Pre-PR Security Checklist in `SECURITY.md`.
- [ ] **Step 5: Commit** `docs: add the access token security controls (AUTH-12 to AUTH-16)`; open PR 1 (`Refs HOA-5, HOA-6`).

---

## PR 2: Settings UI

### Task 8: API client and hooks

**Files:**
- Modify: `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`
- Test: extend the existing client and queries tests in `app/lib/__tests__/`

**Interfaces:**
- Produces:
  - `interface AccessToken { tokenId: string; name: string; scope: 'read' | 'write'; createdAt: number; expiresAt: number | null; lastUsedAt: number | null; prefix: string }`
  - `createApi` gains `listAccessTokens(): Promise<AccessToken[]>`, `createAccessToken(input: { name: string; scope: 'read' | 'write'; expiryDays: 90 | 180 | 365 | 730 | null; password?: string }): Promise<{ token: string; record: AccessToken }>`, `revokeAccessToken(tokenId: string): Promise<void>`
  - `queryKeys.accessTokens`; hooks `useAccessTokens()`, `useCreateAccessToken()`, `useRevokeAccessToken()` (both mutations invalidate `queryKeys.accessTokens`)

- [ ] **Step 1: Write the failing tests** for the three client calls (method, path, body, `encodeURIComponent` on the id, the unwrapped return) and for the invalidation.
- [ ] **Step 2: Run** `yarn vitest run app/lib`. Expected: FAIL.
- [ ] **Step 3: Implement** following the `deleteTarget`/`useSetTarget` patterns.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the access token client calls and hooks (HOA-5)`.

### Task 9: The Access tokens section

**Files:**
- Create: `app/components/settings/AccessTokens.tsx`
- Test: `app/components/settings/__tests__/AccessTokens.test.tsx` (mock `~/lib/queries` hooks and `~/lib/auth` as `BillReminders.test.tsx` does)

**Interfaces:**
- Consumes: Task 8 hooks; `useAuth().mode` from `~/lib/auth`.
- Produces: `AccessTokens(): JSX.Element`.

- [ ] **Step 1: Write the failing tests:**
  - lists each token with its name, "Read only" or "Read and write" (text plus an icon), "Created …", "Expires …" or "Never expires", and "Last used …" or "Never used".
  - `'shows an empty state when there are no tokens'`.
  - create form defaults: access "Read only", expiry "90 days"; expiry offers 90, 180, 365 and 730 days and Never.
  - choosing "Read and write" shows a warning that the token can change data; choosing Never shows a warning that it stays valid until revoked.
  - the password field appears only when mode is `local` and access is "Read and write".
  - after creating, the full token is shown once with a Copy button and the words "You won't be able to see it again"; closing it removes it from the page (assert the token string is gone from `document.body`).
  - revoking asks for confirmation, then calls the mutation; cancelling does not.
  - a failed create shows the server's message (for example `Incorrect password`).
  - `expectNoViolations` and `expectSoundHeadings` from `~/test-utils/accessibility` pass, and the copy is readable (`expectReadable`).
- [ ] **Step 2: Run** `yarn vitest run app/components/settings`. Expected: FAIL.
- [ ] **Step 3: Implement** `AccessTokens.tsx` with Mantine components and theme tokens only; plain, calm wording; no motion.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the Access tokens section to Settings (HOA-5)`.

### Task 10: Put it on the Settings page and finish

**Files:**
- Modify: `app/routes/settings.tsx` (render `<AccessTokens />` in a `Card`, hidden when `isDemo`, like `BillReminders`), `CHANGELOG.md`
- Test: extend `app/routes/__tests__/settings.test.tsx`

- [ ] **Step 1: Write the failing tests:** the section appears on Settings; it does not appear when the demo flag is on.
- [ ] **Step 2: Run** `yarn vitest run app/routes/__tests__/settings.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page change; extend the CHANGELOG entry with where to find the section.
- [ ] **Step 4: Check the screenshots rule:** if Settings is one of the About-page images (`scripts/screenshots/`), run `yarn screenshots` and commit the changed images; otherwise note that it is not.
- [ ] **Step 5: Verify:** `yarn typecheck`, `yarn test`, `yarn build`, `yarn build:demo` and `node scripts/check-demo-build.mjs --demo build/demo/client` all pass. Run the `security-review` skill.
- [ ] **Step 6: Commit** `feat: show the Access tokens section on Settings (HOA-5)`; open PR 2 (`Closes HOA-5, HOA-6` once merged).
