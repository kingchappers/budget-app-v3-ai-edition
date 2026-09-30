# Bills Are Never Forgotten and Match Reliably — Design

**Date:** 2026-09-30
**Status:** Approved (decisions fixed by the audit programme brief)
**Programme:** PR-04 of the neurodivergent UX audit fixes (wave 1). Findings: TG2, TG3, ES4, and the Recurring-page part of ST3.

## Background

The recurring templates feature (see `2026-09-19-recurring-templates-design.md`) suggests bills on a Due card on Home. The audit found four problems:

- **TG2** — an unlogged bill disappears on the 1st of the next month, because `computeDueItems` only looks at this month and next and hides an item once its month ends.
- **TG3** — matching is wrong both ways. A template with no note counts as paid when *any* transaction of that type lands in its category, so one bill can hide another. A template with a note needs an exact note match, so "Netflix sub" never matches "Netflix" and Add creates a duplicate.
- **ES4** — past-due bills shout in red with an "N days overdue" counter that climbs daily.
- **ST3 (part)** — Skip leaves only a 5-second Undo toast; the Recurring page never shows that a bill was skipped.

## Decisions (from the brief)

| Question | Decision |
|---|---|
| How does the app know a bill was paid? | A transaction added from the Due card carries the template's `recurringId`. A bill is handled for a period when `handledPeriod` is at or after the period, or a transaction in that period carries its `recurringId`. No other inference. |
| What about bills typed in by hand? | A **likely match** is a transaction in that period with the same type and category, no `recurringId`, and an amount within 10%. The card asks "Looks like you logged this on 3 Oct. Same thing?" with **Yes, that's it** and **No**. Nothing is inferred silently. |
| How far back? | Up to **three months** before the current month, never before the template's `createdAt` month. Items stay until handled. |
| How are older periods shown? | Grouped under **"From September, not logged"**, with **Add all**, **Add with changes** and **Didn't happen** (= skip). |
| Wording and colour | "Due today", "Due in 3 days · 3 Oct", "Due 3 Sep". No overdue counter, no danger colour. |
| Snooze | **Remind me tomorrow** hides an item until tomorrow, in `localStorage` (guarded by try/catch), keyed by the user's sub, `recurringId` and period. |
| Recurring page | When `handledPeriod` covers the current period and no linked transaction exists, the row shows **"Skipped for October"** with **Undo**. |

## Decisions made without the user

1. **One row per template: its earliest unhandled period.** `handledPeriod` means "handled *through* that month", so marking a later period handled would silently cover an earlier, still-unlogged one. The card therefore only offers actions on each template's earliest unhandled period; once that is dealt with, the next one appears. This keeps "never infer paid silently" true for Skip, Yes and Edit.
2. **"Yes, that's it" links the transaction** (a `PUT` of the same transaction with `recurringId` added) instead of only moving `handledPeriod`. It marks the bill handled for that period, as the brief asks, and it also lets the Recurring page tell a confirmed match from a skip. The cache is updated optimistically and rolled back on error.
3. **"No" is remembered** per user, template and transaction in `localStorage` (same guarded helper as snooze), so the same question is not asked again after a reload. Another candidate, if any, is offered instead.
4. **Choosing the likely match:** the candidate with the closest amount, then the latest date. "Within 10%" means `|amount − template amount| ≤ 10% of the template amount`.
5. **Updating a transaction keeps its link.** `PUT /api/transactions/...` preserves the stored `recurringId` when the body omits it, so editing a Due-added transaction on the Transactions page does not unlink it. A body that includes `recurringId` sets it.
6. **Group actions:** Add all is on the group header; each row in a group keeps its own Add, and its menu has Add with changes, Didn't happen and Remind me tomorrow. The same menu wording is used for current-month rows. Add all uses the ordinary undoable save per item, so each item gets its own Saved · Undo toast.
7. **Group heading** uses the month name only ("From September, not logged"); three months back is never ambiguous.
8. **Undo on the Recurring page** sets `handledPeriod` to the month before the skipped one. Because only the earliest unhandled period is ever offered, every earlier period in the window was already handled when Skip ran, so this restores exactly what the card showed before. No history field is added to the API.
9. **The skipped row** is shown for `handledPeriod` equal to the current or next month (the only periods Skip can reach from the card). Its colour is dimmed text, not a warning.
10. **Past bills sit at the top of the card**, earliest first, then today, then upcoming. The older-month groups follow the current list inside the same card.
11. **A template with an empty or invalid `createdAt`** has no floor; the three-month window still limits the look-back.
12. **Existing data:** bills already paid by hand before this change will show once, with the likely-match question, rather than being assumed paid. This is the intended effect of TG3.

## Design

### API (`src/api/transactions.ts`)

`validateTransactionInput` accepts an optional `recurringId`: when present it must be a string of at most 100 characters matching the existing UUID pattern; otherwise 400 (IO-01). `createTransaction` stores it when present (never writes an `undefined` attribute). `updateTransaction` stores the body's value, or keeps the existing one. `Transaction` in `src/api/types.ts` and `app/lib/types.ts` gains `recurringId?: string`; `TransactionInput` in `app/lib/api.ts` too. JWT validation is untouched (AUTH-01); keys still come from the token (AUTH-04).

`useSaveWithUndo`, the offline queue and `flushQueue` spread the input unchanged, so `recurringId` flows through them with no code change; a test proves it.

### Due logic (`app/lib/recurring.ts`)

- `isHandled(template, period, transactions)`: marker or linked transaction only.
- `likelyMatches(template, period, transactions)`: the candidates above, best first.
- `computeDueItems` considers periods from three months back (floored at `createdAt`) to next month. Past periods are always visible; the current and next months keep the `leadDays` window. Each item has `status: 'past' | 'today' | 'upcoming'`, `daysAway`, and `likelyMatches`.
- `dueLabel`: "Due today", "Due in N days · 3 Oct", "Due 3 Sep".
- `groupDueItems(items, today)`: `{ current, older: [{ period, items }] }`.

### Preferences (`app/lib/billPrefs.ts`)

Guarded `localStorage` helpers: `snoozeUntilTomorrow`, `isSnoozed`, `dismissMatch`, `isMatchDismissed`, all keyed by the user's sub. Expired snoozes are pruned on write.

### Due card (`DueRecurringCard`)

Neutral status line, no red. Rows: Add; menu with Add with changes, Didn't happen, Remind me tomorrow. A likely-match line under the row with Yes, that's it and No. Older groups with their heading and Add all. Add and the Edit sheet send `recurringId` (new optional `recurringId` prop on `TransactionSheet`).

### Hook (`useDueRecurring`)

Loads the five months of transactions (three back, this, next) through the existing per-month `useTransactions` keys, so pending and offline rows are included.

### Recurring page

Loads this and next month's transactions; a skipped row shows "Skipped for October" and an Undo button that calls `useSetRecurringHandled` with the month before.

## Testing

- API: `recurringId` accepted, stored, preserved on update, replaced on update; rejected when not a string, too long, or not a UUID.
- Due logic: marker and linked matching; no category-only or note inference; likely-match amount boundaries, type, category, linked and period exclusions, ordering; the look-back window and `createdAt` floor; one row per template; grouping; labels.
- Preferences: snooze until tomorrow, per user, storage failures.
- Card: wording and no danger colour; Add and Edit send `recurringId`; groups and Add all; Didn't happen; likely-match Yes and No; snooze.
- Recurring page: skipped status, linked transaction hides it, Undo.
- `useSaveWithUndo`: `recurringId` reaches the create call and the offline queue.

## Security

IO-01 (validated `recurringId`), AUTH-01 unchanged, AUTH-04 (keys from the token). `localStorage` holds only ids and dates, never tokens (AUTH-03). No infra, IAM or dependency changes.
