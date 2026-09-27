# Spending Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Insights page that answers "where does my money go" and "am I on track" for a paged span of recent months, plus a "More" bottom-tab sheet that gives it (and Categories and Recurring) a home without crowding the tab bar.

**Architecture:** One new API endpoint reads a range of months of transactions in one call, reusing the pots endpoint's existing pagination helper. A new pure module, `app/lib/insights.ts`, turns that raw data plus categories/targets/pots into every number and chart series the page needs. The page itself is `@mantine/charts` (Recharts) driven by that pure module and the existing categories/targets/pots hooks.

**Tech Stack:** React 19, React Router 8, Mantine 8.3.12, `@mantine/charts` 8.3.12 (new), Recharts 2.15.4 (new), TanStack Query 5, Vitest 4 + Testing Library, AWS Lambda + DynamoDB, TypeScript strict, yarn.

**Spec:** `docs/superpowers/specs/2026-09-27-spending-insights-design.md`

## Execution notes for a cloud agent (start here if you have no prior context)

- Work on branch `feat/spending-insights` (it already contains the spec and this plan). Do not create another branch. **Do not open a pull request; a draft PR already exists for this branch and tracks your commits automatically. Do not mark it ready for review — the controller reviews and does that.**
- Setup: `yarn install --frozen-lockfile` if `node_modules` is missing. Commands: `yarn test` (all tests), `yarn vitest run <path>` (one file), `yarn typecheck`. Both must be clean before every commit.
- Do the tasks in order. Commit after each task, then `git push origin feat/spending-insights`. If a step cannot be completed after two honest attempts, stop, commit what is green, push, and say exactly what blocked you.
- Follow TDD: write the failing test, run it and see it fail for the expected reason, implement, then see it pass. Record the real failing output in your notes.
- Do not edit any file a task does not list. Do not weaken or delete an existing test to get green; only change a test where the plan says the behaviour changes. Never make unrelated formatting changes.
- Task 7 is a real-browser verification that changes no repo files; its scratch files go outside the repo. If a browser cannot be installed in your environment, say so precisely and skip it; the controller will run it.
- Commit trailers: use the trailer lines your harness gives you; if it gives none, end each message with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Global Constraints

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for the range endpoint's inputs; AUTH-01/AUTH-04 unchanged — every route stays behind the existing JWT check, scoped to the caller's partition; DEP-01 — run `yarn audit` after adding the two new dependencies and report the result).
- Conventional commits, imperative subject under 72 characters, explicit staging (`git add <files>`).
- "Spending" means `EXPENSE`-type transactions, including a Spend made against a `POT` category. `SET_ASIDE` is saved, not spent; `TAKE_OUT` reduces saved. Income is a total only, never broken down by category.
- Money values inside `app/lib/insights.ts` are always integer pence, matching every other money value in the app; formatting to `£` only happens in components, via `formatPence`.
- `@mantine/charts` is pinned to `8.3.12` (matching the installed `@mantine/core`/`@mantine/hooks`) and `recharts` to `2.15.4`, both exact versions, the same rule already applied to `@mantine/notifications`.
- The range endpoint and every `insights.ts` function are pure/stateless except the endpoint's DynamoDB read; no new item type is written to the table by this plan.
- Update `docs/ROADMAP.md` at the end (Task 8): mark G merged (PR #39) and add H.

## Review Focus

1. Paging never shows a future period: the right arrow is disabled exactly when the anchor equals the current month, and no request is ever made for a month later than the current one.
2. A month with a category that has activity in only one of the two periods (created partway through the span, or deleted since) must still show correctly — as zero in the empty period, not dropped or crashing the page.
3. The range endpoint rejects an oversized or malformed range before touching DynamoDB, and never returns another user's transactions.
4. Switching the span control mid-page (e.g. 6M → 3M) keeps the anchor month and does not silently reset it to "now".
5. `@mantine/charts` under Vitest needs a fixed container size to render its SVG; every chart-bearing test must give it one, or the test proves nothing.

---

### Task 1: Range endpoint

**Files:**
- Modify: `src/api/pots.ts` (export the existing `queryAll` helper), `api-handler.ts`
- Create: `src/api/transactionsRange.ts`, `src/api/__tests__/transactionsRange.test.ts`

**Interfaces:**
- Produces: `export async function queryAll(userId: string, prefix: string): Promise<Record<string, unknown>[]>` from `src/api/pots.ts` (already implemented there; this step only adds the `export` keyword — do not change its body).
- Produces: `export async function getTransactionsRange(event, userId, params): Promise<ApiResponse>` in `src/api/transactionsRange.ts`, contract `GET /api/transactions/range?from=YYYY-MM&to=YYYY-MM` → `{ transactions: Transaction[] }`.
- Route: `router.get('/api/transactions/range', getTransactionsRange);` in `api-handler.ts`.

**Why `queryAll` moves by export, not by relocating it to `db.ts`:** `pots.test.ts` mocks the whole `../db` module with a hand-written object. If `queryAll` were defined inside `db.ts` itself, its internal `docClient.send(...)` call is a closure over `db.ts`'s own module-scoped `docClient` binding — even loading the real module via `vi.importActual` and spreading a mocked `docClient` over the *returned object* does not change what `queryAll`'s own closure sees, because that closure was already bound to the real, unmocked `docClient` when the real module was instantiated. Keeping `queryAll` in `pots.ts` avoids this entirely: `pots.ts` imports `docClient` from `./db` as a live binding, so any test that mocks `../db` (from `pots.ts`'s perspective) correctly substitutes it — and the new range handler gets the same correct substitution by importing `queryAll` from `./pots` rather than from `./db`.

- [ ] **Step 1: Export `queryAll` and write the failing tests**

In `src/api/pots.ts`, change `async function queryAll(` to `export async function queryAll(`. Nothing else in that file changes.

Create `src/api/__tests__/transactionsRange.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  catSk: (categoryId: string) => `CAT#${categoryId}`,
  potSk: (categoryId: string) => `POT#${categoryId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { getTransactionsRange } from '../transactionsRange';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function getEvent(from?: string, to?: string): APIGatewayProxyEventV2 {
  const queryStringParameters: Record<string, string> = {};
  if (from !== undefined) queryStringParameters.from = from;
  if (to !== undefined) queryStringParameters.to = to;
  return { queryStringParameters, requestContext: { http: { method: 'GET' } } } as unknown as APIGatewayProxyEventV2;
}

function txnItem(yearMonth: string, categoryId: string, amount = 100) {
  return { SK: `TXN#${yearMonth}#${categoryId}${amount}`, yearMonth, amount, type: 'EXPENSE', categoryId, description: '', date: `${yearMonth}-10`, createdAt: '' };
}

function useTransactionPages(pages: unknown[][]): void {
  let page = 0;
  mockSend.mockImplementation(async () => {
    const items = pages[page] ?? [];
    const last = page < pages.length - 1;
    page += 1;
    return last ? { Items: items, LastEvaluatedKey: { PK: 'x', SK: `page-${page}` } } : { Items: items };
  });
}

beforeEach(() => { mockSend.mockReset(); });

describe('getTransactionsRange validation', () => {
  it.each([
    ['missing from', getEvent(undefined, '2026-09')],
    ['missing to', getEvent('2026-01', undefined)],
    ['malformed from', getEvent('2026-1', '2026-09')],
    ['malformed to', getEvent('2026-01', '2026-9')],
    ['from after to', getEvent('2026-09', '2026-01')],
    ['span over 24 months', getEvent('2024-01', '2026-02')],
  ])('returns 400 for %s', async (_label, event) => {
    const res = await getTransactionsRange(event, 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('accepts a span of exactly 24 months', async () => {
    useTransactionPages([[]]);
    const res = await getTransactionsRange(getEvent('2024-10', '2026-09'), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });

  it('accepts a single-month span', async () => {
    useTransactionPages([[]]);
    const res = await getTransactionsRange(getEvent('2026-09', '2026-09'), 'user-1', {});
    expect(res.statusCode).toBe(200);
  });
});

describe('getTransactionsRange', () => {
  it('filters to the requested months only', async () => {
    useTransactionPages([[
      txnItem('2026-06', 'cat-a'),
      txnItem('2026-07', 'cat-a'),
      txnItem('2026-08', 'cat-a'),
      txnItem('2026-09', 'cat-a'),
    ]]);
    const res = await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-1', {});
    const body = JSON.parse(res.body);
    expect(body.transactions.map((t: { yearMonth: string }) => t.yearMonth).sort()).toEqual(['2026-07', '2026-08']);
  });

  it('reads every page of transactions', async () => {
    useTransactionPages([[txnItem('2026-07', 'cat-a')], [txnItem('2026-08', 'cat-b')]]);
    const res = await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-1', {});
    expect(JSON.parse(res.body).transactions).toHaveLength(2);
  });

  it('scopes the query to the caller, not another user', async () => {
    useTransactionPages([[]]);
    await getTransactionsRange(getEvent('2026-07', '2026-08'), 'user-42', {});
    const call = mockSend.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':pk']).toBe('USER#user-42');
    expect(call.ExpressionAttributeValues[':prefix']).toBe('TXN#');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api/__tests__/transactionsRange.test.ts`
Expected: FAIL (module `../transactionsRange` does not exist).

- [ ] **Step 3: Implement**

Create `src/api/transactionsRange.ts`:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { queryAll } from './pots';
import type { ApiResponse, Transaction } from './types';
import { ok, err } from './http';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_SPAN_MONTHS = 24;

function monthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
}

export async function getTransactionsRange(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const { from, to } = event.queryStringParameters || {};

  if (!from || !MONTH_PATTERN.test(from) || !to || !MONTH_PATTERN.test(to)) {
    return err(400, 'from and to must be months in YYYY-MM format');
  }
  if (from > to) {
    return err(400, 'from must not be after to');
  }
  if (monthIndex(to) - monthIndex(from) + 1 > MAX_SPAN_MONTHS) {
    return err(400, `the range must be at most ${MAX_SPAN_MONTHS} months`);
  }

  const items = await queryAll(userId, 'TXN#');
  const transactions = (items as unknown as Transaction[]).filter(
    t => t.yearMonth >= from && t.yearMonth <= to,
  );
  return ok({ transactions });
}
```

In `api-handler.ts`, extend the import `import { getPots, putPot } from './src/api/pots';` to also bring in nothing extra (leave it), and add a new import line next to it: `import { getTransactionsRange } from './src/api/transactionsRange';`. Add the route after the existing transactions routes: `router.get('/api/transactions/range', getTransactionsRange);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/api` then `yarn typecheck`
Expected: PASS (existing `pots.test.ts` still passes unchanged, since only an `export` keyword was added), clean.

- [ ] **Step 5: Commit**

```bash
git add src/api/pots.ts src/api/transactionsRange.ts src/api/__tests__/transactionsRange.test.ts api-handler.ts
git commit -m "feat: add a range endpoint for reading several months of transactions"
git push origin feat/spending-insights
```

---

### Task 2: Client data layer

**Files:**
- Modify: `app/lib/api.ts`, `app/lib/queries.ts`
- Create: `app/lib/insights.ts`, `app/lib/__tests__/insights.test.ts`
- Modify (tests): `app/lib/__tests__/transactionMutations.test.tsx`

**Interfaces:**
- Consumes: `Transaction`, `Category`, `CategoryTarget`, `PotSummary` (`~/lib/types`); `groupCategories`, `bucketKeyFor` (`~/lib/categoryGroups`); `normaliseTargetToMonth` (`~/lib/summary`); `shiftMonth`, `currentYearMonth` (`~/lib/months`).
- Produces (`app/lib/api.ts`): `getTransactionsRange(from: string, to: string): Promise<Transaction[]>`.
- Produces (`app/lib/queries.ts`): `queryKeys.transactionsRange: (from: string, to: string) => ['transactionsRange', from, to]`, `useTransactionsRange(from: string, to: string)`. Every mutation hook that already invalidates `['pots']` also invalidates `['transactionsRange']`.
- Produces (`app/lib/insights.ts`): `type Period = [string, string]`; `fetchRangeForAnchor(anchor: string, months: number): { from: string; to: string }`; `canGoNewer(anchor: string): boolean`; `monthsInPeriod(period: Period): string[]`; `splitPeriods(from: string, to: string): { current: Period; previous: Period }`; `interface SummaryTotals { income: number; spent: number; saved: number; net: number }`; `summaryTotals(transactions: Transaction[], period: Period): SummaryTotals`; `interface GroupBreakdownRow { group: string; label: string; current: number; previous: number }`; `groupBreakdown(transactions: Transaction[], categories: Category[], current: Period, previous: Period): GroupBreakdownRow[]`; `interface CategorySpend { categoryId: string; name: string; spentPence: number }`; `categoriesInGroup(transactions: Transaction[], categories: Category[], group: string, period: Period): CategorySpend[]`; `interface MonthlyTrendRow { yearMonth: string; income: number; spent: number; saved: number }`; `monthlyTrend(transactions: Transaction[], months: string[]): MonthlyTrendRow[]`; `interface Mover { categoryId: string; name: string; currentPence: number; previousPence: number; deltaPence: number }`; `interface BiggestMovers { up: Mover[]; down: Mover[] }`; `biggestMovers(transactions: Transaction[], categories: Category[], current: Period, previous: Period, limit?: number): BiggestMovers`; `interface TargetAdherenceRow { categoryId: string; name: string; monthsOverTarget: number; monthsInSpan: number }`; `targetAdherence(transactions: Transaction[], categories: Category[], targets: CategoryTarget[], months: string[]): TargetAdherenceRow[]`.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/insights.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  fetchRangeForAnchor, canGoNewer, monthsInPeriod, splitPeriods, summaryTotals,
  groupBreakdown, categoriesInGroup, monthlyTrend, biggestMovers, targetAdherence,
} from '../insights';
import type { Category, CategoryTarget, Transaction } from '../types';

function txn(yearMonth: string, type: Transaction['type'], amount: number, categoryId: string): Transaction {
  return { transactionId: `${yearMonth}-${type}-${categoryId}-${amount}`, yearMonth, amount, type, categoryId, description: '', date: `${yearMonth}-10`, createdAt: '' };
}

function cat(categoryId: string, name: string, group: Category['group'], type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name, type, icon: 'tag', group, isDefault: true, createdAt: '' };
}

describe('fetchRangeForAnchor', () => {
  it('covers the current period and an equal-length comparison period ending the month before it', () => {
    expect(fetchRangeForAnchor('2026-09', 3)).toEqual({ from: '2026-04', to: '2026-09' });
  });

  it('crosses a year boundary', () => {
    expect(fetchRangeForAnchor('2026-01', 6)).toEqual({ from: '2025-02', to: '2026-01' });
  });

  it('handles a one-month span', () => {
    expect(fetchRangeForAnchor('2026-09', 1)).toEqual({ from: '2026-08', to: '2026-09' });
  });
});

describe('canGoNewer', () => {
  it('is false at the current month and true one month behind it', () => {
    const now = new Date('2026-09-15T00:00:00');
    expect(canGoNewer('2026-09', now)).toBe(false);
    expect(canGoNewer('2026-08', now)).toBe(true);
  });
});

describe('monthsInPeriod', () => {
  it('lists every month inclusive, in order', () => {
    expect(monthsInPeriod(['2026-11', '2027-02'])).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('splitPeriods', () => {
  it('splits an even range in half, current is the later half', () => {
    expect(splitPeriods('2026-01', '2026-06')).toEqual({ previous: ['2026-01', '2026-03'], current: ['2026-04', '2026-06'] });
  });

  it('splits a one-plus-one range into two single months', () => {
    expect(splitPeriods('2026-08', '2026-09')).toEqual({ previous: ['2026-08', '2026-08'], current: ['2026-09', '2026-09'] });
  });
});

describe('summaryTotals', () => {
  it('sums income, spend, and nets set-aside against take-out for saved', () => {
    const transactions = [
      txn('2026-09', 'INCOME', 200000, 'cat-salary'),
      txn('2026-09', 'EXPENSE', 30000, 'cat-groceries'),
      txn('2026-09', 'SET_ASIDE', 5000, 'cat-holidays'),
      txn('2026-09', 'TAKE_OUT', 2000, 'cat-holidays'),
      txn('2026-08', 'EXPENSE', 99999, 'cat-groceries'),
    ];
    const totals = summaryTotals(transactions, ['2026-09', '2026-09']);
    expect(totals).toEqual({ income: 200000, spent: 30000, saved: 3000, net: 170000 });
  });
});

describe('groupBreakdown', () => {
  const categories = [cat('cat-mortgage', 'Mortgage', 'BILLS'), cat('cat-groceries', 'Groceries', 'EVERYDAY')];

  it('sums spend per group for both periods, omitting groups with none', () => {
    const transactions = [
      txn('2026-09', 'EXPENSE', 100000, 'cat-mortgage'),
      txn('2026-08', 'EXPENSE', 90000, 'cat-mortgage'),
      txn('2026-09', 'EXPENSE', 5000, 'cat-groceries'),
    ];
    const rows = groupBreakdown(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08']);
    expect(rows).toEqual([
      { group: 'BILLS', label: 'Bills', current: 100000, previous: 90000 },
      { group: 'EVERYDAY', label: 'Everyday Spending', current: 5000, previous: 0 },
    ]);
  });

  it('ignores non-EXPENSE transactions and unknown categories', () => {
    const transactions = [txn('2026-09', 'SET_ASIDE', 5000, 'cat-mortgage'), txn('2026-09', 'EXPENSE', 1000, 'cat-missing')];
    expect(groupBreakdown(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08'])).toEqual([]);
  });
});

describe('categoriesInGroup', () => {
  it('lists spend per category in one group for one period, sorted highest first', () => {
    const categories = [cat('cat-a', 'A', 'EVERYDAY'), cat('cat-b', 'B', 'EVERYDAY'), cat('cat-c', 'C', 'BILLS')];
    const transactions = [
      txn('2026-09', 'EXPENSE', 500, 'cat-a'),
      txn('2026-09', 'EXPENSE', 1500, 'cat-b'),
      txn('2026-09', 'EXPENSE', 900, 'cat-c'),
    ];
    expect(categoriesInGroup(transactions, categories, 'EVERYDAY', ['2026-09', '2026-09'])).toEqual([
      { categoryId: 'cat-b', name: 'B', spentPence: 1500 },
      { categoryId: 'cat-a', name: 'A', spentPence: 500 },
    ]);
  });
});

describe('monthlyTrend', () => {
  it('gives one row per month, even a month with no activity', () => {
    const transactions = [txn('2026-07', 'INCOME', 1000, 'cat-salary'), txn('2026-09', 'EXPENSE', 400, 'cat-groceries')];
    expect(monthlyTrend(transactions, ['2026-07', '2026-08', '2026-09'])).toEqual([
      { yearMonth: '2026-07', income: 1000, spent: 0, saved: 0 },
      { yearMonth: '2026-08', income: 0, spent: 0, saved: 0 },
      { yearMonth: '2026-09', income: 0, spent: 400, saved: 0 },
    ]);
  });
});

describe('biggestMovers', () => {
  const categories = [cat('cat-a', 'A', 'EVERYDAY'), cat('cat-b', 'B', 'EVERYDAY'), cat('cat-c', 'C', 'EVERYDAY')];

  it('splits into up and down, sorted by size of change, excluding categories unchanged from zero', () => {
    const transactions = [
      txn('2026-09', 'EXPENSE', 10000, 'cat-a'), txn('2026-08', 'EXPENSE', 2000, 'cat-a'),
      txn('2026-09', 'EXPENSE', 1000, 'cat-b'), txn('2026-08', 'EXPENSE', 9000, 'cat-b'),
      txn('2026-08', 'EXPENSE', 0, 'cat-c'),
    ];
    const result = biggestMovers(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08']);
    expect(result.up).toEqual([{ categoryId: 'cat-a', name: 'A', currentPence: 10000, previousPence: 2000, deltaPence: 8000 }]);
    expect(result.down).toEqual([{ categoryId: 'cat-b', name: 'B', currentPence: 1000, previousPence: 9000, deltaPence: -8000 }]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => cat(`cat-${i}`, `Cat ${i}`, 'EVERYDAY'));
    const transactions = many.map((c, i) => txn('2026-09', 'EXPENSE', (i + 1) * 1000, c.categoryId));
    const result = biggestMovers(transactions, many, ['2026-09', '2026-09'], ['2026-08', '2026-08'], 2);
    expect(result.up).toHaveLength(2);
  });
});

describe('targetAdherence', () => {
  it('counts months over target, including months with no spend, only for EXPENSE categories', () => {
    const categories = [cat('cat-groceries', 'Groceries', 'EVERYDAY'), cat('cat-holidays', 'Holidays', 'SINKING_FUNDS', 'POT')];
    const targets: CategoryTarget[] = [
      { categoryId: 'cat-groceries', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' },
      { categoryId: 'cat-holidays', targetAmount: 5000, period: 'MONTHLY', updatedAt: '' },
    ];
    const transactions = [
      txn('2026-07', 'EXPENSE', 25000, 'cat-groceries'),
      txn('2026-08', 'EXPENSE', 15000, 'cat-groceries'),
    ];
    const rows = targetAdherence(transactions, categories, targets, ['2026-07', '2026-08', '2026-09']);
    expect(rows).toEqual([{ categoryId: 'cat-groceries', name: 'Groceries', monthsOverTarget: 1, monthsInSpan: 3 }]);
  });
});
```

`canGoNewer` in the test above is called with a second `now` argument for determinism — add that as an optional parameter (see Step 3).

Add to `app/lib/__tests__/transactionMutations.test.tsx`, inside its existing `describe('pots invalidation')` block (reuse the file's own `request`, `client`, `wrapper`, `input`, `existing` helpers), two more assertions on the tests already there for create and delete: after each existing `expect(client.getQueryState(potsKey)?.isInvalidated).toBe(true);`, add `expect(client.getQueryState(['transactionsRange']).isInvalidated ?? true).toBe(true);` is not valid for an unset key — instead, before calling the mutation in each of those two tests, add `client.setQueryData(['transactionsRange', '2026-01', '2026-07'], []);` and after, add `expect(client.getQueryState(['transactionsRange', '2026-01', '2026-07'])?.isInvalidated).toBe(true);`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/insights.test.ts app/lib/__tests__/transactionMutations.test.tsx`
Expected: FAIL (`../insights` does not exist; the new assertions in `transactionMutations.test.tsx` fail because nothing invalidates `transactionsRange` yet).

- [ ] **Step 3: Implement**

Create `app/lib/insights.ts`:

```ts
import { shiftMonth, currentYearMonth } from './months';
import { normaliseTargetToMonth } from './summary';
import { groupCategories, bucketKeyFor } from './categoryGroups';
import type { Category, CategoryTarget, Transaction } from './types';

export type Period = [string, string];

export function fetchRangeForAnchor(anchor: string, months: number): { from: string; to: string } {
  return { to: anchor, from: shiftMonth(anchor, -(2 * months - 1)) };
}

export function canGoNewer(anchor: string, now: Date = new Date()): boolean {
  return anchor < currentYearMonth(now);
}

export function monthsInPeriod([from, to]: Period): string[] {
  const months: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

export function splitPeriods(from: string, to: string): { current: Period; previous: Period } {
  const months = monthsInPeriod([from, to]);
  const half = months.length / 2;
  return {
    previous: [months[0], months[half - 1]],
    current: [months[half], months[months.length - 1]],
  };
}

function inPeriod(yearMonth: string, [from, to]: Period): boolean {
  return yearMonth >= from && yearMonth <= to;
}

export interface SummaryTotals {
  income: number;
  spent: number;
  saved: number;
  net: number;
}

export function summaryTotals(transactions: Transaction[], period: Period): SummaryTotals {
  let income = 0;
  let spent = 0;
  let setAside = 0;
  let takeOut = 0;
  for (const t of transactions) {
    if (!inPeriod(t.yearMonth, period)) continue;
    if (t.type === 'INCOME') income += t.amount;
    else if (t.type === 'EXPENSE') spent += t.amount;
    else if (t.type === 'SET_ASIDE') setAside += t.amount;
    else if (t.type === 'TAKE_OUT') takeOut += t.amount;
  }
  const saved = setAside - takeOut;
  return { income, spent, saved, net: income - spent };
}

interface GroupTotals {
  current: number;
  previous: number;
}

function spendByGroup(transactions: Transaction[], categories: Category[], current: Period, previous: Period): Map<string, GroupTotals> {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const totals = new Map<string, GroupTotals>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE') continue;
    const category = categoryById.get(t.categoryId);
    if (!category) continue;
    const key = bucketKeyFor(category);
    const entry = totals.get(key) ?? { current: 0, previous: 0 };
    if (inPeriod(t.yearMonth, current)) entry.current += t.amount;
    else if (inPeriod(t.yearMonth, previous)) entry.previous += t.amount;
    totals.set(key, entry);
  }
  return totals;
}

export interface GroupBreakdownRow {
  group: string;
  label: string;
  current: number;
  previous: number;
}

export function groupBreakdown(
  transactions: Transaction[],
  categories: Category[],
  current: Period,
  previous: Period,
): GroupBreakdownRow[] {
  const totals = spendByGroup(transactions, categories, current, previous);
  return groupCategories(categories)
    .filter(bucket => bucket.key !== 'INCOME' && bucket.key !== 'OTHER')
    .map(bucket => {
      const entry = totals.get(bucket.key) ?? { current: 0, previous: 0 };
      return { group: bucket.key, label: bucket.label, current: entry.current, previous: entry.previous };
    })
    .filter(row => row.current > 0 || row.previous > 0);
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  spentPence: number;
}

export function categoriesInGroup(
  transactions: Transaction[],
  categories: Category[],
  group: string,
  period: Period,
): CategorySpend[] {
  const inGroup = categories.filter(c => bucketKeyFor(c) === group);
  return inGroup
    .map(category => ({
      categoryId: category.categoryId,
      name: category.name,
      spentPence: transactions
        .filter(t => t.type === 'EXPENSE' && t.categoryId === category.categoryId && inPeriod(t.yearMonth, period))
        .reduce((sum, t) => sum + t.amount, 0),
    }))
    .filter(row => row.spentPence > 0)
    .sort((a, b) => b.spentPence - a.spentPence);
}

export interface MonthlyTrendRow {
  yearMonth: string;
  income: number;
  spent: number;
  saved: number;
}

export function monthlyTrend(transactions: Transaction[], months: string[]): MonthlyTrendRow[] {
  return months.map(yearMonth => {
    let income = 0;
    let spent = 0;
    let setAside = 0;
    let takeOut = 0;
    for (const t of transactions) {
      if (t.yearMonth !== yearMonth) continue;
      if (t.type === 'INCOME') income += t.amount;
      else if (t.type === 'EXPENSE') spent += t.amount;
      else if (t.type === 'SET_ASIDE') setAside += t.amount;
      else if (t.type === 'TAKE_OUT') takeOut += t.amount;
    }
    return { yearMonth, income, spent, saved: setAside - takeOut };
  });
}

export interface Mover {
  categoryId: string;
  name: string;
  currentPence: number;
  previousPence: number;
  deltaPence: number;
}

export interface BiggestMovers {
  up: Mover[];
  down: Mover[];
}

export function biggestMovers(
  transactions: Transaction[],
  categories: Category[],
  current: Period,
  previous: Period,
  limit: number = 3,
): BiggestMovers {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const totals = new Map<string, GroupTotals>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE') continue;
    const entry = totals.get(t.categoryId) ?? { current: 0, previous: 0 };
    if (inPeriod(t.yearMonth, current)) entry.current += t.amount;
    else if (inPeriod(t.yearMonth, previous)) entry.previous += t.amount;
    totals.set(t.categoryId, entry);
  }
  const movers: Mover[] = [];
  for (const [categoryId, { current: currentPence, previous: previousPence }] of totals) {
    if (currentPence === 0 && previousPence === 0) continue;
    const category = categoryById.get(categoryId);
    movers.push({ categoryId, name: category?.name ?? 'Unknown category', currentPence, previousPence, deltaPence: currentPence - previousPence });
  }
  const up = movers.filter(m => m.deltaPence > 0).sort((a, b) => b.deltaPence - a.deltaPence).slice(0, limit);
  const down = movers.filter(m => m.deltaPence < 0).sort((a, b) => a.deltaPence - b.deltaPence).slice(0, limit);
  return { up, down };
}

export interface TargetAdherenceRow {
  categoryId: string;
  name: string;
  monthsOverTarget: number;
  monthsInSpan: number;
}

export function targetAdherence(
  transactions: Transaction[],
  categories: Category[],
  targets: CategoryTarget[],
  months: string[],
): TargetAdherenceRow[] {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const rows: TargetAdherenceRow[] = [];
  for (const target of targets) {
    const category = categoryById.get(target.categoryId);
    if (!category || category.type !== 'EXPENSE') continue;
    let monthsOverTarget = 0;
    for (const yearMonth of months) {
      const spent = transactions
        .filter(t => t.type === 'EXPENSE' && t.categoryId === target.categoryId && t.yearMonth === yearMonth)
        .reduce((sum, t) => sum + t.amount, 0);
      if (spent > normaliseTargetToMonth(target.targetAmount, target.period, yearMonth)) monthsOverTarget += 1;
    }
    rows.push({ categoryId: target.categoryId, name: category.name, monthsOverTarget, monthsInSpan: months.length });
  }
  return rows.sort((a, b) => b.monthsOverTarget - a.monthsOverTarget);
}
```

`app/lib/api.ts`: add inside the object `createApi` returns, after `getTransactions`:

```ts
    getTransactionsRange: async (from: string, to: string): Promise<Transaction[]> => {
      const res = await request(`/api/transactions/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) as { transactions: Transaction[] };
      return res.transactions;
    },
```

`app/lib/queries.ts`: add `transactionsRange: (from: string, to: string) => ['transactionsRange', from, to] as const,` to `queryKeys`, and add:

```ts
export function useTransactionsRange(from: string, to: string) {
  const api = useApi();
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.transactionsRange(from, to),
    queryFn: () => api.getTransactionsRange(from, to),
    enabled: authReady,
  });
}
```

Then add `qc.invalidateQueries({ queryKey: ['transactionsRange'] });` on the line directly after every existing `qc.invalidateQueries({ queryKey: ['pots'] });` in `queries.ts` (there are seven: in `useCreateTransaction`'s `onSettled`, `useUpdateTransaction`'s `onSuccess`, `useDeleteTransaction`'s `onSuccess`, `useCreateCategory`'s `onSuccess`, `useReassignCategory`'s `onSuccess`, `useDeleteCategory`'s `onSuccess`, and `useSavePot`'s `onSuccess`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/lib/api.ts app/lib/queries.ts app/lib/insights.ts app/lib/__tests__/insights.test.ts app/lib/__tests__/transactionMutations.test.tsx
git commit -m "feat: add the insights data layer"
git push origin feat/spending-insights
```

---

### Task 3: Navigation — the More tab

**Files:**
- Create: `app/components/layout/MoreSheet.tsx`, `app/components/layout/__tests__/MoreSheet.test.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`, `app/components/layout/__tests__/DefaultLayout.test.tsx`

**Interfaces:**
- Consumes: `ResponsiveSheet` (`~/components/layout/ResponsiveSheet`).
- Produces: `MoreSheet({ opened, onClose }: { opened: boolean; onClose: () => void })`, rendering a row per `MORE_ITEMS` entry that navigates and calls `onClose`. `DefaultLayout.tsx` exports nothing new, but its `NAV_ITEMS`/`MORE_ITEMS` and `isNavItemActive` are what Task 4 and later use for the Insights link.

- [ ] **Step 1: Write the failing tests**

Create `app/components/layout/__tests__/MoreSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { MoreSheet } from '../MoreSheet';

function renderSheet(opened = true) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <MemoryRouter>
        <MoreSheet opened={opened} onClose={onClose} />
      </MemoryRouter>
    </MantineProvider>,
  );
  return onClose;
}

describe('MoreSheet', () => {
  it('lists Categories, Recurring and Insights with working links', () => {
    renderSheet();
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/categories');
    expect(screen.getByRole('link', { name: 'Recurring' })).toHaveAttribute('href', '/recurring');
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('href', '/insights');
  });

  it('closes when a row is tapped', async () => {
    const onClose = renderSheet();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Categories' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    renderSheet(false);
    expect(screen.queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();
  });
});
```

Add to `app/components/layout/__tests__/DefaultLayout.test.tsx`, inside `describe('DefaultLayout add shortcut')`, replacing the existing test named `links to Recurring from the sidebar only, not the bottom tab bar` (Recurring is moving into More on both bottom and sidebar, so this behaviour changes):

```tsx
  it('has four bottom-tab links plus a More button, and the sidebar lists everything including More items directly', () => {
    renderLayout();
    const tabBar = screen.getByRole('navigation');
    const tabLinks = ['Home', 'Transactions', 'Targets', 'Pots'].map(name =>
      within(tabBar).getByRole('link', { name }),
    );
    expect(tabLinks).toHaveLength(4);
    expect(within(tabBar).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(within(tabBar).queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();

    expect(screen.getAllByRole('link', { name: 'Categories' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Recurring' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Insights' })).toHaveLength(1);
  });

  it('opens the More sheet from the bottom tab and it lists Categories, Recurring and Insights', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('link', { name: 'Categories' })).toBeInTheDocument();
  });
```

(`within` must be added to the file's `@testing-library/react` import if not already present.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/layout`
Expected: FAIL (`MoreSheet` does not exist; DefaultLayout still has six sidebar-visible routes with Categories on the tab bar and no More tab).

- [ ] **Step 3: Implement**

Create `app/components/layout/MoreSheet.tsx`:

```tsx
import { Stack } from '@mantine/core';
import { NavLink } from 'react-router';
import { IconRepeat, IconTag, IconChartBar } from '@tabler/icons-react';
import { ResponsiveSheet } from './ResponsiveSheet';

export const MORE_ITEMS = [
  { to: '/categories', label: 'Categories', Icon: IconTag },
  { to: '/recurring', label: 'Recurring', Icon: IconRepeat },
  { to: '/insights', label: 'Insights', Icon: IconChartBar },
];

export function MoreSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title="More">
      <Stack gap={0}>
        {MORE_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', textDecoration: 'none', color: 'inherit' }}
          >
            <Icon size={20} stroke={1.6} />
            {label}
          </NavLink>
        ))}
      </Stack>
    </ResponsiveSheet>
  );
}
```

In `app/components/layout/DefaultLayout.tsx`:
- Change the icon import to `import { IconHome, IconList, IconTarget, IconPlus, IconPigMoney, IconMenu2 } from '@tabler/icons-react';` (drop `IconRepeat`, `IconTag`, no longer used directly here).
- Add `import { MoreSheet, MORE_ITEMS } from './MoreSheet';`.
- Change `NAV_ITEMS` to:

```tsx
const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/targets', label: 'Targets', Icon: IconTarget },
  { to: '/pots', label: 'Pots', Icon: IconPigMoney },
];
```

- Delete `SIDEBAR_ONLY_ITEMS` entirely (superseded by `MORE_ITEMS`, imported from `./MoreSheet`).
- Change `isNavItemActive` to also treat any `MORE_ITEMS` route as matching "More": add below it

```tsx
function isMoreActive(pathname: string): boolean {
  return MORE_ITEMS.some(item => isNavItemActive(pathname, item.to));
}
```

- In `BottomTabs`, add local state for the sheet and render the fifth tab as a button rather than a link:

```tsx
function BottomTabs() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = isMoreActive(pathname);
  return (
    <>
      <Paper
        component="nav"
        withBorder
        hiddenFrom="sm"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}
        p="xs"
      >
        <Group justify="space-around">
          {NAV_ITEMS.map(({ to, label, Icon }) => {
            const active = isNavItemActive(pathname, to);
            return (
              <RouterNavLink key={to} to={to} style={{ textDecoration: 'none' }} aria-label={label}>
                <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
                  <Icon size={22} stroke={active ? 2.4 : 1.6} />
                  <Text size="xs" fw={active ? 700 : 400}>{label}</Text>
                </Group>
              </RouterNavLink>
            );
          })}
          <UnstyledButton onClick={() => setMoreOpen(true)} aria-label="More">
            <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
              <IconMenu2 size={22} stroke={moreActive ? 2.4 : 1.6} />
              <Text size="xs" fw={moreActive ? 700 : 400}>More</Text>
            </Group>
          </UnstyledButton>
        </Group>
      </Paper>
      <MoreSheet opened={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
```

Add `UnstyledButton` and `useState` to the existing `@mantine/core`/`react` imports at the top of the file. The "More" control is a button, not a link, because it has no route of its own — it only opens the sheet — which is why the tests above query it with `role="button"`.

- In `SidebarNav`, change the rendered list to `{[...NAV_ITEMS, ...MORE_ITEMS].map(...)}` (same body, just the source array).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean. (`app/routes/insights.tsx` does not exist yet — the `/insights` link in the sidebar and More sheet will 404 if clicked before Task 4, but no test clicks through to it yet, so this is fine.)

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/MoreSheet.tsx app/components/layout/__tests__/MoreSheet.test.tsx app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/DefaultLayout.test.tsx
git commit -m "feat: add a More tab for Categories, Recurring and Insights"
git push origin feat/spending-insights
```

---

### Task 4: Chart dependencies and the Insights page shell

**Files:**
- Modify: `package.json`, `app/root.tsx`, `app/routes.ts` (or wherever routes are registered — check the file `app/routes.ts` uses `flatRoutes()`, meaning a new file at `app/routes/insights.tsx` is picked up automatically; confirm this before assuming a manual route registration is needed)
- Create: `app/routes/insights.tsx`, `app/routes/__tests__/insights.test.tsx`, `app/components/insights/SummaryRow.tsx`, `app/components/insights/__tests__/SummaryRow.test.tsx`

**Interfaces:**
- Consumes: `fetchRangeForAnchor`, `canGoNewer`, `splitPeriods`, `summaryTotals` (`~/lib/insights`); `useTransactionsRange`, `useCategories`, `useTargets`, `usePots` (`~/lib/queries`); `shiftMonth`, `currentYearMonth`, `formatMonthLabel` (`~/lib/months`); `formatPence` (`~/lib/money`).
- Produces: route `/insights`; `SummaryRow({ current, previous }: { current: SummaryTotals; previous: SummaryTotals })`.

- [ ] **Step 1: Confirm routing, add dependencies, write the failing tests**

Run `cat app/routes.ts` to confirm it uses `flatRoutes()` from `@react-router/fs-routes` (it does, per the existing file-based routes like `app/routes/pots.tsx` → `/pots`). No route file needs manual registration; `app/routes/insights.tsx` will serve `/insights` automatically.

Add the two dependencies with exact versions matching Global Constraints: `yarn add @mantine/charts@8.3.12 recharts@2.15.4`. Confirm `package.json` now pins both without a caret. Run `yarn audit` and note its output in your task report (do not fail the task on pre-existing unrelated advisories; only stop if the audit reports a high or critical advisory in `@mantine/charts` or `recharts` themselves).

In `app/root.tsx`, add `import '@mantine/charts/styles.css';` on its own line directly after `import '@mantine/notifications/styles.css';`.

Create `app/components/insights/__tests__/SummaryRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SummaryRow } from '../SummaryRow';
import type { SummaryTotals } from '~/lib/insights';

function totals(overrides: Partial<SummaryTotals> = {}): SummaryTotals {
  return { income: 0, spent: 0, saved: 0, net: 0, ...overrides };
}

function renderRow(current: SummaryTotals, previous: SummaryTotals) {
  return render(<MantineProvider><SummaryRow current={current} previous={previous} /></MantineProvider>);
}

describe('SummaryRow', () => {
  it('shows the four current totals', () => {
    renderRow(totals({ income: 250000, spent: 90000, saved: 5000, net: 160000 }), totals());
    expect(screen.getByText('£2,500.00')).toBeInTheDocument();
    expect(screen.getByText('£900.00')).toBeInTheDocument();
    expect(screen.getByText('£50.00')).toBeInTheDocument();
    expect(screen.getByText('£1,600.00')).toBeInTheDocument();
  });

  it('shows a percentage change against the previous period', () => {
    renderRow(totals({ spent: 11000 }), totals({ spent: 10000 }));
    expect(screen.getByText('+10%')).toBeInTheDocument();
  });

  it('shows no change indicator when the previous period was zero', () => {
    renderRow(totals({ spent: 5000 }), totals({ spent: 0 }));
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
```

Create `app/routes/__tests__/insights.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

const data = vi.hoisted(() => ({
  categories: [] as unknown[],
  targets: [] as unknown[],
  transactions: [] as unknown[],
  pots: [] as unknown[],
  rangeCalls: [] as [string, string][],
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: data.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: data.targets, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: () => ({ data: data.pots, isLoading: false, error: null, refetch: vi.fn() }),
  useTransactionsRange: (from: string, to: string) => {
    data.rangeCalls.push([from, to]);
    return { data: data.transactions, isLoading: false, error: null, refetch: vi.fn() };
  },
}));

import Insights from '../insights';

function renderPage() {
  return render(<MantineProvider><Insights /></MantineProvider>);
}

beforeEach(() => {
  data.categories = [];
  data.targets = [];
  data.transactions = [];
  data.pots = [];
  data.rangeCalls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00'));
});

describe('Insights page', () => {
  it('defaults to a 6-month span ending at the current month', () => {
    renderPage();
    expect(data.rangeCalls.at(-1)).toEqual(['2026-01', '2026-09']);
  });

  it('narrows to the current month when "This month" is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-08', '2026-09']);
  });

  it('pages back by a whole span and keeps the span length when returning', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2025-07', '2026-03']);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-01', '2026-09']);
  });

  it('disables paging forward past the current month', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('keeps the anchor month when the span changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    await user.click(screen.getByRole('radio', { name: 'This month' }));
    expect(data.rangeCalls.at(-1)).toEqual(['2026-03', '2026-03']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/insights app/routes/__tests__/insights.test.tsx`
Expected: FAIL (`../SummaryRow` and `../insights` do not exist).

- [ ] **Step 3: Implement**

Create `app/components/insights/SummaryRow.tsx`:

```tsx
import { Group, Paper, SimpleGrid, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { SummaryTotals } from '~/lib/insights';

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Figure({ label, pence, previousPence }: { label: string; pence: number; previousPence: number }) {
  const change = percentChange(pence, previousPence);
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="lg">{formatPence(pence)}</Text>
      {change !== null && (
        <Text size="xs" c={change >= 0 ? 'teal' : 'red'}>{change >= 0 ? '+' : ''}{change}%</Text>
      )}
    </Paper>
  );
}

export function SummaryRow({ current, previous }: { current: SummaryTotals; previous: SummaryTotals }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      <Figure label="Income" pence={current.income} previousPence={previous.income} />
      <Figure label="Spent" pence={current.spent} previousPence={previous.spent} />
      <Figure label="Saved" pence={current.saved} previousPence={previous.saved} />
      <Figure label="Net" pence={current.net} previousPence={previous.net} />
    </SimpleGrid>
  );
}
```

(`Group` is imported but unused if you follow this exactly — remove it from the import if so; keep only what you use.)

Create `app/routes/insights.tsx`:

```tsx
import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { SummaryRow } from '~/components/insights/SummaryRow';
import { canGoNewer, fetchRangeForAnchor, splitPeriods, summaryTotals } from '~/lib/insights';
import { currentYearMonth, formatMonthLabel, shiftMonth } from '~/lib/months';
import { useCategories, usePots, useTargets, useTransactionsRange } from '~/lib/queries';

const SPAN_OPTIONS = [
  { label: 'This month', value: '1' },
  { label: '3M', value: '3' },
  { label: '6M', value: '6' },
  { label: '12M', value: '12' },
];

function periodLabel(from: string, to: string): string {
  return from === to ? formatMonthLabel(from) : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`;
}

function InsightsContent() {
  const [months, setMonths] = useState(6);
  const [anchor, setAnchor] = useState(currentYearMonth());
  const { from, to } = fetchRangeForAnchor(anchor, months);
  const { current, previous } = splitPeriods(from, to);

  const categories = useCategories();
  const targets = useTargets();
  const pots = usePots(anchor);
  const range = useTransactionsRange(from, to);

  if (categories.error || targets.error || pots.error || range.error) {
    return (
      <Alert color="danger" title="Could not load insights">
        <Button onClick={() => { categories.refetch(); targets.refetch(); pots.refetch(); range.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || targets.isLoading || pots.isLoading || range.isLoading) {
    return <Group justify="center" py="xl"><Loader /></Group>;
  }

  const transactions = range.data ?? [];
  const currentTotals = summaryTotals(transactions, current);
  const previousTotals = summaryTotals(transactions, previous);

  return (
    <Stack>
      <Title order={3}>Insights</Title>
      <SegmentedControl
        value={String(months)}
        onChange={value => setMonths(Number(value))}
        data={SPAN_OPTIONS}
      />
      <Group justify="space-between">
        <ActionIcon variant="subtle" aria-label="Earlier" onClick={() => setAnchor(shiftMonth(anchor, -months))}>
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Text fw={600}>{periodLabel(current[0], current[1])}</Text>
        <ActionIcon variant="subtle" aria-label="Later" disabled={!canGoNewer(anchor)} onClick={() => setAnchor(shiftMonth(anchor, months))}>
          <IconChevronRight size={20} />
        </ActionIcon>
      </Group>
      <SummaryRow current={currentTotals} previous={previousTotals} />
    </Stack>
  );
}

export default function Insights() {
  return (
    <DefaultLayout>
      <InsightsContent />
    </DefaultLayout>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock app/root.tsx app/routes/insights.tsx app/routes/__tests__/insights.test.tsx app/components/insights/SummaryRow.tsx app/components/insights/__tests__/SummaryRow.test.tsx
git commit -m "feat: add the Insights page shell with paging and a summary row"
git push origin feat/spending-insights
```

---

### Task 5: Group breakdown chart, drill-down sheet, and monthly trend

**Files:**
- Create: `app/components/insights/GroupBreakdownChart.tsx`, `app/components/insights/__tests__/GroupBreakdownChart.test.tsx`, `app/components/insights/MonthlyTrendChart.tsx`, `app/components/insights/__tests__/MonthlyTrendChart.test.tsx`
- Modify: `app/routes/insights.tsx`, `app/routes/__tests__/insights.test.tsx`, `vitest.setup.ts`

**Interfaces:**
- Consumes: `groupBreakdown`, `categoriesInGroup`, `monthlyTrend`, `monthsInPeriod` (`~/lib/insights`); `BarChart`, `LineChart` (`@mantine/charts`); `formatPence` (`~/lib/money`); `ResponsiveSheet`.
- Produces: `GroupBreakdownChart({ rows, onSelectGroup }: { rows: GroupBreakdownRow[]; onSelectGroup: (group: string) => void })`; `MonthlyTrendChart({ rows }: { rows: MonthlyTrendRow[] })`.

- [ ] **Step 1: Fix the chart test container size, write the failing tests**

`@mantine/charts` renders through Recharts' `ResponsiveContainer`, which measures its parent with `getBoundingClientRect` — jsdom always returns zeros, so a chart renders a zero-sized (and effectively untestable) SVG unless every test gives it a real size. Add this once, at the end of `vitest.setup.ts` (after the existing `Element.prototype.scrollIntoView` line):

```ts
// Recharts measures its container via getBoundingClientRect to size its
// ResponsiveContainer; jsdom always returns zeros, which renders every
// chart at 0x0 and makes its content untestable.
Element.prototype.getBoundingClientRect = () => ({
  width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {},
});
```

Create `app/components/insights/__tests__/GroupBreakdownChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { GroupBreakdownChart } from '../GroupBreakdownChart';
import type { GroupBreakdownRow } from '~/lib/insights';

const rows: GroupBreakdownRow[] = [
  { group: 'BILLS', label: 'Bills', current: 100000, previous: 90000 },
  { group: 'EVERYDAY', label: 'Everyday Spending', current: 5000, previous: 8000 },
];

function renderChart(data: GroupBreakdownRow[] = rows) {
  const onSelectGroup = vi.fn();
  render(<MantineProvider><GroupBreakdownChart rows={data} onSelectGroup={onSelectGroup} /></MantineProvider>);
  return onSelectGroup;
}

describe('GroupBreakdownChart', () => {
  it('lists every group with its current and previous figures', () => {
    renderChart();
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('£1,000.00')).toBeInTheDocument();
    expect(screen.getByText('£900.00')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
  });

  it('calls onSelectGroup when a group row is tapped', async () => {
    const onSelectGroup = renderChart();
    await userEvent.setup().click(screen.getByText('Bills'));
    expect(onSelectGroup).toHaveBeenCalledWith('BILLS');
  });

  it('shows a message instead of a chart when there are no rows', () => {
    renderChart([]);
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });
});
```

Create `app/components/insights/__tests__/MonthlyTrendChart.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MonthlyTrendChart } from '../MonthlyTrendChart';
import type { MonthlyTrendRow } from '~/lib/insights';

describe('MonthlyTrendChart', () => {
  it('renders a chart when there are rows', () => {
    const rows: MonthlyTrendRow[] = [{ yearMonth: '2026-09', income: 200000, spent: 90000, saved: 5000 }];
    const { container } = render(<MantineProvider><MonthlyTrendChart rows={rows} /></MantineProvider>);
    expect(container.querySelector('.mantine-LineChart-root')).not.toBeNull();
  });

  it('shows a message instead of a chart when every month is empty', () => {
    const rows: MonthlyTrendRow[] = [{ yearMonth: '2026-09', income: 0, spent: 0, saved: 0 }];
    render(<MantineProvider><MonthlyTrendChart rows={rows} /></MantineProvider>);
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });
});
```

Add to `app/routes/__tests__/insights.test.tsx`, in the `~/lib/queries` mock, extend `data.transactions` usage so the group/trend sections have something to assert on, and add:

```tsx
  it('opens a group drill-down sheet listing its categories for the current period', async () => {
    data.categories = [{ categoryId: 'cat-mortgage', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: 'tag', isDefault: true, createdAt: '' }];
    data.transactions = [{ transactionId: 't1', yearMonth: '2026-09', amount: 100000, type: 'EXPENSE', categoryId: 'cat-mortgage', description: '', date: '2026-09-01', createdAt: '' }];
    const user = renderInsightsUser();
    await user.click(await screen.findByText('Bills'));
    expect(await screen.findByText('Mortgage')).toBeInTheDocument();
  });
```

(Add a small helper `function renderInsightsUser() { renderPage(); return userEvent.setup(); }` near the top of the file, and import `userEvent` if not already imported by this point in the file's history — it is, from Task 4.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/insights app/routes/__tests__/insights.test.tsx`
Expected: FAIL (`GroupBreakdownChart`/`MonthlyTrendChart` do not exist; the route test's new case has nothing to click).

- [ ] **Step 3: Implement**

Create `app/components/insights/GroupBreakdownChart.tsx`:

```tsx
import { BarChart } from '@mantine/charts';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { GroupBreakdownRow } from '~/lib/insights';

export function GroupBreakdownChart({ rows, onSelectGroup }: { rows: GroupBreakdownRow[]; onSelectGroup: (group: string) => void }) {
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  const data = rows.map(row => ({ label: row.label, Current: row.current, Previous: row.previous }));

  return (
    <Stack gap="xs">
      <BarChart
        h={Math.max(160, rows.length * 50)}
        data={data}
        dataKey="label"
        series={[{ name: 'Current', color: 'teal.6' }, { name: 'Previous', color: 'gray.5' }]}
        orientation="vertical"
        valueFormatter={formatPence}
        withLegend
      />
      {rows.map(row => (
        <UnstyledButton key={row.group} onClick={() => onSelectGroup(row.group)}>
          <Group justify="space-between">
            <Text>{row.label}</Text>
            <Text size="sm" c="dimmed">{formatPence(row.current)} · {formatPence(row.previous)}</Text>
          </Group>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
```

Create `app/components/insights/MonthlyTrendChart.tsx`:

```tsx
import { LineChart } from '@mantine/charts';
import { Text } from '@mantine/core';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { MonthlyTrendRow } from '~/lib/insights';

export function MonthlyTrendChart({ rows }: { rows: MonthlyTrendRow[] }) {
  const hasActivity = rows.some(row => row.income > 0 || row.spent > 0 || row.saved !== 0);
  if (!hasActivity) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  const data = rows.map(row => ({
    month: formatMonthLabel(row.yearMonth),
    Income: row.income,
    Spent: row.spent,
    Saved: row.saved,
  }));

  return (
    <LineChart
      h={220}
      data={data}
      dataKey="month"
      series={[
        { name: 'Income', color: 'teal.6' },
        { name: 'Spent', color: 'red.6' },
        { name: 'Saved', color: 'blue.6' },
      ]}
      valueFormatter={formatPence}
      withLegend
    />
  );
}
```

In `app/routes/insights.tsx`: add imports `GroupBreakdownChart` from `~/components/insights/GroupBreakdownChart`, `MonthlyTrendChart` from `~/components/insights/MonthlyTrendChart`, `groupBreakdown, categoriesInGroup, monthlyTrend, monthsInPeriod` extending the existing `~/lib/insights` import, `ResponsiveSheet` from `~/components/layout/ResponsiveSheet`, and `Title` is already imported. Add state `const [openGroup, setOpenGroup] = useState<string | null>(null);`. After computing `currentTotals`/`previousTotals`, add:

```tsx
  const breakdown = groupBreakdown(transactions, categories.data ?? [], current, previous);
  const trend = monthlyTrend(transactions, monthsInPeriod(current));
  const drillDown = openGroup ? categoriesInGroup(transactions, categories.data ?? [], openGroup, current) : [];
  const openGroupLabel = breakdown.find(row => row.group === openGroup)?.label ?? '';
```

Render, after `<SummaryRow .../>`:

```tsx
      <Title order={5} mt="md">Spending by group</Title>
      <GroupBreakdownChart rows={breakdown} onSelectGroup={setOpenGroup} />

      <Title order={5} mt="md">Monthly trend</Title>
      <MonthlyTrendChart rows={trend} />

      <ResponsiveSheet opened={openGroup !== null} onClose={() => setOpenGroup(null)} title={openGroupLabel}>
        <Stack>
          {drillDown.map(row => (
            <Group key={row.categoryId} justify="space-between">
              <Text>{row.name}</Text>
              <Text>{formatPence(row.spentPence)}</Text>
            </Group>
          ))}
        </Stack>
      </ResponsiveSheet>
```

Add `formatPence` to the existing `~/lib/money` import if not already there from an earlier task (it was not imported in Task 4's version of this file — add it now).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add vitest.setup.ts app/components/insights/GroupBreakdownChart.tsx app/components/insights/__tests__/GroupBreakdownChart.test.tsx app/components/insights/MonthlyTrendChart.tsx app/components/insights/__tests__/MonthlyTrendChart.test.tsx app/routes/insights.tsx app/routes/__tests__/insights.test.tsx
git commit -m "feat: add the group breakdown and monthly trend charts"
git push origin feat/spending-insights
```

---

### Task 6: Biggest movers, targets adherence, and pots

**Files:**
- Create: `app/components/insights/BiggestMovers.tsx`, `app/components/insights/__tests__/BiggestMovers.test.tsx`, `app/components/insights/TargetAdherence.tsx`, `app/components/insights/__tests__/TargetAdherence.test.tsx`, `app/components/insights/PotsTrend.tsx`, `app/components/insights/__tests__/PotsTrend.test.tsx`
- Modify: `app/routes/insights.tsx`, `app/routes/__tests__/insights.test.tsx`

**Interfaces:**
- Consumes: `biggestMovers`, `targetAdherence` (`~/lib/insights`); `PotSummary` (`~/lib/types`); `LineChart` (`@mantine/charts`); `useTargets` data already fetched in `insights.tsx`.
- Produces: `BiggestMovers({ up, down }: BiggestMoversData)` (renamed on import to avoid clashing with the `~/lib/insights` type of the same name — see Step 3); `TargetAdherence({ rows }: { rows: TargetAdherenceRow[] })`; `PotsTrend({ pots }: { pots: PotSummary[] })`.

- [ ] **Step 1: Write the failing tests**

Create `app/components/insights/__tests__/BiggestMovers.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BiggestMoversList } from '../BiggestMovers';
import type { BiggestMovers } from '~/lib/insights';

function renderList(data: BiggestMovers) {
  return render(<MantineProvider><BiggestMoversList up={data.up} down={data.down} /></MantineProvider>);
}

describe('BiggestMoversList', () => {
  it('lists the up and down movers with their change', () => {
    renderList({
      up: [{ categoryId: 'cat-a', name: 'A', currentPence: 10000, previousPence: 2000, deltaPence: 8000 }],
      down: [{ categoryId: 'cat-b', name: 'B', currentPence: 1000, previousPence: 9000, deltaPence: -8000 }],
    });
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('+£80.00')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('−£80.00')).toBeInTheDocument();
  });

  it('shows a message instead of empty lists when nothing moved', () => {
    renderList({ up: [], down: [] });
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });
});
```

Create `app/components/insights/__tests__/TargetAdherence.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TargetAdherence } from '../TargetAdherence';
import type { TargetAdherenceRow } from '~/lib/insights';

describe('TargetAdherence', () => {
  it('shows how many months each targeted category went over, worst first', () => {
    const rows: TargetAdherenceRow[] = [
      { categoryId: 'cat-a', name: 'Groceries', monthsOverTarget: 1, monthsInSpan: 6 },
      { categoryId: 'cat-b', name: 'Dining', monthsOverTarget: 4, monthsInSpan: 6 },
    ];
    render(<MantineProvider><TargetAdherence rows={rows} /></MantineProvider>);
    const names = screen.getAllByRole('listitem').map(item => item.textContent);
    expect(names[0]).toContain('Dining');
    expect(names[0]).toContain('4 of 6');
    expect(names[1]).toContain('Groceries');
  });

  it('shows a message when no category has a target', () => {
    render(<MantineProvider><TargetAdherence rows={[]} /></MantineProvider>);
    expect(screen.getByText(/no targets set/i)).toBeInTheDocument();
  });
});
```

Create `app/components/insights/__tests__/PotsTrend.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PotsTrend } from '../PotsTrend';
import type { PotSummary } from '~/lib/types';

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

describe('PotsTrend', () => {
  it('shows the total reserved and one chart per pot with history', () => {
    render(<MantineProvider><PotsTrend pots={[
      pot('cat-holidays', { balance: 25000, months: [{ yearMonth: '2026-09', opening: 0, setAside: 25000, autoAdded: 0, takeOut: 0, spent: 0, closing: 25000 }] }),
      pot('cat-empty', { balance: 0, months: [] }),
    ]} /></MantineProvider>);
    expect(screen.getByText('£250.00')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { hidden: true }).length + document.querySelectorAll('.mantine-LineChart-root').length).toBeGreaterThan(0);
  });

  it('shows a message when there are no pots with any history', () => {
    render(<MantineProvider><PotsTrend pots={[pot('cat-empty')]} /></MantineProvider>);
    expect(screen.getByText(/no pot activity/i)).toBeInTheDocument();
  });
});
```

Add to `app/routes/__tests__/insights.test.tsx`:

```tsx
  it('shows the targets and pots sections', () => {
    data.targets = [{ categoryId: 'cat-groceries', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' }];
    data.categories = [{ categoryId: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' }];
    data.pots = [{ categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 1000, thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [] }];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pots' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/insights app/routes/__tests__/insights.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/components/insights/BiggestMovers.tsx` (the component is named `BiggestMoversList`, not `BiggestMovers`, to avoid a naming clash with the `BiggestMovers` type already exported from `~/lib/insights`):

```tsx
import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { Mover } from '~/lib/insights';

function MoverRow({ mover, sign }: { mover: Mover; sign: '+' | '−' }) {
  return (
    <Group justify="space-between">
      <Text>{mover.name}</Text>
      <Text c={sign === '+' ? 'red' : 'teal'}>{sign}{formatPence(Math.abs(mover.deltaPence))}</Text>
    </Group>
  );
}

export function BiggestMoversList({ up, down }: { up: Mover[]; down: Mover[] }) {
  if (up.length === 0 && down.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Stack gap="xs">
        <Text fw={600}>Up</Text>
        {up.map(mover => <MoverRow key={mover.categoryId} mover={mover} sign="+" />)}
      </Stack>
      <Stack gap="xs">
        <Text fw={600}>Down</Text>
        {down.map(mover => <MoverRow key={mover.categoryId} mover={mover} sign="−" />)}
      </Stack>
    </SimpleGrid>
  );
}
```

Create `app/components/insights/TargetAdherence.tsx`:

```tsx
import { List, Text } from '@mantine/core';
import type { TargetAdherenceRow } from '~/lib/insights';

export function TargetAdherence({ rows }: { rows: TargetAdherenceRow[] }) {
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">No targets set for this period.</Text>;
  }

  return (
    <List spacing="xs">
      {rows.map(row => (
        <List.Item key={row.categoryId}>
          {row.name}: {row.monthsOverTarget} of {row.monthsInSpan} months over target
        </List.Item>
      ))}
    </List>
  );
}
```

Create `app/components/insights/PotsTrend.tsx`:

```tsx
import { LineChart } from '@mantine/charts';
import { Stack, Text } from '@mantine/core';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { PotSummary } from '~/lib/types';

export function PotsTrend({ pots }: { pots: PotSummary[] }) {
  const withHistory = pots.filter(pot => pot.months.length > 0);
  const totalReserved = pots.reduce((sum, pot) => sum + pot.balance, 0);

  if (withHistory.length === 0) {
    return <Text c="dimmed" size="sm">No pot activity to show for this period.</Text>;
  }

  return (
    <Stack gap="md">
      <Text fw={600}>Total reserved: {formatPence(totalReserved)}</Text>
      {withHistory.map(pot => (
        <div key={pot.categoryId}>
          <LineChart
            h={120}
            data={pot.months.map(month => ({ month: formatMonthLabel(month.yearMonth), Balance: month.closing }))}
            dataKey="month"
            series={[{ name: 'Balance', color: 'teal.6' }]}
            valueFormatter={formatPence}
            withDots={false}
          />
        </div>
      ))}
    </Stack>
  );
}
```

In `app/routes/insights.tsx`: add imports `BiggestMoversList` from `~/components/insights/BiggestMovers`, `TargetAdherence` from `~/components/insights/TargetAdherence`, `PotsTrend` from `~/components/insights/PotsTrend`, and `biggestMovers, targetAdherence` extending the `~/lib/insights` import. After computing `trend`, add:

```tsx
  const movers = biggestMovers(transactions, categories.data ?? [], current, previous);
  const adherence = targetAdherence(transactions, categories.data ?? [], targets.data ?? [], monthsInPeriod(current));
```

Render, after the `MonthlyTrendChart` block and before the drill-down `ResponsiveSheet`:

```tsx
      <Title order={5} mt="md">Biggest movers</Title>
      <BiggestMoversList up={movers.up} down={movers.down} />

      <Title order={5} mt="md">Targets</Title>
      <TargetAdherence rows={adherence} />

      <Title order={5} mt="md">Pots</Title>
      <PotsTrend pots={pots.data ?? []} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/insights/BiggestMovers.tsx app/components/insights/__tests__/BiggestMovers.test.tsx app/components/insights/TargetAdherence.tsx app/components/insights/__tests__/TargetAdherence.test.tsx app/components/insights/PotsTrend.tsx app/components/insights/__tests__/PotsTrend.test.tsx app/routes/insights.tsx app/routes/__tests__/insights.test.tsx
git commit -m "feat: add biggest movers, targets adherence and pots to Insights"
git push origin feat/spending-insights
```

---

### Task 7: Real-browser verification (no repo changes)

**Files:** none in the repo. Scratch files and screenshots go in a scratch directory outside the repo.

- [ ] **Step 1: Build and serve, sign in, stub the API**

Follow the recipe already recorded from F1/F2/G: install `playwright` in the scratch directory and use its Chromium; run `yarn dev`; seed the Auth0 React SDK's `localStorage` cache for a dummy client/audience so `isAuthenticated` is true; stub `/api/*` with canned JSON via route interception, including `/api/transactions/range` (categories, targets, pots and a range of transactions spanning at least 12 months so every span preset has real data).

- [ ] **Step 2: Verify the More tab**

At 390px and 1280px: the bottom tab bar has five tabs ending in More; tapping More opens a sheet listing Categories, Recurring and Insights, each of which navigates and closes the sheet; the sidebar at 1280px lists Home, Transactions, Targets, Pots, Categories, Recurring, Insights with no separate "More" entry.

- [ ] **Step 3: Verify the Insights page**

At both widths: all six sections render with real chart output (not just their loading/error state); the span control changes the figures; the Earlier/Later arrows page by the whole span and Later is disabled at the current month; switching the span keeps the same end month; tapping a group in "Spending by group" opens its drill-down sheet; the browser's console shows no errors from `@mantine/charts`/Recharts (a `ResizeObserver` warning here would indicate the polyfill isn't reaching the real browser build, which it should not need to — that stub is test-only).

- [ ] **Step 4: Report**

Write `REPORT.md` in the scratch directory with a pass/fail per check above, screenshot names, and any defect found. Paste the same summary into your final message. If you could not run a browser, say exactly what you tried and skip this task.

---

### Task 8: Roadmap and docs

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Update the roadmap**

In `docs/ROADMAP.md`:
- Change the G row's status to `Merged ([PR #39](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/39))`, keeping its existing spec/plan links.
- Change the H row to `Implemented on `feat/spending-insights` (PR pending). Spec: `superpowers/specs/2026-09-27-spending-insights-design.md`, plan: `superpowers/plans/2026-09-27-spending-insights.md``.
- Add a `## H: Spending insights` section, in the same Built / Decisions / Follow-ups structure as the other sections:
  - **Built:** a `/insights` page with a paged, comparable span (This month / 3 / 6 / 12 months) showing a summary row, spending by group with a drill-down, a monthly trend, biggest movers, target adherence, and pot balances over time; a new `GET /api/transactions/range` endpoint; a "More" bottom tab replacing the direct Categories tab, opening a sheet for Categories, Recurring and Insights; `@mantine/charts`/`recharts` added as pinned dependencies.
  - **Decisions:** the range endpoint returns raw transactions and every total is computed client-side in `app/lib/insights.ts`; paging moves by the whole span length so the current and previous periods are always adjacent; the page is never shown for a month later than the current one.
  - **Follow-ups:** a free date range instead of fixed-length paging; a stored monthly summary if the range read (shared with pots) gets slow; drill-down past a group into a single transaction; exporting the page.

- [ ] **Step 2: Verify**

Run: `yarn test && yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: record spending insights and mark G merged in the roadmap"
git push origin feat/spending-insights
```

## Verification after all tasks (controller, not a task)

- `yarn test`, `yarn typecheck`; review the Task 7 report and screenshots.
- Whole-branch review on the most capable model, then the SECURITY.md pre-PR checklist (IO-01 for the range endpoint, DEP-01 for the two new dependencies), then hand the PR back for merge.
