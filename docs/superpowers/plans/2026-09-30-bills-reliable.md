# Bills Reliable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bills stay on Home until the user deals with them, match only on an explicit link or a confirmed likely match, and read calmly. The Recurring page shows a skip until its month ends.

**Architecture:** Transactions gain an optional `recurringId`. The pure due logic in `app/lib/recurring.ts` uses that link, a three-month look-back and a likely-match search. Snooze and "No" answers live in guarded `localStorage`. The Due card and the Recurring page render the result.

**Tech Stack:** TypeScript, AWS Lambda + DynamoDB, React 19, React Router 7, Mantine 8, TanStack Query 5, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-bills-reliable-design.md`

## Global Constraints

- No infra, IAM or dependency changes. JWT validation untouched (AUTH-01). Validate `recurringId` (IO-01).
- Keep `useSaveWithUndo` unchanged; prove the field flows through it with a test.
- Copy: British English, no "overdue", no red for ordinary data, no exclamation marks.
- Branch `nd/04-bills-reliable`; conventional commits naming finding IDs.

## File Structure

| File | Responsibility |
|---|---|
| `src/api/transactions.ts`, `src/api/types.ts` | Validate, store and preserve `recurringId` |
| `app/lib/types.ts`, `app/lib/api.ts` | Frontend types |
| `app/lib/queries.ts` | `useLinkTransaction` |
| `app/lib/recurring.ts` | Matching, look-back, likely matches, labels, grouping |
| `app/lib/billPrefs.ts` | Snooze and dismissed matches in `localStorage` |
| `app/hooks/useDueRecurring.ts` | Five months of transactions |
| `app/components/transactions/TransactionSheet.tsx` | Optional `recurringId` prop |
| `app/components/recurring/DueRecurringCard.tsx` | Card UI |
| `app/routes/recurring.tsx` | Skipped status and Undo |

---

### Task 1: API accepts `recurringId` (TG3, IO-01)

- [ ] Write failing tests in `src/api/__tests__/transactions.test.ts`: create stores it; omitted stays absent; update preserves and replaces it; 400 for a number, a 101-character string and a non-UUID.
- [ ] Extend `validateTransactionInput`, `createTransaction`, `updateTransaction` and the `Transaction` types.
- [ ] `yarn test`, `yarn typecheck`; commit `feat: accept recurringId on transactions (TG3, IO-01)`.

### Task 2: Frontend types and flow-through

- [ ] Add `recurringId?` to `Transaction` and `TransactionInput`.
- [ ] Test in `useSaveWithUndo.test.tsx` that `recurringId` reaches `mutateAsync` and the offline queue.
- [ ] Commit `test: prove recurringId flows through save and queue (TG3)`.

### Task 3: Matching (TG3)

- [ ] Replace the `isHandled` tests: marker, linked transaction, and no inference from category or note. Add `likelyMatches` tests: 10% boundaries, type, category, linked, other period, ordering.
- [ ] Implement; commit `fix: match bills by link, never by category alone (TG3)`.

### Task 4: Look-back, grouping and labels (TG2, ES4)

- [ ] Tests: a September bill is still due on 1 Oct and later; three-month window; `createdAt` floor; one row per template (earliest); `groupDueItems`; `dueLabel` wording; ordering.
- [ ] Implement `computeDueItems`, `groupDueItems`, `dueLabel`; widen `useDueRecurring` to five months (test).
- [ ] Commit `fix: keep unlogged bills until handled (TG2, ES4)`.

### Task 5: Preferences

- [ ] Tests for `billPrefs`: snooze hides until tomorrow, per user and period, dismissed matches, and storage that throws.
- [ ] Implement; commit `feat: store bill snoozes and dismissed matches (ES4, TG3)`.

### Task 6: Due card (TG2, TG3, ES4)

- [ ] Card tests: neutral wording without danger colour; Add and Edit send `recurringId`; older groups with Add all; Didn't happen; likely-match Yes (links) and No; Remind me tomorrow.
- [ ] Add `recurringId` prop to `TransactionSheet` (sheet test), `useLinkTransaction` (hook test), then the card.
- [ ] Commit `feat: calm due card with look-back, matches and snooze (TG2, TG3, ES4)`.

### Task 7: Recurring page (ST3)

- [ ] Tests: "Skipped for October" with Undo that restores the previous month; hidden when a linked transaction exists or the marker is older.
- [ ] Implement; commit `feat: show skipped bills on the Recurring page (ST3)`.

### Task 8: Verify

- [ ] `yarn test`, `yarn typecheck`, `yarn build` with dummy Auth0 values.
- [ ] Browser pass (390px and 1280px, light and dark, keyboard only) with a throwaway Playwright harness outside the repo.
