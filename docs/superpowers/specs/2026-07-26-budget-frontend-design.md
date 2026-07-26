# Budget App — Frontend & Transaction Editing Design

**Date:** 2026-07-26
**Status:** Approved for planning
**Covers:** Phases 1 + 2 (core loop and management screens)
**Defers:** Phase 3 (month comparison/trends, investment valuations, projections)

## Goal

Build the user-facing budget app on top of the existing DynamoDB API. The primary
job is logging spending fast — a transaction in under ten seconds, usually on a
phone — with a secondary job of checking spending against targets at a glance.

## Product Decisions

The home screen leads with progress against targets, followed by recent
transactions. Progress is shown for expense categories (do not exceed) and
investment categories (do reach). Income is displayed as a month total with no
target, because an income target measures something the user does not control
month to month.

Investment transactions record **money moved in or out** of an account, not
market movement. Tracking what an investment is *worth* requires a valuation
record — a different shape of data — and is deferred to Phase 3 alongside
projections, since both depend on it.

## Scope

**In scope**

| Screen | Purpose |
| --- | --- |
| Home (`_index.tsx`) | Month progress vs targets, income total, recent transactions |
| Transactions (`transactions.tsx`) | Full month list, edit, delete |
| Targets (`targets.tsx`) | Set, edit and clear a target per expense or investment category |
| Categories (`categories.tsx`) | Create and delete custom categories |
| Transaction sheet | Add and edit, as a bottom sheet rather than a route |

**Out of scope (Phase 3)**

Month-to-month comparison and trends, investment valuations, savings
projections. Simple month navigation (previous/next arrows) *is* included, since
the data layer is already keyed by `yearMonth` and without it there is no way to
review last month.

**Also out of scope:** optimistic updates, offline support, e2e tests, full
component test coverage.

## Architecture

### Routes and navigation

Four file-based routes: `_index`, `transactions`, `targets`, `categories`.

Adding a transaction is deliberately not a route. It is a Mantine bottom sheet
opened from a floating action button on Home and Transactions. Navigating away
and back costs seconds and loses scroll position, which works against the
under-ten-seconds goal.

Navigation is a bottom tab bar with three destinations — Home, Transactions,
Targets — plus the floating action button. Categories is reached from the
existing header menu; it is edited rarely and a fourth tab crowds the thumb
targets.

`DefaultLayout.tsx` gains the tab bar and action button. The header and Auth0
wiring are unchanged.

### New modules

| File | Responsibility |
| --- | --- |
| `app/lib/money.ts` | Parse and format between pence integers and pounds |
| `app/lib/summary.ts` | Aggregate transactions into the home view model |
| `app/lib/api.ts` | Typed client wrapping `useProtectedApi` |
| `app/lib/queries.ts` | Query keys, `useQuery` and `useMutation` hooks |

`money.ts` and `summary.ts` are pure and separately tested. Every amount in the
system is an integer number of pence while users type decimal pounds; that
conversion and the aggregation arithmetic are where silent money bugs come from,
so they are isolated from React and covered directly.

### Data layer

TanStack Query manages fetching and cache invalidation. It was chosen over React
Router's `clientLoader` because loaders are not components and cannot call
Auth0's `getAccessTokenSilently` hook, which would force a module-scoped escape
hatch on every route. It was chosen over hand-rolled context because the failure
mode there — stale aggregates after a mutation — is subtle and self-inflicted.

Query keys:

| Key | Contents |
| --- | --- |
| `['categories']` | Defaults merged with custom, long stale time |
| `['targets']` | All targets, moderate stale time |
| `['transactions', yearMonth]` | One month, matching the API's shape |

Invalidation:

| Action | Invalidates |
| --- | --- |
| Add, edit or delete transaction | `['transactions', yearMonth]` |
| Set or delete target | `['targets']` |
| Create category | `['categories']` |
| Delete category with reassignment | `['categories']`, `['targets']`, all `['transactions']` |

`buildMonthSummary(transactions, categories, targets)` returns `spending`,
`saving`, `incomeTotal` and `recent`. Over-target rows sort first so the thing
needing attention does not require scrolling.

Income categories are excluded from the targets screen. Income has no target by
the product decision above, so offering the field would create data the home
screen deliberately ignores.

### Weekly targets in a monthly view

`CategoryTarget.period` is `MONTHLY` or `WEEKLY`, but every screen in this phase
is month-scoped. Comparing a month's spending against a weekly figure would
overstate progress by roughly four times.

Weekly targets are therefore normalised to the month for comparison, multiplied
by the number of days in that month divided by seven — so a £50 weekly target
becomes £221 in a 31-day month. The row displays both, as `£50/wk (≈£221/mo)`,
so the normalisation is visible rather than hidden inside the bar. Normalisation
lives in `summary.ts` and is unit-tested, including the February and 31-day
cases.

## API Changes

The existing API cannot express three things this design needs.

### 1. Rename investment transaction types

`INVESTMENT_GAIN` and `INVESTMENT_LOSS` become `INVESTMENT_IN` and
`INVESTMENT_OUT`. The current names describe market movement but the values are
used for contributions and withdrawals. Renaming now is close to free: the table
was created on 2026-07-22, no client writes to it, and it is expected to be
empty.

Touches `src/api/types.ts`, `src/api/constants.ts`, `src/api/transactions.ts`
and the handler tests.

### 2. Make description optional

Description is currently required and non-empty, which adds a typing step to
every entry and works against the primary goal. It becomes optional; the ≤200
character limit still applies when a value is present. Where a description is
absent the UI displays the category name.

### 3. Add `PUT /api/transactions/{yearMonth}/{transactionId}`

There is currently no way to correct a transaction other than deleting and
recreating it, which mints a new `transactionId` and `createdAt` and cannot be
made atomic.

Validation matches create. Two update paths:

- **Same month** — `UpdateItem` on the existing key.
- **Date moves to another month** — the sort key is `TXN#{yearMonth}#{id}`, and
  DynamoDB cannot update a key attribute in place. This path deletes the old
  item and puts the new one inside `TransactWriteItems` so it cannot half-fail,
  preserving the original `transactionId` and `createdAt`.

### 4. Add `POST /api/categories/{categoryId}/reassign`

Deleting a category does not cascade, so its transactions and target would be
left pointing at an identifier that no longer resolves. Rather than orphan them
or silently delete financial history, deletion reassigns.

The endpoint accepts `{ toCategoryId }` and moves every transaction from the old
category across all months. `begins_with(SK, 'TXN#')` returns all of a user's
transactions in one query, so this is a single request rather than a per-month
client loop.

Implemented as repeated `UpdateItem` rather than `BatchWriteItem`: batch
operations only put and delete, so using them would mean rewriting whole items,
and `BatchWriteItem` is an IAM action the Lambda does not currently hold.

The reassignment target must exist and must not be the category being deleted.
Default categories remain undeletable; the API already returns 403.

### Infrastructure risk to verify

The Lambda's inline policy grants `GetItem`, `PutItem`, `DeleteItem`, `Query`
and `UpdateItem`. `TransactWriteItems` is expected to be authorised through the
underlying `PutItem` and `DeleteItem` permissions, but this must be confirmed
during implementation rather than assumed — the failure would appear in
production, not in tests. If a change is needed it goes in `infra/dynamodb.tf`,
which the deploy role gained permission to apply on 2026-07-22.

## Error Handling

- **Expired token** — `useProtectedApi` throws on 401; surface a re-authenticate
  prompt rather than a generic failure.
- **Network and 5xx** — error state and retry per section, so a failed
  transactions fetch does not blank the page.
- **Validation client-side first** — positive integer amount, ≤200 character
  description, `YYYY-MM-DD` date. The fast path never round-trips to be told an
  amount was invalid.
- **No optimistic updates.** Showing a transaction as saved before the server
  confirms would misrepresent money. A brief pending state is honest and still
  fast.
- **Empty states are first-class.** With no targets set the home screen would
  otherwise be empty bars, so it prompts to set targets; with no transactions it
  prompts to add one.
- **Unresolvable category** — reassignment should prevent orphans, but the UI
  still renders an unknown `categoryId` as a muted "Unknown category" and skips
  it in progress rows rather than crashing.

## Testing

| Layer | Approach |
| --- | --- |
| `money.ts`, `summary.ts` | Unit tests, pure functions, no DOM |
| New and changed API handlers | Extend the existing `src/api/__tests__` pattern |
| `TransactionSheet` | Component test covering the validation path |

`vitest.config.ts` currently sets `environment: 'node'` and includes only
`src/**`. The include glob must extend to `app/**` tests, and component tests
need a browser-like environment alongside the existing node one. The exact
project layout is left to the implementation plan rather than guessed here.

Not covered: full component coverage and e2e. The pure modules carry the risk;
asserting that Mantine renders a button is noise.

## Prerequisites

Entry defaults to today's date. Amounts are integer pence throughout the API and
are converted only at the UI boundary.

This design assumes PR #11 (CI test enablement, dependency patches, React Router
8 upgrade) has merged.
