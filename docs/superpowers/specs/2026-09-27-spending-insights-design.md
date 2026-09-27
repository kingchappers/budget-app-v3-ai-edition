# Spending insights: design

Sub-project **H**. It builds on F1 (category groups), F2 (pots) and G (polish and hardening, PR #39, merged), so its branch, `feat/spending-insights`, starts from `main`. Later sub-projects: I net worth and accounts, J offline entry queue.

## Intent

A single Insights page that answers "where does my money go" and "am I on track", for a chosen span of recent months, always anchored on the current month (no picking an arbitrary past window in this sub-project). It reuses the categories, groups and pots already built, and adds one new API endpoint to read a range of months at once.

## Decisions

| Question | Decision |
|----------|----------|
| Span | A segmented control: This month, 3 months, 6 months (default), 12 months. The page shows the chosen span and compares it against the equal-length period immediately before it. Always anchored on the current month; looking at an older window is a follow-up, not built here. |
| Data | A new `GET /api/transactions/range` endpoint returns the raw transactions for the requested months; all grouping, totals and comparisons are pure client functions. The page also reuses the existing categories, targets and pots endpoints. |
| Charts | `@mantine/charts` (built on Recharts), pinned to `8.3.12` to match the installed `@mantine/core`/`@mantine/hooks`, the same way `@mantine/notifications` is pinned. `recharts` is added as an explicit dependency at `2.15.4`, the peer version `@mantine/charts@8.3.12` requires (`>=2.13.3`). |
| "Spending" | `EXPENSE`-type transactions, including a Spend made against a pot category. `SET_ASIDE` counts as saved, not spent. Income is shown as a total only, not broken down. |
| Navigation | A fifth bottom tab, **More**, replaces the direct Categories tab. It opens a sheet listing Categories, Recurring and Insights. The desktop sidebar is unaffected and gains a direct Insights link. |

**Not doing (on purpose):** picking an arbitrary past window (only the current-month-anchored presets); a server-side pre-totalled insights endpoint (grouping logic would then live in two places, since custom categories and groups are in the database while defaults are in code); exporting or printing a report; per-transaction drill-down from a chart (tapping through to a group's categories is included; further than that is not).

## 1. Navigation: the More tab

- `app/components/layout/DefaultLayout.tsx`'s bottom-tab `NAV_ITEMS` becomes Home, Transactions, Targets, Pots, **More** (`IconMenu2`). Categories moves out of `NAV_ITEMS` into a new `MORE_ITEMS` list: Categories, Recurring, Insights, each with its existing or a new icon (Insights: `IconChartBar`).
- Tapping More opens a `ResponsiveSheet` (the same component the app already uses) titled "More", listing each item as a row with its icon and label, linking to its route. Tapping a row navigates and closes the sheet.
- The desktop sidebar renders `NAV_ITEMS` (minus More, since a sidebar has no need for it) plus `MORE_ITEMS` directly, in that order, exactly as it renders `SIDEBAR_ONLY_ITEMS` today. `SIDEBAR_ONLY_ITEMS` is replaced by `MORE_ITEMS` (same list, two uses).
- The bottom tab bar highlights More as active when the current route is `/categories`, `/recurring` or `/insights`.

## 2. Range endpoint

`GET /api/transactions/range?from=YYYY-MM&to=YYYY-MM` → `{ transactions: Transaction[] }`.

- Validates `from` and `to` are `YYYY-MM`, `from <= to`, and the span is at most 24 months (12 for the current period plus 12 for its comparison, the largest the UI ever requests). A violation returns 400.
- Reads every `TXN#` item for the user with the same paginated `queryAll` helper `src/api/pots.ts` already has (moved to a shared location, `src/api/db.ts` or a new small `src/api/txnQuery.ts`, and reused by both `pots.ts` and the new route so the pagination logic exists once), and filters to `from <= yearMonth <= to` in code. No new DynamoDB access pattern.
- Routed in `api-handler.ts` as `router.get('/api/transactions/range', getTransactionsRange);`, behind the existing JWT check, scoped to the caller's partition like every other route.

## 3. Client data layer

- `app/lib/api.ts` gets `getTransactionsRange(from: string, to: string): Promise<Transaction[]>`, calling the new route.
- `app/lib/queries.ts` gets `useTransactionsRange(from: string, to: string)`, keyed `queryKeys.transactionsRange(from, to)`, invalidated by every mutation that already invalidates `['transactions']` or `['pots']`.
- `app/lib/insights.ts` (new, pure, the heart of H) computes, from `{ transactions, categories, targets, from, to }`:
  - `splitPeriods(from, to): { current: [string, string]; previous: [string, string] }` — the requested range and the equal-length range immediately before it.
  - `summaryTotals(transactions, period): { income, spent, saved, net }` for one period (`saved` = `SET_ASIDE` minus `TAKE_OUT`; `spent` = `EXPENSE`; `net` = income − spent).
  - `groupBreakdown(transactions, categories, current, previous): { group, label, current, previous }[]` — spend per F1 group, both periods, via `groupCategories`.
  - `monthlyTrend(transactions, months): { yearMonth, income, spent, saved }[]` — one row per month in the full span (current period only; the trend chart shows the chosen span, not the comparison).
  - `biggestMovers(transactions, categories, current, previous, limit = 3): { up: Mover[]; down: Mover[] }` where `Mover = { categoryId, name, currentPence, previousPence, deltaPence }`, grouped by category (defaults and custom, any type that took an `EXPENSE`), sorted by `deltaPence` descending for `up` and ascending for `down`, top `limit` each, categories with zero in both periods excluded.
  - `targetAdherence(transactions, categories, targets, months): { categoryId, name, monthsOverTarget, monthsInSpan }[]` — for every `EXPENSE` category with a target, count how many months in the span had spend above `normaliseTargetToMonth` (reused from `app/lib/summary.ts`) for that month; every month in the span counts, including ones with no spend. Sorted by `monthsOverTarget` descending.
- Pot balances over time reuse `usePots` (F2) directly; H adds no pot-specific calculation.

## 4. The Insights page

Route `/insights`, in `DefaultLayout`. Top of the page: a segmented control for the span (This month / 3M / 6M / 12M, 6M selected by default), driving `from`/`to` for `useTransactionsRange`, `useTargets`, `useCategories`, and `usePots(to)`.

Sections, top to bottom, each with its own empty/loading handling:

1. **Summary row.** Income, spent, saved, net for the current period, each with the pence and percentage change against the previous period (an up or down arrow, coloured by whether that direction is good for that figure — spending up is flagged, saving up is not).
2. **Spending by group.** A horizontal `@mantine/charts` `BarChart`, one bar pair (current, previous) per F1 group with any spend. Tapping a group's row opens (via `ResponsiveSheet`) the categories inside it for the current period, sorted by spend.
3. **Monthly trend.** A `LineChart` across the chosen span's months: income and spending as two lines, saved as a third.
4. **Biggest movers.** Two short lists, "Up" and "Down", each row a category name with its current and previous pence and the change.
5. **Targets.** One row per targeted category showing "X of N months over", sorted worst first. A category never over its target in the span is still listed, at the bottom, so the page also shows what's going well.
6. **Pots.** One small `LineChart` per pot with any balance history in the span (reusing F2's `PotSummary.months`), plus a total-reserved figure (the sum of every pot's current balance) above them.

A section with nothing to show for the chosen span (for example Biggest Movers when nothing changed) shows a one-line message instead of an empty chart. The whole page shares one loading state (skeleton) and one error state (retry), following the Pots page's pattern.

## 5. Testing, verification and rollout

**Automated tests**

- `app/lib/insights.ts`: each function gets direct unit tests, including the boundary cases: a one-month span (This month), a category with a target for only part of the span, a category with no activity in either period (excluded from movers, included in the group breakdown as zero), and the previous-period window crossing a year boundary.
- API: `getTransactionsRange` — the 400 cases (bad format, `from > to`, span over 24 months), pagination across multiple pages, filtering to the requested months only, and that it is scoped to the caller's partition (no cross-user read).
- Client hooks: `useTransactionsRange` fetches and caches by `(from, to)`; a transaction or pot mutation invalidates it.
- Components: the More sheet (opens, lists the three items, links correctly, closes on navigation); the bottom tab highlighting More for its three routes; each Insights section rendered with fixture data (values, the empty-state message, the group drill-down sheet); the span control changing `from`/`to`.
- `@mantine/charts` under Vitest needs a `ResizeObserver` stub and a fixed container size; add this once to the test setup file rather than per test.
- Existing suites stay green; `yarn typecheck` is clean.

**Verification the executing agent runs:** the stubbed headless-browser pass at 390px and 1280px (the recipe recorded from F1/F2): the More tab and sheet, the Insights page's six sections rendering real charts (not just their test doubles), the span control, the group drill-down, and the desktop sidebar's new Insights link.

**Rollout:** a code deploy with two new dependencies (`@mantine/charts`, `recharts`) and no infra or IAM change. `yarn audit` is checked against the new dependencies as part of the security checklist. Rollback is a revert.

## Global constraints (for the plan)

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for the range endpoint's inputs; AUTH-01/AUTH-04 unchanged; DEP-01 audit the two new dependencies); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- `@mantine/charts` is pinned to the exact `@mantine/core` version (currently `8.3.12`); `recharts` is pinned to an exact version (`2.15.4`) satisfying its peer requirement. Both move in lockstep with future Mantine upgrades, the same rule already documented for `@mantine/notifications`.
- Update `docs/ROADMAP.md`: mark G merged (PR #39) and add H's status and follow-ups.

## Follow-ups

- Looking at an older, non-current-month-anchored window.
- A stored monthly summary if the full-history read (shared with pots) ever gets slow.
- Drill-down past a group into a single transaction.
- Exporting the page (CSV or PDF).
