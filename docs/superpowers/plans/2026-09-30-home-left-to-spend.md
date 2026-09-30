# Home Left-to-Spend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home opens with one plain sentence saying how much is left to spend, shows all spending (with and without targets), lets rows lead to their transactions or the Edit sheet, uses month-aware labels, and lets the user put away the target card. Findings CL1, CL7, CL8, PC9, ES5.

**Architecture:** Pure maths and copy in `app/lib/summary.ts` and `app/lib/months.ts`; the Transactions editing flow moves into a shared hook (`useTransactionEditing`) used by both Home and Transactions; Transactions reads its initial month and filter from the URL; a small card component owns its dismissal in `localStorage`.

**Tech Stack:** React 19, React Router 8, Mantine 8, TanStack Query 5, Vitest 4 + Testing Library, TypeScript strict, yarn.

**Spec:** `docs/superpowers/specs/2026-09-30-home-left-to-spend-design.md`

## Global Constraints

- No API, infra, IAM or dependency changes.
- No new colours; neutral text only. No exclamation marks, no emoji, no alarm words.
- Explicit types on parameters and return values; early returns; no comments that restate code; no empty catch blocks; errors logged with context.
- TDD: failing test first, see it fail, implement, see it pass.
- Conventional commits naming the finding IDs.

### Task 1: Summary maths (CL1, CL7)

**Files:** Modify `app/lib/summary.ts`, `app/lib/__tests__/summary.test.ts`

- [ ] Tests for `budgetedTotal` (monthly and weekly, pot targets ignored), `spentInBudgeted`, `spentTotal`, `spentUnbudgeted`, `leftToSpend` (positive, negative), and a month with no targets.
- [ ] Add the fields to `MonthSummary` and compute them in `buildMonthSummary`.

### Task 2: Month phrases and the headline sentence (CL1, PC9)

**Files:** Modify `app/lib/months.ts`, `app/lib/summary.ts` and their tests

- [ ] `monthPhrase(yearMonth, now)` → `this month` / `in August` / `in August 2025`; `monthName(yearMonth, now)` → `August` / `August 2025`; `daysLeftInMonth(now)` counts today.
- [ ] `leftToSpendSentence(summary, yearMonth, now)` → the five sentences in the spec, or `null` with no targets.

### Task 3: Shared editing flow (CL8)

**Files:** Create `app/components/transactions/useTransactionEditing.tsx`; modify `app/routes/transactions.tsx`, `app/components/transactions/TransactionRow.tsx`

- [ ] Move the editing/duplicating/repeating state, delete and discard into `useTransactionEditing(yearMonth)` returning `rowActions(t)` and `sheets`. Existing Transactions tests stay green.
- [ ] `TransactionRow`: when `onEdit` is given and the row is not pending, the label area is a button that opens Edit. Test it.

### Task 4: Transactions reads the URL (CL7, CL8, PC9)

**Files:** Modify `app/routes/transactions.tsx`, `app/lib/transactions.ts` and tests

- [ ] `parseTransactionsParams(search)` validates `month`, `category` and `spending=untargeted`.
- [ ] `filterTransactions` understands the untargeted filter (expenses whose category has no expense target).
- [ ] Transactions initialises month and filter from the params; the category filter gets an "Other spending (no target)" option; the count line uses `monthPhrase`.

### Task 5: Home (CL1, CL7, CL8, PC9, ES5)

**Files:** Modify `app/routes/_index.tsx`, `app/components/budget/CategoryProgressRow.tsx`; create `app/components/budget/HomeSummary.tsx`, `app/components/budget/TargetsOptionalCard.tsx`; tests in `app/routes/__tests__/index.test.tsx`

- [ ] Headline and spent line under the month header; category rows lead with left/over and link to Transactions; Other spending row; Recent rows use the shared editing flow; month-aware labels.
- [ ] Target card with "Just tracking for now", remembered in `localStorage`.

### Task 6: Verify

- [ ] `yarn test`, `yarn typecheck`, and the build with dummy Auth0 values.
- [ ] Real-browser check with Playwright outside the repo: 390px and 1280px, light and dark, keyboard only.
