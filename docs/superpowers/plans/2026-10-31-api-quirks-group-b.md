# API Quirks, Group B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the behaviour decisions the user approved for HOA-44, HOA-46, HOA-47, HOA-48 and the rest of HOA-49, updating `docs/openapi.yaml` in the same commit as each change.

**Architecture:** One task per issue. Each task changes handlers, tests (first), the spec, and the app only where a caller depends on the old behaviour. The OpenAPI contract test (`src/api/__tests__/openapiContract.test.ts`) must pass after every task; documented statuses must each be provoked by a contract case (the existing rule), so new statuses in the spec need new cases.

**Tech Stack:** TypeScript, Vitest (api project), OpenAPI 3.1 YAML.

**Spec:** the approved decisions below (numbered as they were presented to the user) plus Linear issues HOA-44, HOA-46, HOA-47, HOA-48, HOA-49. `docs/openapi.yaml` and its test files define done.

## Approved decisions (binding)

1. `DELETE` of an unknown category or target stays **204**; document it as deliberate (idempotent delete).
2. Category delete stays a hard delete (documented).
3. `PUT /api/targets/{categoryId}` for a category that does not exist → **404**. Built-in default categories (not stored) count as existing.
4. `POST /api/transactions` with an existing client `transactionId` keeps replacing the record; document as idempotent create (the offline queue replays creates with the entry's own id).
5. `categoryId` and `recurringId` stay unchecked on transactions (orphans are tolerated); document it.
6. Reject non-calendar dates (`2026-13-45`) with 400; use a strict `YYYY-MM` for the month-list `year`/`month` (`2026x` → 400); same strictness for the `yearMonth` path segment on PUT/DELETE.
7. `PUT /api/transactions/...` accepts `"recurringId": null` to unlink; omitting it keeps the link.
8. Archive removing the current month's contribution is as designed (document).
9. Un-archiving a pot that is not archived → **409**.
10. `PUT /api/pots/{categoryId}` on an archived pot → **409** ("unarchive it first").
11. Un-archive does not restore auto-contribute or the trashed reminders (reminders come back from Trash); document only.
12. Archive atomicity by ordering: trash the category's reminders first, then save the archived settings, so a failure part-way leaves the pot active and a retry is safe. No transaction needed.
13. Recurring `PUT` stays a full replace; an omitted `frequency` stays MONTHLY (documented).
14. A frequency change clears `handledPeriod`.
15. `POST /api/recurring/{recurringId}/handled`: the period key format must match the item's frequency (`YYYY-MM` for MONTHLY, a real `YYYY-MM-DD` otherwise); the id is checked before the body (404 before 400).
16. `DELETE /api/tokens/{tokenId}` → **204** (was 200 `{}`). Tokens are unreleased, so no outside clients.
17. One rule everywhere: look the record up first (404), then validate the body. Account balances (`addBalance`) and `/handled` change; account PUT already does this.
18. Token create keeps `expiryDays` required and the password check before the 25-token cap (spec wording only).

## Global Constraints

- Branch `fix/HOA-44-api-behaviour`, stacked on `fix/HOA-42-api-quirks` (PR #118). Do not switch branches.
- TDD: write the failing test first, show it red for the stated reason, then change the code.
- After each task the three OpenAPI test files, `jsonBody.test.ts` and the task's own tests pass; before the last commit of a task `yarn test` and `yarn typecheck` pass.
- Update `docs/openapi.yaml` in the same task: status lists, descriptions, examples, schemas; remove the "quirk" notes the change makes untrue; where a decision keeps a behaviour, replace the quirk note with wording that says it is deliberate. Every documented status needs a contract case (or `x-untested` with a reason).
- Keep error messages and codes unchanged unless the decision changes them. No new routes. Check `app/` (and `src/demo/`) for any caller that depends on the old behaviour and update it in the same task, with tests.
- Conventional commits, subject under 72 characters, HOA number, IO-01 where input validation changes. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `git add` specific files; never commit `.superpowers` or `infra/*.zip`.
- Today's date for fixtures: the contract test fakes the clock to 2026-10-30; keep new examples valid for that date.

## Review Focus

- Existing stored data must keep working: date validation must not make existing stored transactions unreadable (validation applies to writes only); an archived pot's existing settings still load; `handledPeriod` clearing must not touch other fields.
- The offline queue still replays: a `createTransaction` replay with an existing id still succeeds (decision 4); the app's flows for archive, unarchive, pot edit, recurring edit/handled, token revoke and account balance still work (find and run the app tests that cover them).
- 404-before-400 ordering: an unknown id with a bad body is 404; a known id with a bad body is 400.
- Default categories (not stored) count as existing for the target PUT; a custom category that is deleted does not.
- `HEAD`/GET behaviour from Group A is untouched.

---

### Task 1: Targets (HOA-44, decisions 1-3)

**Files:** `src/api/targets.ts`, `src/api/categories.ts` (only to reuse the existing-category lookup; do not duplicate it), `docs/openapi.yaml`, `src/api/__tests__/targets.test.ts`, `src/api/__tests__/openapiContract.test.ts`

**Interfaces:** Consumes `findCategory(userId, categoryId)` from `src/api/pots.ts` if it counts default categories, otherwise add a small shared helper beside it (check how `reassign.ts` and `potArchive.ts` find a category and reuse that). Produces: `PUT /api/targets/{categoryId}` returns `404 {"error":"Category not found"}` for an unknown category; known and default categories unchanged.

- [ ] **Step 1: Failing tests** in `targets.test.ts`: PUT for an unknown id → 404 with that message and no target stored; PUT for a default category id (e.g. `cat-groceries`, check `defaults.ts`) → 200; PUT for a stored custom category → 200; DELETE of an unknown target → 204 (pins decision 1).
- [ ] **Step 2: Run** the file — expect FAIL on the unknown-id case.
- [ ] **Step 3: Implement** the existence check before the body is read (decision 17: look the record up first, then validate the body), keeping the existing body validation and messages after it.
- [ ] **Step 4: Spec:** add 404 to `upsertTarget` (with a contract case); `deleteTarget` and `deleteCategory` descriptions say a delete of an unknown id is a deliberate 204 and that category delete is a hard delete with nothing in the trash; remove the quirk notes.
- [ ] **Step 5: Run** OpenAPI tests, `targets.test.ts`, then `yarn test` and `yarn typecheck`.
- [ ] **Step 6: Commit** `fix: return 404 when setting a target on an unknown category (HOA-44)`.

### Task 2: Transactions (HOA-46, decisions 4-7)

**Files:** `src/api/transactions.ts`, `src/api/accounts.ts` and a new small shared helper (suggested `src/api/dates.ts` exporting `isCalendarDate(value: unknown): value is string` and `isYearMonth(value: unknown): value is string`; accounts already has a local `isValidDate` — check whether it is a real calendar check and move it rather than duplicating), `docs/openapi.yaml`, `src/api/__tests__/transactions.test.ts`, `src/api/__tests__/openapiContract.test.ts`

**Interfaces:** Produces `isCalendarDate` / `isYearMonth`; `getTransactions` returns 400 `Invalid year or month` for non-digit `year`/`month` (strict `^\d{4}$`, `^\d{1,2}$` with 1-12 and year ≥ 2000); `validateTransactionInput` returns 400 `date must be a real YYYY-MM-DD date` for `2026-13-45`; the PUT/DELETE `yearMonth` path segment must be a real `YYYY-MM` (existing message `yearMonth must be in YYYY-MM format`); PUT accepts `recurringId: null` (unlink) and keeps the stored link when omitted.

- [ ] **Step 1: Failing tests:** `GET ?year=2026x&month=10` → 400; `?year=2026&month=1x` → 400; `date: '2026-13-45'`, `'2026-02-30'` → 400 on POST and PUT; `yearMonth` `2026-13` on PUT/DELETE → 400; PUT with `recurringId: null` unlinks, omitted keeps, a UUID sets; POST with an existing `transactionId` replaces and returns 201 (pins decision 4); POST with an unknown `categoryId` succeeds (pins decision 5); reading a stored transaction whose date is odd still lists (writes only are validated).
- [ ] **Step 2: Run** — expect FAIL on the new cases.
- [ ] **Step 3: Implement** as in Interfaces. Keep messages for already-covered cases.
- [ ] **Step 4: Spec:** document the stricter rules and the new 400s; describe POST-with-existing-id as an idempotent create that replaces (state why: retries); state that `categoryId`/`recurringId` are not checked against existing records; document `recurringId: null` on PUT; update examples and contract cases.
- [ ] **Step 5: Run** OpenAPI tests, `transactions.test.ts`, `accounts.test.ts`, the app tests that cover transaction create/edit and the offline queue (`app/lib/__tests__/flushQueue.test.ts`, `transactionMutations.test.tsx`), `yarn test`, `yarn typecheck`.
- [ ] **Step 6: Commit** `fix: validate transaction dates and months strictly (HOA-46, IO-01)`.

### Task 3: Pots (HOA-47, decisions 8-12)

**Files:** `src/api/pots.ts` (`putPot`), `src/api/potArchive.ts` (`archivePot`, `unarchivePot`), `docs/openapi.yaml`, `src/api/__tests__/pots.test.ts`, `src/api/__tests__/potArchive.test.ts`, `src/api/__tests__/openapiContract.test.ts`

**Interfaces:** Produces: `unarchivePot` → `409 {"error":"This pot is not archived"}` when the pot has no settings or `archivedAt` is null; `putPot` → `409 {"error":"Unarchive this pot before changing it"}` when `archivedAt` is set; `archivePot` trashes reminders **before** saving the archived settings and, if trashing throws part-way, saves nothing (pot stays active) — a retry trashes the remainder and succeeds.

- [ ] **Step 1: Failing tests:** unarchive of a never-configured pot and of an active pot → 409, and no settings are created or `updatedAt` changed; unarchive of an archived pot still → 200 with `archivedAt: null`; `putPot` on an archived pot → 409 and settings unchanged; `putPot` on an active pot unchanged; archive: with two reminders and `moveToTrash` made to throw on the second (use a store wrapper or `vi.spyOn`), the response is 500 (unhandled) or the existing error path, the pot is NOT archived, and a second archive call succeeds and trashes all reminders (idempotent retry); archive success order and `cancelledRecurring` count unchanged.
- [ ] **Step 2: Run** — expect FAIL on the new cases.
- [ ] **Step 3: Implement** the guards and the reorder. Check `app/components/pots/ArchivePotSection.tsx`, the pots edit UI and `app/lib/queries.ts` so the app never calls `putPot` on an archived pot or unarchive on an active one; if it can, handle the 409 in the UI with a calm message and a test.
- [ ] **Step 4: Spec:** add the two 409s with contract cases; describe archive's ordering and retry safety; keep the "month gets no automatic contribution" wording and state that un-archive restores neither auto-contribute nor reminders (reminders return from Trash); remove the quirk notes.
- [ ] **Step 5: Run** OpenAPI tests, the pot tests, app pot tests, `yarn test`, `yarn typecheck`.
- [ ] **Step 6: Commit** `fix: guard pot archive, unarchive and edit state (HOA-47)`.

### Task 4: Recurring (HOA-48, decisions 13-15)

**Files:** `src/api/recurring.ts`, `docs/openapi.yaml`, `src/api/__tests__/recurring.test.ts`, `src/api/__tests__/openapiContract.test.ts`

**Interfaces:** Produces: `updateRecurring` sets `handledPeriod: null` when the new frequency differs from the stored one (a frequency-unchanged PUT keeps it); `setRecurringHandled` looks up the id first (404) then validates the period: for a MONTHLY item the body period must be `YYYY-MM`, for others a real `YYYY-MM-DD`, else 400 with a message naming the expected format.

- [ ] **Step 1: Failing tests:** PUT changing MONTHLY→WEEKLY on an item with `handledPeriod: '2026-10'` returns `handledPeriod: null`; PUT with the same frequency keeps it; `/handled` on an unknown id with a bad body → 404; on a known MONTHLY item with `2026-10-15` → 400, with `2026-10` → 200; on a WEEKLY item with `2026-10` → 400, with `2026-10-15` → 200, with `2026-02-30` → 400; omitted `frequency` on PUT still means MONTHLY (pins decision 13).
- [ ] **Step 2: Run** — expect FAIL on the new cases.
- [ ] **Step 3: Implement.** Reuse `isCalendarDate` from Task 2's `src/api/dates.ts` if it exists in the branch history (it does after Task 2).
- [ ] **Step 4: Spec:** update the PUT and `/handled` descriptions, statuses (404 order), examples, and contract cases; state that PUT is a full replace and an omitted `frequency` means MONTHLY.
- [ ] **Step 5: Run** OpenAPI tests, `recurring.test.ts`, app recurring tests (find with grep on `handled`), `yarn test`, `yarn typecheck`.
- [ ] **Step 6: Commit** `fix: keep recurring handled periods consistent with the schedule (HOA-48)`.

### Task 5: Revoke status and body ordering (HOA-49 rest, decisions 16-18)

**Files:** `src/api/tokens.ts` (`revokeAccessToken`), `src/api/accounts.ts` (`addBalance` order), `docs/openapi.yaml`, `app/lib/api.ts` / `app/lib/queries.ts` (only if the client depends on the 200 body), `src/api/__tests__/tokens.test.ts`, `src/api/__tests__/accounts.test.ts`, `container/__tests__/server.test.ts` (if it asserts the revoke status), `src/api/__tests__/openapiContract.test.ts`

**Interfaces:** Produces: `DELETE /api/tokens/{tokenId}` → `204` with no body and the same `Cache-Control: no-store` as the other token routes; unknown or non-UUID id still 404. `addBalance`: unknown account → 404 even when the body is invalid; known account + invalid body → 400.

- [ ] **Step 1: Failing tests:** revoke returns 204 and an empty body (assert header `Cache-Control: no-store` kept); unknown id → 404; `addBalance` with a bad `pence` on an unknown account → 404, on a known account → 400 with the Task 4 (Group A) message; account PUT order unchanged.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Check `app/lib/api.ts` `revokeAccessToken` and its mutation (`queries.ts` ~line 559) handle a 204 (other deletes already return 204 so the client's empty-body path should exist); update the client and its tests if not.
- [ ] **Step 4: Spec:** revoke documents 204 (no content, `Cache-Control: no-store`); `addBalance` documents the 404-then-400 order; token create wording states `expiryDays` is required (null = never expires) and that the password check precedes the 25-token cap (decision 18, wording only); remove the quirk notes.
- [ ] **Step 5: Run** OpenAPI tests, the touched api/app/container tests, `yarn test`, `yarn typecheck`.
- [ ] **Step 6: Commit** `fix: answer 204 for token revoke and check the account before the body (HOA-49)`.
