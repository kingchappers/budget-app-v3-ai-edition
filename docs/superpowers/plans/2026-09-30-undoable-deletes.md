# Undoable Deletes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every delete of a transaction, target, recurring item or account recoverable: the item disappears at once, a toast offers Undo, and a Recently deleted page keeps it for 30 days (ST1, ST4, PC6).

**Architecture:** The API moves a deleted item to a `TRASH#` record in one DynamoDB transaction and gains `GET /api/trash` and `POST /api/trash/restore`. The client removes the item from the query cache optimistically, shows one shared undo toast, and adds a Recently deleted route.

**Tech Stack:** React 19, React Router 8, Mantine 8, TanStack Query 5, Vitest 4 + Testing Library, AWS Lambda (Node 24), DynamoDB, TypeScript strict, yarn.

**Spec:** `docs/superpowers/specs/2026-09-30-undoable-deletes-design.md`

## Global Constraints

- No infra, IAM or dependency changes. JWT validation in `api-handler.ts` is untouched (AUTH-01). Validate all restore input (IO-01, IO-07).
- Existing DELETE routes keep their paths and `204` responses.
- Do not change `ToastAction` or `TOAST_MS` (another PR in this wave owns them).
- Offline pending entries keep their Discard action.
- Explicit parameter and return types, early returns, small functions, no comments that restate code, no empty catch blocks, errors logged with context.
- Copy: British English, plain and neutral, no exclamation marks, no blame, no red for ordinary data.
- TDD: write the failing test, watch it fail, implement, watch it pass. `yarn test` and `yarn typecheck` clean before each commit.

## Review Focus

1. The soft delete is one transaction, conditioned so a vanished item never leaves an orphan trash record. (Task 1.)
2. Restore never overwrites an existing item (409) and never restores an expired record (404). (Task 1.)
3. `PK`, `SK` and `originalSk` never reach the client. (Task 1.)
4. A failed delete always puts the row back, and Undo before the delete settles still restores. (Tasks 3 and 4.)

---

### Task 1: Trash module and soft deletes (API)

**Files:**
- Create: `src/api/trash.ts`, `src/api/__tests__/trash.test.ts`
- Modify: `src/api/transactions.ts`, `src/api/targets.ts`, `src/api/recurring.ts`, `src/api/accounts.ts`, `src/api/http.ts`, their tests, `api-handler.ts`

- [ ] Write failing tests in `trash.test.ts` for `validateRestoreInput` (non-object, missing fields, unknown entity type, bad id, bad transaction id, extra field), `moveToTrash` (transaction shape: conditioned `Delete` plus `Put` of `TRASH#TRANSACTION#2026-09#t1` with `entityType`, `originalSk`, `item` without keys, ISO `deletedAt`, `expiresAt` 30 days on; missing item writes nothing; a cancelled transaction is treated as already deleted), `getTrash` (drops expired, newest first, no keys) and `restoreFromTrash` (200 shape, 409 on the original's condition, 404 on a missing or expired record, 400 on bad input).
- [ ] Implement `src/api/trash.ts` (it owns the `TRASH#` key format) and move `parseJsonObject` into `http.ts` so both it and `recurring.ts` share it.
- [ ] Update the four delete handlers' tests to expect the transaction shape (mock `GetCommand` and `TransactWriteCommand`), then switch the handlers to `moveToTrash`.
- [ ] Register the two routes in `api-handler.ts`.
- [ ] Commit: `feat: move deleted items to a 30-day trash (ST1, PC6, IO-01)`.

### Task 2: Client API, queries and trash helpers

**Files:**
- Create: `app/lib/trash.ts`, `app/lib/__tests__/trash.test.ts`, `app/lib/__tests__/deleteMutations.test.tsx`
- Modify: `app/lib/api.ts`, `app/lib/queries.ts`, `app/lib/__tests__/api.test.ts`

- [ ] Tests: `getTrash`/`restoreFromTrash` call the right endpoints; `groupTrash` orders groups and drops empty ones; `trashEntryLabel` describes each type; each delete mutation removes the item from the cache at once and puts it back on failure; `useRestoreFromTrash` invalidates the trash and the entity's list.
- [ ] Implement.
- [ ] Commit: `feat: add trash queries and optimistic deletes (ST1)`.

### Task 3: Shared undo toast

**Files:**
- Create: `app/hooks/useUndoableDelete.tsx`, `app/hooks/__tests__/useUndoableDelete.test.tsx`

- [ ] Tests: shows `Deleted … ` with Undo; Undo restores once the delete settles; a failed delete shows `Couldn't delete <name>. It's still here.` and offers no Undo; a failed restore says where the item is.
- [ ] Implement with `ToastAction` and `TOAST_MS`.
- [ ] Commit: `feat: add undo toast for deletes (ST1, PC6)`.

### Task 4: Transactions, targets, recurring and accounts

**Files:**
- Modify: `app/routes/transactions.tsx`, `app/routes/targets.tsx`, `app/routes/recurring.tsx`, `app/routes/accounts.tsx` and their tests

- [ ] Transactions: Delete uses the undo hook; tests for hide, Undo and failure put back.
- [ ] Targets: `Remove target` in a card menu with the undo hook; inputs follow the saved value.
- [ ] Recurring: remove the dialog; delete uses the undo hook.
- [ ] Accounts: dialog states the balance entry count in its button; delete uses the undo hook.
- [ ] Commit per route: `feat: …` naming ST1, ST4 or PC6.

### Task 5: Recently deleted page

**Files:**
- Create: `app/routes/deleted.tsx`, `app/routes/__tests__/deleted.test.tsx`
- Modify: `app/components/layout/MoreSheet.tsx`

- [ ] Tests: lists grouped items with when they were deleted; Restore calls restore with the entry's type and id; empty state; intro line.
- [ ] Implement and add `{ to: '/deleted', label: 'Recently deleted' }` to `MORE_ITEMS`.
- [ ] Commit: `feat: add Recently deleted page (ST1, PC6)`.

### Task 6: Verification

- [ ] `yarn test`, `yarn typecheck`, and the build with dummy `VITE_AUTH0_*` values.
- [ ] Browser check outside the repo: stubbed Auth0 cache, canned `/api/*`, 390px and 1280px, light and dark, keyboard only.
- [ ] Rebase onto `origin/main`, repeat the checks, push, open a draft PR.
