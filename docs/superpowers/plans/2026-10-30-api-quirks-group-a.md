# API Quirks, Group A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four handler quirks with an unambiguous fix (HOA-42, HOA-43, HOA-45, and the wrong message in HOA-49), updating `docs/openapi.yaml` in the same commits so the drift and contract tests stay green.

**Architecture:** Each task changes handler code and the spec together, test first. The OpenAPI contract test (`src/api/__tests__/openapiContract.test.ts`) is the net: it must pass after every task, and the generic cases it already runs for 401/403/429/500 get new generic cases for non-object bodies and HEAD.

**Tech Stack:** TypeScript, Vitest (api project), OpenAPI 3.1 YAML.

**Spec:** the Linear issues HOA-42, HOA-43, HOA-45 and HOA-49 (the design was agreed in chat: fix as described in each issue; behaviour decisions in HOA-44/46/47/48 and the rest of HOA-49 are out of scope). The spec file `docs/openapi.yaml` and its three test files are binding for what "done" means.

## Global Constraints

- Work on branch `fix/HOA-42-api-quirks`, stacked on `feat/HOA-7-openapi` (PR #117). Do not switch branches.
- Handler fixes change only what the issue names. No response shape changes other than the ones listed; no new routes.
- TDD: write the failing test first, see it fail for the stated reason, then fix.
- After every task `yarn vitest run src/api/__tests__/openapi.test.ts src/api/__tests__/openapiDrift.test.ts src/api/__tests__/openapiContract.test.ts` and the task's own tests pass; before the last commit of a task `yarn test` and `yarn typecheck` pass.
- Update `docs/openapi.yaml` in the same task as the code it describes (prose, schemas, examples, status lists, and remove the "quirk" notes the fix makes untrue). Do not leave the spec describing the old behaviour.
- Conventional commits, subject under 72 characters, reference the HOA number and SECURITY.md control IDs where relevant (IO-01 for input validation). Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `git add` specific files; never commit `.superpowers`.
- Existing error messages and status codes stay unless the task says otherwise (`Invalid JSON body` is the 400 message for an unparseable or non-object body).

## Review Focus

- A request body of `null`, `[]`, `"text"`, `123`, `true`, an empty body and malformed JSON on every route that reads a JSON body must answer 400 (not 500), and must not change what a valid object body does.
- `HEAD` on a path with a parameter works like GET with an empty body; `HEAD` on a path that only has write methods (for example `/api/categories/{categoryId}/reassign`) and on an unknown path stays 404.
- Mapped list records keep every field the app reads (compare with `app/lib/types.ts`) and still tolerate legacy rows (a missing optional field, `createdAt` of `''`); no `PK`/`SK` appear.
- A read-scope access token sending `HEAD` reaches the handler and gets the GET status with an empty body; a write-scope token and the session path behave the same.
- The new message for the account balance endpoint matches the rule the code really enforces (check `isValidPence`), including zero and negative values.

---

### Task 1: Non-object JSON bodies answer 400 (HOA-42)

**Files:**
- Modify: `src/api/accounts.ts`, `categories.ts`, `pots.ts`, `reassign.ts`, `targets.ts`, `transactions.ts` (each replaces its own `JSON.parse(event.body || '{}')` + try/catch with `parseJsonObject` from `./http`)
- Modify: `docs/openapi.yaml`, `src/api/__tests__/openapiContract.test.ts`
- Test: `src/api/__tests__/jsonBody.test.ts` (new)

**Interfaces:**
- Consumes: `parseJsonObject(event): Record<string, unknown> | null` (`src/api/http.ts`), already used by recurring, tokens, push, trash, potArchive.
- Produces: every JSON-body route returns `400 {"error":"Invalid JSON body"}` for a body that is not a JSON object (null, array, string, number, boolean, malformed). Use the route's existing 400 message where one already exists for a malformed body; otherwise `Invalid JSON body`.

- [ ] **Step 1: Failing test** `jsonBody.test.ts`: build the router with `registerApiRoutes` and a `MemoryStore` (see `apiRoutes.test.ts` / `routes.test.ts` for helpers), seed one category, transaction, target, pot, account and recurring item, then for each of the 14 write operations that read a JSON body (list them from `docs/openapi.yaml` operations with a `requestBody`, via `operations(loadSpec())`, so a new route is covered automatically) and each bad body in `['null', '[]', '"text"', '123', 'true', '{']` assert status 400 and body `{ error: string }`. Also assert an empty body on a route that requires fields still gives its normal field 400, not a 500.
- [ ] **Step 2: Run** `yarn vitest run src/api/__tests__/jsonBody.test.ts` — expect FAIL for the routes that return 500 today (`createCategory`, `updateCategory`, `reassignCategory`, `upsertTarget`, `createTransaction`, `updateTransaction`, `putPot`, `createAccount`, `updateAccount`, `addBalance`).
- [ ] **Step 3: Implement** the replacement in each handler (`parseJsonObject`; return `err(400, 'Invalid JSON body')` when null). Keep field validation order and messages unchanged for object bodies.
- [ ] **Step 4: Spec and contract test:** every operation with a `requestBody` documents `400` (ref `ValidationError`, or its inline 400 where it has one); remove the overview sentence and the per-operation notes that say `null` gives 500 (HOA-42), and the `putPot` null-body note; in `openapiContract.test.ts` add a generic case that sends the bad bodies above to every operation with a request body and expects 400 with the `Error` schema, so the documented 400 is exercised.
- [ ] **Step 5: Run** the three OpenAPI test files, `jsonBody.test.ts`, then `yarn test` and `yarn typecheck` — expect PASS.
- [ ] **Step 6: Commit** `fix: answer 400 for a JSON body that is not an object (HOA-42, IO-01)`.

### Task 2: List routes return public records only (HOA-43)

**Files:**
- Modify: `src/api/targets.ts` (`getTargets`), `src/api/transactions.ts` (`getTransactions`), `src/api/transactionsRange.ts` (`getTransactionsRange`); put the small `toTarget` / `toTransaction` mappers beside the handlers that need them (follow how `toAccount` and `toRecurring` are done).
- Modify: `docs/openapi.yaml` (collapse `StoredTarget` into `Target` and `StoredTransaction` into `Transaction`; update list examples and descriptions; delete the "raw items include PK/SK" notes)
- Test: `src/api/__tests__/targets.test.ts`, `transactions.test.ts`, `transactionsRange.test.ts`

**Interfaces:**
- Produces: `GET /api/targets` → `{ targets: CategoryTarget[] }` with exactly `categoryId, targetAmount, period, updatedAt`; `GET /api/transactions` and `/range` → `{ transactions: Transaction[] }` with exactly the fields of the `Transaction` type in `src/api/types.ts` (`recurringId` only when present). No `PK`, `SK` or other storage fields.

- [ ] **Step 1: Failing tests:** in each of the three test files assert the list response items contain no `PK` or `SK` and equal the mapped shape (`toEqual` on the full object, so an extra key fails). Add a legacy-row case for transactions (item stored without `recurringId`, and one with `createdAt: ''`) that still maps without throwing.
- [ ] **Step 2: Run** the three files — expect FAIL (keys present).
- [ ] **Step 3: Implement** the mappers and use them in the three handlers. Before choosing the field list, check `app/lib/types.ts` and grep `app/` for fields read from these list responses so nothing the app uses is dropped; also check `src/demo/` seeds still work.
- [ ] **Step 4: Spec:** the list responses reference `Transaction` / `Target`; remove the two `Stored*` schemas; the contract test must pass with `additionalProperties: false`.
- [ ] **Step 5: Run** the OpenAPI tests, the three handler test files, then `yarn test` and `yarn typecheck`; if any app test fixtures break because they assumed `PK`/`SK`, fix the fixtures, not the handler.
- [ ] **Step 6: Commit** `fix: stop returning storage keys from the target and transaction lists (HOA-43)`.

### Task 3: HEAD answers like GET (HOA-45)

**Files:**
- Modify: `src/api/router.ts` (`dispatch`)
- Modify: `docs/openapi.yaml` (overview HEAD note, `x-token-access` descriptions that say HEAD is not served), `src/api/__tests__/openapiContract.test.ts`
- Test: `src/api/__tests__/router.test.ts`, `src/api/__tests__/tokenRequests.test.ts`

**Interfaces:**
- Produces: `Router.dispatch` treats a `HEAD` request for a path that has a registered `GET` route as that GET: same status and headers, body `''`. A path with no GET route (including write-only paths) and an unknown path stay `404 {"error":"Endpoint not found"}`. `Router.routes()` still lists only the registered methods (HEAD is not registered, so route-parity tests are unchanged).

- [ ] **Step 1: Failing tests:** `router.test.ts`: `HEAD /api/a/{id}` with a registered GET returns the GET's status and headers and `body === ''`, the handler runs once; `HEAD` on a POST-only path and on an unknown path returns 404; `GET` behaviour unchanged. `tokenRequests.test.ts`: a read-scope token sending `HEAD /api/categories` through `handler` gets 200 with an empty body, and `HEAD /api/tokens` with a token still gets 403 (token management is session-only). Contract test: a generic case sends `HEAD` to every `GET` operation and expects the same status as GET and an empty body.
- [ ] **Step 2: Run** those tests — expect FAIL (404 today).
- [ ] **Step 3: Implement** in `dispatch`: for method `HEAD`, resolve with `GET` and blank the body. Check that the container adapter (`container/adapter.ts`) and the Lambda paths pass `HEAD` through (API Gateway route keys are in `infra/api-lambda.tf`; if the gateway route does not forward `HEAD`, note it in your report and do not change infra in this task).
- [ ] **Step 4: Spec:** remove "HEAD is not served" statements; state that `HEAD` on any `GET` operation returns the same status and headers with no body (and that HEAD is not listed as separate operations); keep the read-token wording (GET and HEAD).
- [ ] **Step 5: Run** the OpenAPI tests, router and token tests, `yarn test`, `yarn typecheck` — expect PASS. Also run `node scripts/container-smoke.mjs` only if it needs no Docker (skip and say so otherwise).
- [ ] **Step 6: Commit** `fix: answer HEAD requests on GET routes (HOA-45)`.

### Task 4: Accurate message for the balance amount (HOA-49, message only)

**Files:**
- Modify: `src/api/accounts.ts` (the `pence` 400 message in `addBalance`), `docs/openapi.yaml` (the `addBalance` 400 description/example and the note that the message is misleading), `src/api/__tests__/accounts.test.ts`

**Interfaces:**
- Produces: the 400 message states the rule `isValidPence` really enforces (a whole number; read the function for whether zero and negative values are allowed and the bounds) and no longer says "positive integer" if that is untrue.

- [ ] **Step 1: Failing test:** `addBalance` with `pence: 1.5` and `pence: 'x'` returns 400 with the new message (asserted exactly), and `pence: 0` and a negative whole number still succeed (document the existing behaviour with a test if none exists).
- [ ] **Step 2: Run** `yarn vitest run src/api/__tests__/accounts.test.ts` — expect FAIL on the message.
- [ ] **Step 3: Implement** the message change only. Do not change the validation or the validation order.
- [ ] **Step 4: Spec:** update the operation's 400 description and example; remove the "message says positive but zero and negative are accepted" caveat.
- [ ] **Step 5: Run** the OpenAPI tests, `accounts.test.ts`, `yarn test`, `yarn typecheck` — expect PASS.
- [ ] **Step 6: Commit** `fix: describe the balance amount rule accurately in the error (HOA-49)`.
