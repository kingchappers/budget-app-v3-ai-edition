# Spending insights: design

Sub-project **H**. It builds on F1 (category groups) and the existing Targets feature. Later sub-project: I net worth and accounts.

G (polish and hardening) was explicitly skipped for now at the owner's request, so this branch goes straight to H.

## Intent

The owner wants a view of how spending is trending, not just the current month's snapshot Home already gives. Three things, scoped in this round:

1. **Category trends over time** — how spending in each category has moved over the last several months.
2. **Budget vs actual** — how actual spend compares to the category targets already set on the Targets page, both this month and on average.
3. **Top merchants/notes** — where money is going, grouped by the transaction note.

## Decisions

| Question | Decision |
|----------|----------|
| Window | A trailing window ending at the viewed month, `months` long (default 6, client can request 3–12). Fixed, not user-editable in this round. |
| Where the data comes from | One new derived endpoint, `GET /api/insights`, following F2's pattern: computed on demand from the full transaction history, nothing stored can drift. |
| Which categories | Every `EXPENSE` category. `POT` categories are excluded — pot activity already has its own trend on the Pots page. |
| Budget vs actual | Computed client-side by joining the endpoint's per-category actual/average spend with the categories and targets the app already fetches (`useCategories`, `useTargets`), reusing `summary.ts`'s existing `normaliseTargetToMonth`/progress logic rather than duplicating target math server-side. |
| Notes grouping | Same normalisation rule as B's note memory (trim, lower-case, collapse whitespace), computed independently server-side (the API bundle doesn't share code with the client bundle). Top 8 by total spent. |
| Chart | The existing hand-drawn inline SVG trend line (`PotTrend`, generalised already — it just takes `number[]`) is reused as-is. No charting dependency added. |
| Navigation | Sidebar-only, like Recurring, not a sixth bottom tab — mobile-width crowding at 5 tabs is already a recorded issue elsewhere. |

**Not doing (on purpose):** a user-configurable window, income trends, per-transaction drill-down from a trend point, a stored monthly summary (same follow-up as F2 if this ever gets slow).

## 1. API

`GET /api/insights?asOf=YYYY-MM&months=N` (JWT-protected, IO-01 validated):

- `asOf`: required, `YYYY-MM`, at most one month ahead of the server's UTC month (same rule as `/api/pots`).
- `months`: optional, integer 3–12, default 6.
- 400 for anything else.

Response:

```ts
interface CategoryMonthSpend { yearMonth: string; spent: number }
interface CategorySpendTrend { categoryId: string; months: CategoryMonthSpend[]; total: number; average: number }
interface TopNote { note: string; count: number; total: number }
interface Insights {
  months: string[];              // the window, oldest first, length = `months`
  categories: CategorySpendTrend[]; // every EXPENSE category, zero-filled, sorted by total desc
  topNotes: TopNote[];
}
```

`categories` deliberately covers every `EXPENSE` category (not just ones with a target, not just the top N) so both the trends section and the budget-vs-actual section can read from the same array — the trends UI filters to categories with `total > 0` and takes the top few, the budget-vs-actual UI filters to categories with a target. No separate endpoint or shape for each.

A pure function `computeInsights(transactions, categories, asOfMonth, months)` in `src/api/insightsCalc.ts` does the work; `src/api/insights.ts` wires it to DynamoDB, reusing:
- `queryAll` (paginated `TXN#` query), lifted out of `pots.ts` into `src/api/dynamo.ts` since it now has two callers.
- `isValidMonth` / `monthIndex` / `serverMonthIndex`, lifted out of `pots.ts` into `src/api/months.ts` for the same reason.

`pots.ts` is updated to import both instead of keeping its own copies; its behaviour is unchanged.

## 2. What changes on screen

- **New Insights page** (`/insights`), linked from the sidebar under Recurring.
  - **Category trends:** the categories with `total > 0`, sorted by total, top 6, each as a row with the category name, total over the window, and a `PotTrend` sparkline of its monthly spend.
  - **Budget vs actual:** every `EXPENSE` category with a target, reusing `CategoryProgressRow` for "this month" (via `summary.ts`'s existing progress math fed with the endpoint's `actual` figure) plus a dimmed caption with the window average.
  - **Top merchants/notes:** a simple ranked list, note text, count, total.
- **Nothing else changes.** Home, Targets and Pots are untouched.

## 3. Testing

- `computeInsights`: zero-filled window with no gaps; a category with no activity gets an all-zero row; `total`/`average` arithmetic; note aggregation groups by the normalised key, keeps the most recent transaction's original casing for display, ignores blank notes, sorts by total then count, caps at 8; entries outside the window excluded; `POT`-type categories excluded.
- `getInsights`: 400s for a missing/malformed `asOf`, an out-of-range `months`, an `asOf` more than one month ahead.
- Route test: `GET /api/insights` registered in `api-handler.ts`.
- Frontend: a hook test for `useInsights`, and component tests for the three new sections mirroring the existing Pots component test style.
