# OpenAPI Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hand-written `docs/openapi.yaml` for every Hoardwise API route, with CI tests that fail when the spec drifts from the code.

**Architecture:** `Router` exposes its registered routes; the route wiring in `api-handler.ts` moves into an exported function so tests build the same routers. The spec is checked for validity, route parity (both ways), token-access parity, and a contract test that calls each operation against a `MemoryStore` and validates the response with Ajv.

**Tech Stack:** TypeScript, Vitest (api project), OpenAPI 3.1 YAML, `yaml` parser, an OpenAPI 3.1 validator, Ajv (2020-12 dialect). Yarn 1.

**Spec:** `docs/superpowers/specs/2026-10-30-openapi-spec-design.md`

## Global Constraints

- OpenAPI `3.1.0`; file at `docs/openapi.yaml`; no handler behaviour changes (an inconsistency is documented as the code behaves and noted in the task report).
- Amounts: integer pence/cents, positive, at most `MAX_AMOUNT_PENCE` (1,000,000,000); account balances use `pence`.
- Dates `YYYY-MM-DD`, months `YYYY-MM`, timestamps ISO 8601.
- Transaction types: `EXPENSE` = Spend, `INCOME` = Income, `SET_ASIDE` = Add to pot, `TAKE_OUT` = Take from pot. Budgets = category targets.
- Error body `{ "error": string }`; 429 also sends `Retry-After`.
- Every operation has `x-token-access: none | read | write`; `none` for `/api/tokens*` and `/api/push*`, `read` for GET, `write` for other methods on core routes.
- No credential-looking values in examples; tokens are `hwr_EXAMPLE` / `hww_EXAMPLE`.
- New dev dependencies are pinned exactly, at least two weeks old, and `yarn audit` must not gain findings. Conventional commits, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, reference control IDs where relevant.
- `/api/auth/*` is out of the spec.

## Review Focus

- A route registered twice or with the same template under two methods: parity must compare `method + template`, not just paths.
- A path parameter named differently in spec and router (`{yearMonth}` vs `{month}`): parity compares templates exactly.
- A spec example that is valid YAML but fails its own schema: the contract test must fail, not skip.
- `HEAD` on a GET route: documented in the overview, not as separate operations.
- A response schema with `additionalProperties` left open hiding a renamed field: response schemas use `additionalProperties: false` for stored records.

---

### Task 1: Expose routes and share the route wiring

**Files:**
- Modify: `src/api/router.ts`
- Create: `src/api/apiRoutes.ts`
- Modify: `api-handler.ts`
- Test: `src/api/__tests__/router.test.ts`, `src/api/__tests__/apiRoutes.test.ts`

**Interfaces:**
- Produces: `Router.routes(): { method: string; template: string }[]` (registration order); `registerApiRoutes(router: Router): void` in `src/api/apiRoutes.ts` registering core, push and token routes exactly as `api-handler.ts` does today.
- `api-handler.ts` calls `registerApiRoutes(router)` and behaves identically.

- [ ] **Step 1: Failing tests.** `router.test.ts`: `routes()` returns `[{method:'GET',template:'/api/a/{id}'}, {method:'POST',template:'/api/a'}]` after registering those two. `apiRoutes.test.ts`: `registerApiRoutes` on a fresh router yields 34 routes including `DELETE /api/tokens/{tokenId}` and `POST /api/push/subscriptions`.
- [ ] **Step 2: Run** `yarn vitest run src/api/__tests__/router.test.ts src/api/__tests__/apiRoutes.test.ts` — expect FAIL (`routes` / module missing).
- [ ] **Step 3: Implement** `routes()` on `Router` (store the template alongside each route), create `apiRoutes.ts` (move the five non-core registrations from `api-handler.ts`, call `registerCoreRoutes`), update `api-handler.ts`.
- [ ] **Step 4: Run** the two tests plus `yarn vitest run src/api/__tests__/apiHandler.test.ts src/api/__tests__/tokenRequests.test.ts` and `yarn typecheck` — expect PASS.
- [ ] **Step 5: Commit** `refactor: expose registered routes and share the API route wiring (HOA-7)`.

### Task 2: Tooling and the spec skeleton

**Files:**
- Modify: `package.json`, `yarn.lock`
- Create: `docs/openapi.yaml`, `src/api/__tests__/openapi.test.ts`, `src/api/__tests__/openapiSpec.ts` (shared helper: `loadSpec()` returns the parsed document; `operations()` returns `{ method, template, operation }[]` from `paths`)

**Interfaces:**
- Produces: `loadSpec(): OpenApiDocument`; `operations(spec): { method: string; template: string; operation: Record<string, unknown> }[]` for later tasks.

- [ ] **Step 1: Failing test** `openapi.test.ts` "is valid OpenAPI 3.1": loads `docs/openapi.yaml` and validates it with the chosen validator; also asserts `openapi === '3.1.0'`, and that `components.securitySchemes` has `bearerToken` and `sessionCookie`. Add the dev dependencies (`yarn add -D`, exact versions) before running.
- [ ] **Step 2: Run** `yarn vitest run src/api/__tests__/openapi.test.ts` — expect FAIL (file missing).
- [ ] **Step 3: Write the skeleton:** `info` (title, version `1.0.0`, `description` containing the amounts, dates, glossary, auth/token rules and error-shape prose from Global Constraints and SECURITY.md AUTH-12..16), `servers` (relative `/`), tags (categories, transactions, targets, pots, recurring, accounts, trash, push, tokens), `components.securitySchemes`, `components.schemas.Error`, shared parameters (`yearMonth`, `categoryId`, …) and shared responses (`Unauthorized`, `Forbidden`, `TooManyRequests` with `Retry-After`, `ValidationError`), and an empty `paths: {}`.
- [ ] **Step 4: Run** the test and `yarn audit --groups devDependencies` — expect PASS, no new findings.
- [ ] **Step 5: Commit** `docs: add the OpenAPI skeleton and its validity test (HOA-7)`.

### Task 3: Categories and targets

**Files:** Modify `docs/openapi.yaml`.
Source of truth: `src/api/categories.ts`, `reassign.ts`, `targets.ts`, `defaults.ts`, `src/api/types.ts`, and their tests under `src/api/__tests__/`.

**Interfaces:** Produces schemas `Category`, `CategoryInput`, `Target`, `TargetInput`, and operations for `/api/categories` (GET, POST), `/api/categories/{categoryId}` (PUT, DELETE), `/api/categories/{categoryId}/reassign` (POST), `/api/targets` (GET), `/api/targets/{categoryId}` (PUT, DELETE).

- [ ] **Step 1:** For each operation read the handler and record the request body rules, every status code it returns and its body, then write the operation with at least one `example` request and 2xx response, each error status it can return referencing `components.responses`.
- [ ] **Step 2:** Run `yarn vitest run src/api/__tests__/openapi.test.ts` — expect PASS (validity only; parity comes in Task 8).
- [ ] **Step 3: Commit** `docs: document the category and target routes (HOA-7)`.

### Task 4: Transactions and trash

**Files:** Modify `docs/openapi.yaml`.
Source: `transactions.ts`, `transactionsRange.ts`, `trash.ts`.

**Interfaces:** Produces `Transaction`, `TransactionInput`, `TrashItem`, and operations for `/api/transactions` (GET, POST), `/api/transactions/range` (GET), `/api/transactions/{yearMonth}/{transactionId}` (PUT, DELETE), `/api/trash` (GET), `/api/trash/restore` (POST). Query parameters (month, range bounds) taken from the handlers exactly.

- [ ] **Step 1:** As Task 3 Step 1. The `type` enum description repeats the glossary.
- [ ] **Step 2:** Run the validity test — PASS.
- [ ] **Step 3: Commit** `docs: document the transaction and trash routes (HOA-7)`.

### Task 5: Pots and recurring

**Files:** Modify `docs/openapi.yaml`.
Source: `pots.ts`, `potsCalc.ts`, `potArchive.ts`, `recurring.ts`.

**Interfaces:** Produces `PotSettings`, `PotInput`, `PotSummary`, `PotMonth`, `Recurring`, `RecurringInput`, and operations for `/api/pots` (GET), `/api/pots/{categoryId}` (PUT), `/api/pots/{categoryId}/archive|unarchive` (POST), `/api/recurring` (GET, POST), `/api/recurring/{recurringId}` (PUT, DELETE), `/api/recurring/{recurringId}/handled` (POST). `frequency` enum and `handledPeriod` key formats are described.

- [ ] **Step 1:** As Task 3 Step 1.
- [ ] **Step 2:** Run the validity test — PASS.
- [ ] **Step 3: Commit** `docs: document the pot and recurring routes (HOA-7)`.

### Task 6: Accounts, push and tokens

**Files:** Modify `docs/openapi.yaml`.
Source: `accounts.ts`, `push.ts`, `tokens.ts`, SECURITY.md (AUTH-12..16).

**Interfaces:** Produces `Account`, `AccountInput`, `BalanceInput`, `PushSubscriptionInput`, `AccessToken`, `NewAccessToken`, `CreateAccessTokenInput`, and operations for `/api/accounts` (GET, POST), `/api/accounts/{accountId}` (PUT, DELETE), `/api/accounts/{accountId}/balances` (POST), `/api/push/subscriptions` (POST, DELETE), `/api/tokens` (GET, POST), `/api/tokens/{tokenId}` (DELETE). Token create documents the password field for write tokens in local mode, the 25-token cap (409), `Cache-Control: no-store`, and that the secret is returned once.

- [ ] **Step 1:** As Task 3 Step 1. All `/api/tokens*` and `/api/push*` operations carry `x-token-access: none`.
- [ ] **Step 2:** Run the validity test — PASS.
- [ ] **Step 3: Commit** `docs: document the account, push and token routes (HOA-7)`.

### Task 7: Drift tests — route parity and token access

**Files:** Modify `src/api/__tests__/openapi.test.ts`.

**Interfaces:** Consumes `registerApiRoutes`, `createRouter`, `createTokenRouter`, `tokenAccessRejection`, `operations`.

- [ ] **Step 1: Failing/guard tests:**
  - "documents every registered route": every `{method, template}` from `registerApiRoutes(createRouter()).routes()` is in `operations(spec)`.
  - "has no operation without a route": the reverse.
  - "x-token-access matches the token router": for each operation, `none` iff its `method+template` is absent from `createTokenRouter().routes()`; for tokenable operations, `read` iff `tokenAccessRejection('read', method, path)` is undefined, else `write`; use the template with `{x}` substituted by `x`.
  - Negative check: a helper test proves the parity assertion fails when a route is removed from a copy of the spec (build the spec object in memory).
- [ ] **Step 2: Run** — expect PASS if Tasks 3-6 were complete; any miss shows as a named missing route.
- [ ] **Step 3: Commit** `test: fail CI when the OpenAPI spec drifts from the routes (HOA-7)`.

### Task 8: Contract test

**Files:** Create `src/api/__tests__/openapiContract.test.ts`; modify `docs/openapi.yaml` (add/fix `examples` and schemas the test shows to be wrong).

**Interfaces:** Consumes `loadSpec`, `operations`, `createRouter`/`registerApiRoutes`, `MemoryStore`, `setStore`, and an event builder (reuse the helper the existing API tests use, e.g. in `routes.test.ts`).

- [ ] **Step 1: Failing test.** Build a `MemoryStore` with a small household (categories from `defaults.ts`, one transaction, target, pot, recurring item, account). For each operation, take its `requestBody.content['application/json'].example` (or `examples.*.value`) and path/query `example` values, dispatch through the real router, and validate the response: status must be one the spec lists for the operation; for 2xx, the body validates against the operation's schema (resolve `$ref`s; Ajv 2020-12, `strict: false` only for `example`/`x-` keywords, no other relaxation). Run operations in an order that keeps state valid (create before update/delete; `DELETE` last), passing created IDs forward.
- [ ] **Step 2: Run** `yarn vitest run src/api/__tests__/openapiContract.test.ts` — expect FAIL listing schema errors.
- [ ] **Step 3: Fix the spec** (not the handlers) until the test passes. A genuine handler inconsistency is documented as it behaves and listed in the report.
- [ ] **Step 4: One error case per documented 4xx status** (400, 404, 409 where listed) is dispatched and validated against `Error`; assert the test fails if an operation lists a status that no case reaches (documented statuses must be exercised or marked `x-untested: <reason>`).
- [ ] **Step 5: Run** the full suite `yarn test` and `yarn typecheck` — expect PASS.
- [ ] **Step 6: Commit** `test: check every OpenAPI response against the real handlers (HOA-7)`.

### Task 9: Docs, changelog and security notes

**Files:** Modify `CHANGELOG.md`, `README.md` (link to the spec near the API/token mention, if one exists), `SECURITY.md` (note the spec/route parity test under the API controls if a matching control exists), `docs/superpowers/specs/2026-10-30-openapi-spec-design.md` (push routes are contract-tested, not skipped).

- [ ] **Step 1:** Add a CHANGELOG "Unreleased" line: "**API description.** `docs/openapi.yaml` describes every route (OpenAPI 3.1); tests fail if it drifts from the code."
- [ ] **Step 2:** Run `yarn test`, `yarn typecheck`; expect PASS.
- [ ] **Step 3: Commit** `docs: announce the OpenAPI spec (HOA-7)`.
