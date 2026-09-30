# Honest Saves Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Build test-first: write the failing test, watch it fail, make it pass.

**Goal:** Every save tells the truth: saving, saved, or couldn't save with Retry. Typed input survives a failure, undo notifications stay until dismissed, and sync errors are readable without a tooltip.

**Architecture:** A new presentational `SaveStatus` component carries the three outcome states inside a polite live region. Forms keep a local `SaveState` and move to it from `mutate`'s `onSuccess`/`onError` callbacks. `useSaveWithUndo` shows one notification per save, updates it in place from "Saving…" to "Saved", never auto-closes it, and hides the previous save's notification when a new save starts. `TransactionRow` gets visible "Saving", "Waiting to sync" and "Not synced" text, with a Retry button wired to `useOfflineQueue().flushNow`.

**Tech Stack:** React 19, Mantine 8 (`@mantine/notifications`), TanStack Query 5, Vitest + Testing Library, Playwright (browser verification only, never committed).

**Spec:** `docs/superpowers/specs/2026-09-30-honest-saves-design.md`

## Global Constraints

- Explicit parameter and return types; early returns; no comments that restate code; no empty catch blocks; log errors with context.
- Frontend only. No change to `api-handler.ts`, `src/api/*` or `infra/` (AUTH-01 untouched).
- Copy: British English, plain, no exclamation marks, no blame, no red for ordinary states.
- Don't touch delete flows other than the category-delete messages.

---

### Task 1: SaveStatus component

**Files:** Create `app/components/layout/SaveStatus.tsx`, test `app/components/layout/__tests__/SaveStatus.test.tsx`.

- [ ] Test: idle renders an empty `role="status"`; saving shows "Saving…"; saved shows "Saved"; error shows "Couldn't save." and a Retry button that calls `onRetry`.
- [ ] Implement.
- [ ] Commit `feat: add inline SaveStatus component (ST9)`.

### Task 2: Targets show saving, saved, failed and unsaved

**Files:** `app/routes/targets.tsx`, `app/routes/__tests__/targets.test.tsx`.

- [ ] Test: changing /mo to /wk shows "Not saved yet"; Save calls `mutate` and success shows "Saved"; failure shows "Couldn't save." keeps the typed value and Retry sends it again.
- [ ] Implement `isDirty` and wire `SaveStatus`.
- [ ] Commit `fix: show saving, saved and failed states on targets (ST9)`.

### Task 3: Categories and accounts keep the name until the create succeeds

**Files:** `app/routes/categories.tsx`, `app/routes/accounts.tsx`, their tests.

- [ ] Test: failure keeps the name and shows "Couldn't save." with Retry; success clears it and shows "Saved".
- [ ] Implement with `mutate` callbacks.
- [ ] Commit `fix: keep typed name until create succeeds (ST2)`.

### Task 4: Category delete reports each step

**Files:** `app/routes/categories.tsx`, its test.

- [ ] Test: reassign fails → "Couldn't move the transactions to …"; delete fails after reassign → "Transactions moved to Groceries; the category wasn't deleted. Try again."
- [ ] Implement with two try/catch blocks, logging each with context.
- [ ] Commit `fix: report category reassign and delete separately (ST2)`.

### Task 5: Pot settings and update balance use SaveStatus

**Files:** `app/components/pots/PotHistorySheet.tsx`, `app/components/accounts/UpdateBalanceSheet.tsx`, their tests.

- [ ] Test: success shows "Saved" and the sheet stays open; failure shows "Couldn't save." with Retry.
- [ ] Implement.
- [ ] Commit `fix: show save outcome in pot and balance forms (ST9)`.

### Task 6: Save notification waits for the server and stays open

**Files:** `app/hooks/useSaveWithUndo.tsx`, its test.

- [ ] Test: "Saving £4.80 · Dining…" before the request settles, then "Saved £4.80 · Dining"; a second save hides the first; the notification has a "Close notification" button and is still there after 6 seconds.
- [ ] Implement per-save ids with a module-level latest id, `autoClose: false`.
- [ ] Commit `fix: announce Saved only after the server confirms (ST6, ST3)`.

### Task 7: Transaction rows show saving and sync errors in text

**Files:** `app/components/transactions/TransactionRow.tsx`, `app/routes/_index.tsx`, `app/routes/transactions.tsx`, tests.

- [ ] Test: `saving` shows "Saving"; `pendingError` shows "Not synced. Tap to retry." and a focusable Retry calling `onRetry`.
- [ ] Implement; routes pass `saving` and `onRetry={flushNow}`.
- [ ] Commit `fix: show sync errors as text with a Retry button (ST11, ST6)`.

### Task 8: Verify

- [ ] `yarn test`, `yarn typecheck`, `yarn build` with dummy Auth0 values.
- [ ] Browser check with Playwright at 390px and 1280px, light and dark, keyboard only.
