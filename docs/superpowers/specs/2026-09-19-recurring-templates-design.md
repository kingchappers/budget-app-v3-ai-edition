# Recurring Templates — Design

**Date:** 2026-09-19
**Status:** Draft, awaiting review
**Sub-project:** C of the fast transaction entry effort (see `docs/ROADMAP.md`). Builds on A (the entry sheet) and B (smart prefill), both merged.

## Background

Salary, rent and subscriptions repeat every month. Entering them by hand each time is the friction this effort exists to remove. C adds **recurring templates** and a **Due card on Home**: "Salary £2,400 · Due today [Add]". It is the first sub-project with a backend part: a new stored item type and API routes.

Nothing is created automatically. The app suggests, and the user confirms with a tap.

## Decisions (agreed with the user)

| Question | Decision |
|---|---|
| What happens when a template is due? | The app **suggests**. A Due card on Home lists what is due; **Add saves immediately with the usual Undo toast**; **Edit** opens the add sheet prefilled; **Skip** dismisses it for the period. No scheduler, no infra. |
| How does the app know an occurrence is handled? | It **matches the month's transactions** (same type and category, plus the same note if the template has one), so typing it in by hand counts. Skip and Edit-then-save are recorded on the template as a marker. |
| Which recurrence patterns? | **Monthly on a day** only. Short months fall on the month's last day. |
| When does a template show? | From `dayOfMonth − leadDays` until it is handled or its month ends. **`leadDays` is per template, default 3.** |
| What date does an added transaction get? | The **due date**, even if that is a few days ahead. |
| How are templates created and managed? | A **"Repeat monthly"** row-menu item on the Transactions page, plus a **/recurring** page (list, edit, delete, new). |
| Where does the "what is due?" logic live? | **Client-side**, as pure functions. The API only stores and returns templates. |

## Goals

1. A regular monthly entry is one tap on Home.
2. Templates can be created from an existing transaction in one step and managed in one place.
3. Nothing is saved without the user's tap, and everything the app saves has an Undo.
4. No new infrastructure, IAM changes or dependencies.

## Non-goals

Weekly or yearly cadence; automatic creation or any scheduler; per-occurrence amounts; end dates or a pause toggle (Skip is per period; Delete stops a template); push or email reminders; bulk import (sub-project E); an API-side "due" endpoint.

## Design

### 1. Data model and API

**Item** (single table, like `TARGET#` and `CAT#`): `PK = USER#<sub>`, `SK = RECUR#<recurringId>`.

| Field | Rule |
|---|---|
| `recurringId` | server-generated uuid |
| `type` | `TransactionType` (`EXPENSE`, `INCOME`, `INVESTMENT_IN`, `INVESTMENT_OUT`) |
| `categoryId` | non-empty string, at most 100 characters (existence is not checked, matching transactions) |
| `amount` | positive integer, in pence |
| `description` | the note; string of at most 200 characters; optional, defaults to `''` |
| `dayOfMonth` | integer, 1 to 31 |
| `leadDays` | integer, 0 to 14; defaults to 3 |
| `handledPeriod` | `YYYY-MM` or `null`; the latest month that was skipped, or edited-and-saved, from the Due card. It means "handled **through** that month". |
| `createdAt`, `updatedAt` | ISO timestamps |

**Routes** (registered in `api-handler.ts`, written like the existing handlers: hand-validated input, the `ok`/`err` helpers, `SECURITY_HEADERS`):

- `GET /api/recurring` — query the `RECUR#` prefix; returns `{ recurring: [...] }`.
- `POST /api/recurring` — validate, create with `handledPeriod: null`, return `{ recurring }` (201).
- `PUT /api/recurring/{recurringId}` — validate and **replace the editable fields** (`type`, `categoryId`, `amount`, `description`, `dayOfMonth`, `leadDays`), preserving `handledPeriod` and `createdAt`, setting `updatedAt`. Returns 404 if the item does not exist for this user.
- `DELETE /api/recurring/{recurringId}` — idempotent; returns 204.
- `POST /api/recurring/{recurringId}/handled` — body `{ period: 'YYYY-MM' | null }`; sets `handledPeriod` with a conditional update (`attribute_exists(PK)`), returning 404 if missing and the updated item otherwise.

**Validation (IO-01)** follows the transaction rules, plus the ranges above and `period` matching `^\d{4}-(0[1-9]|1[0-2])$` or `null`. Invalid JSON is a 400. Error messages are generic to the client (API-02).

**Isolation (AUTH-04):** the key always includes `USER#<sub>` taken from the validated token, so another user's id is simply not found (404). This is proven by tests, not assumed.

**Category integration:** the existing `reassignCategory` scans the user's `TXN#` items and updates each one that uses the source category. It gains a second, identical pass over `RECUR#` items so templates move with their transactions. The response keeps `reassigned` (transactions) unchanged and adds a new `recurringReassigned` count, so existing callers are unaffected. `deleteCategory` does **not** check for references (it only protects default categories), so a template can still end up pointing at a deleted category if the user skips the reassign step. That is why the client treats a template whose category no longer exists as excluded from the Due card and flagged "Category deleted" on /recurring.

**Security and infra:** the JWT check is central to the handler (AUTH-01, unchanged). **No infra, IAM or dependency changes**: the table policy already grants `GetItem/PutItem/DeleteItem/Query/UpdateItem/ConditionCheckItem` on the whole table, and `/api/{proxy+}` already routes to the Lambda. It is a code deploy through the existing pipeline. Until the routes are live, the Due card shows an inline error rather than breaking Home.

### 2. The due logic (`app/lib/recurring.ts`, pure and unit-tested)

Inputs: templates, categories, today's **local** date (`todayIso()`), and the transactions of today's month and the next month. Output: an ordered list of due items.

- **Occurrence date.** For a template and a month: `dayOfMonth`, clamped to the month's last day (the 31st becomes 28/29 in February, 30 in April).
- **Visibility.** Consider the occurrences in today's month and the following month. An occurrence `O` is visible when `O − leadDays ≤ today ≤ last day of O's month`. That yields the early heads-up (crossing into the previous month when `O` is near the start of a month) and keeps it until month end.
- **At most one row per template:** the earliest unhandled visible occurrence. An unhandled September occurrence shows as overdue until September ends; October's appears once September is handled.
- **Status and ordering.** "Due in N days" (`O > today`), "Due today", "N days overdue". Ordered overdue first (most overdue first), then today, then upcoming (soonest first).
- **Handled** for an occurrence `O` means either:
  - the template's `handledPeriod` is `O`'s month **or later**; or
  - a transaction in `O`'s month has the same `type` and `categoryId`, and the same normalised note (B's `normaliseNote`) when the template's note is non-empty. An empty template note matches any note. Transactions from other months or other types never match.
- **Excluded:** templates whose category does not exist.

Adding from the card creates a transaction that matches by construction, so the card clears; Undo deletes it and the card returns. That is derived state and needs no special handling.

### 3. Actions and UI

**Due card on Home** (`DueRecurringCard`), at the **top of Home, above the month header** (it is about today, not the viewed month). Each row shows the category icon, the note or category name, a status line ("Due in 2 days · 28 Sep") and the signed amount. A primary **Add** button and a **⋯ menu** with **Edit** and **Skip**. A "Manage" link goes to /recurring. The card renders nothing while loading or when nothing is due; if templates fail to load it shows a compact inline message with a retry (it is not critical to Home).

- **Add** creates `{ type, categoryId, amount, description, date: <due date> }` through the existing optimistic create, with the "Saved · Undo" toast.
- **Edit** opens the add sheet prefilled with the template's values and the **due date** (Duplicate uses today; this does not). When that save completes, the occurrence is also marked handled, so a changed category or note (no longer matching the template) cannot leave the card lingering.
- **Skip** marks the period handled, with a "Skipped · Undo" toast. Undo restores the previous `handledPeriod` (which may be `null`).

**Recurring page** (`app/routes/recurring.tsx`): a list ordered by day of month, each row showing the note or category, "Monthly on the 28th · remind 3 days before", and the signed amount, with an Edit/Delete menu and a **New** button. A template with a deleted category is flagged "Category deleted". Empty state: "No recurring items yet. Use Repeat monthly on a transaction, or add one here."

**Template form** (`RecurringForm`): type (the same Spend/Income/Invest control), category (searchable, filtered by type), amount (pounds, via `parsePounds`), note, day of month (1–31), remind days before (0–14, default 3). One Save, and **per-field inline errors** (not everything under Amount). Used for New, Edit and Repeat monthly.

**"Repeat monthly"** is a new item in a transaction's row menu on the Transactions page, next to Duplicate. It opens the form prefilled from that transaction: type, category, amount, note, the day of month from its date, remind days 3. The Transactions route holds a `repeating` state, mirroring `duplicating`.

**Finding it.** A **Recurring** link in the desktop sidebar. The bottom tab bar stays at four tabs; on mobile Home shows a small always-visible **"Manage recurring"** link. The "Quick entry tips" modal gains a Recurring entry (Repeat monthly, the Due card, the page).

### 4. Supporting changes and reuse

- **API client and hooks:** `getRecurring`, `createRecurring`, `updateRecurring`, `deleteRecurring`, `setRecurringHandled` in `app/lib/api.ts`, mirrored by `useRecurring` and the mutation hooks in `queries.ts` under a `['recurring']` key. `setRecurringHandled` is optimistic so Skip feels instant. `useDueRecurring()` composes templates, categories and the transactions of today's month and next month via two gated `useTransactions` calls on the existing per-month keys (shared and cached).
- **`TransactionSheet`** gains two optional props: `templateDate` (overrides the "today" that `template` uses) and `onSaved` (called after a successful create, used to mark the occurrence handled).
- **Two behaviour-preserving extractions**, because each now has two consumers: the Saved/Undo/Retry toast logic (`app/hooks/useSaveWithUndo.ts`, used by the sheet and by Add) and the Modal-on-desktop / Drawer-on-mobile wrapper (`app/components/layout/ResponsiveSheet.tsx`, used by the sheet and by the form). The sheet's existing tests must keep passing unchanged.

## Files touched

| File | Change |
|---|---|
| `src/api/recurring.ts` (+ tests) | New: the five handlers |
| `src/api/db.ts`, `src/api/types.ts` | `recurringSk(id)` and the `Recurring` type |
| `api-handler.ts` | Register the five routes |
| `src/api/reassign.ts` (+ tests) | Reassign also moves templates |
| `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts` (+ tests) | Type, API client, hooks |
| `app/lib/recurring.ts`, `app/lib/months.ts` (+ tests) | Due logic; date helpers (add days, last day of month) |
| `app/components/layout/ResponsiveSheet.tsx` | Extracted Modal/Drawer wrapper |
| `app/hooks/useSaveWithUndo.ts` | Extracted toast/undo logic |
| `app/components/transactions/TransactionSheet.tsx` (+ tests) | Use both extractions; `templateDate`, `onSaved` |
| `app/components/recurring/RecurringForm.tsx`, `DueRecurringCard.tsx` (+ tests) | New |
| `app/routes/recurring.tsx` (+ test) | New page |
| `app/components/transactions/TransactionRow.tsx`, `app/routes/transactions.tsx` (+ tests) | "Repeat monthly" and `repeating` state |
| `app/routes/_index.tsx`, `app/components/layout/DefaultLayout.tsx`, `QuickEntryTips.tsx` (+ tests) | Due card, Manage link, sidebar link, tips text |
| `docs/ROADMAP.md` | Status row for C |

## Testing

- **Backend:** each handler's validation boundaries (amount, type, category id, note length, `dayOfMonth` 1 and 31 and out of range, `leadDays` 0 and 14 and out of range, `period` format and `null`), success and error shapes and status codes, invalid JSON, `PUT` preserving `handledPeriod` and `createdAt`, `handled` with a period, with `null`, and for a missing item (404), idempotent delete, and **cross-user isolation** (a template under another `USER#` is neither read, updated, deleted nor marked handled). Reassign moves templates and leaves others alone.
- **Due logic:** the clamp (leap February, 30-day months), the visibility window (lead 0, 3 and 14; crossing a month boundary; the month-end cutoff), earliest-unhandled per template, handled by marker (including a later `handledPeriod`) and by match (type, category, the note rules, another month's transactions, another type), a deleted category, and labels and ordering.
- **Frontend:** hooks; the card's Add, Edit and Skip flows including both Undos and the marker after an Edit that changes the category; the form's per-field errors and prefill; the row-menu and route wiring; the Recurring page states; and that the two extractions preserve the sheet's existing behaviour and tests.
- **Browser:** a real-browser pass with the stubbed headless harness (Auth0 and `/api/*` stubbed, now including `/api/recurring`): Repeat monthly, the Due card at each status, Add with Undo, Edit then save, Skip with Undo, the month-boundary heads-up, the Recurring page, the sidebar and Home links, and the tips modal.
- `yarn typecheck` and `yarn test` must pass.

## Build order

Atomic, test-first commits on `feat/recurring-templates`:

1. API types, key helper, handlers and routes, with tests.
2. Reassign moves templates.
3. Frontend types, API client and hooks.
4. Pure due logic and date helpers.
5. The two behaviour-preserving extractions (`ResponsiveSheet`, `useSaveWithUndo`).
6. `RecurringForm`, the `/recurring` page and the sidebar link.
7. "Repeat monthly" in the row menu.
8. Sheet `templateDate`/`onSaved`, the Due card and the Home link.
9. The tips text.
10. Browser verification and docs.

## Deployment and security

A code deploy through the existing pipeline; no infra, IAM or dependency change. Relevant `SECURITY.md` controls: IO-01 (validation), AUTH-04 (user-scoped keys, proven by the isolation tests), API-02 (generic errors); AUTH-01 is unchanged.
