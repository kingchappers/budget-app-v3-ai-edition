# Budget App Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile-first budget UI — a month view showing spending and saving against targets, fast transaction entry and editing, target management, and custom categories.

**Architecture:** React Router 8 SPA with four file-based routes plus a shared bottom sheet for transaction entry. TanStack Query owns fetching and cache invalidation. All arithmetic lives in two pure, separately tested modules (`money.ts` for pence/pounds conversion, `summary.ts` for aggregation) so the risky logic is testable without mounting React.

**Tech Stack:** React 19.2.8, React Router 8.3, Mantine 8, TanStack Query 5, Vitest, Testing Library.

## Global Constraints

- Node 24 (`.nvmrc`); run `nvm use` before any command.
- **Requires the API changes plan** (`2026-07-26-budget-api-changes.md`) to be complete and merged. This plan consumes `PUT /api/transactions/{yearMonth}/{transactionId}`, `POST /api/categories/{categoryId}/reassign`, optional descriptions, and the `INVESTMENT_IN`/`INVESTMENT_OUT` types.
- All amounts crossing the API are **integer pence**. Conversion to pounds happens only in `money.ts`, never inline.
- Transaction types are `EXPENSE | INCOME | INVESTMENT_IN | INVESTMENT_OUT`.
- Category types are `EXPENSE | INCOME | INVESTMENT`.
- No optimistic updates — show a pending state and wait for the server.
- Mobile-first: design at 375px width, enhance upward.
- Commit after each task. Conventional commits, imperative mood, ≤72 char subject.

---

### Task 1: Add TanStack Query and configure app-side testing

Installs the data layer and extends Vitest to cover `app/`. The existing config globs only `src/**` with `environment: 'node'`, so no `app/` test would run today.

**Files:**
- Modify: `package.json`, `vitest.config.ts`, `app/root.tsx`
- Create: `app/lib/__tests__/setup-check.test.ts` (temporary, deleted in Step 6)

**Interfaces:**
- Produces: a `QueryClientProvider` wrapping the app; `app/**/__tests__/**/*.test.{ts,tsx}` files are discovered by Vitest.

- [ ] **Step 1: Install dependencies**

```bash
nvm use
yarn add @tanstack/react-query@^5.101.4
yarn add -D @testing-library/react@^16.3.2 @testing-library/jest-dom@^7.0.0 jsdom@^29.1.1
```

- [ ] **Step 2: Extend the Vitest configuration**

Replace `vitest.config.ts` entirely:

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['app/**/__tests__/**/*.test.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 3: Create the test setup file**

Create `vitest.setup.ts` at the repository root:

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add a temporary test proving app/ tests are discovered**

Create `app/lib/__tests__/setup-check.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('app test setup', () => {
  it('runs tests under app/', () => {
    expect(document.body).toBeDefined();
  });
});
```

- [ ] **Step 5: Run the suite and confirm both projects execute**

```bash
yarn test
```

Expected: the existing API tests pass **and** the new app test passes, reported under two project names.

- [ ] **Step 6: Remove the temporary test**

```bash
rm app/lib/__tests__/setup-check.test.ts
```

- [ ] **Step 7: Wire the QueryClientProvider**

In `app/root.tsx`, add the imports:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

Create a single client at module scope (outside the component, so it is not recreated on render):

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});
```

Wrap the existing `MantineProvider` subtree in `<QueryClientProvider client={queryClient}>…</QueryClientProvider>`.

- [ ] **Step 8: Verify the app still builds and renders**

```bash
yarn typecheck
VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://example/api yarn build
```

Expected: typecheck clean, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add package.json yarn.lock vitest.config.ts vitest.setup.ts app/root.tsx
git commit -m "chore: add TanStack Query and app-side test environment"
```

---

### Task 2: Money conversion module

Every amount in the API is an integer of pence while users type decimal pounds. This is the single most likely source of a silent money bug, so it is isolated and tested directly.

**Files:**
- Create: `app/lib/money.ts`
- Create: `app/lib/__tests__/money.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  function parsePounds(input: string): { ok: true; pence: number } | { ok: false; message: string }
  function formatPence(pence: number): string        // 480 -> "£4.80"
  function formatPencePlain(pence: number): string   // 480 -> "4.80"
  ```

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/money.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePounds, formatPence, formatPencePlain } from '../money';

describe('parsePounds', () => {
  it('parses whole pounds', () => {
    expect(parsePounds('4')).toEqual({ ok: true, pence: 400 });
  });

  it('parses pounds and pence', () => {
    expect(parsePounds('4.80')).toEqual({ ok: true, pence: 480 });
  });

  it('parses a single decimal place as tenths of a pound', () => {
    expect(parsePounds('4.8')).toEqual({ ok: true, pence: 480 });
  });

  it('handles a leading pound sign and surrounding whitespace', () => {
    expect(parsePounds(' £4.80 ')).toEqual({ ok: true, pence: 480 });
  });

  it('handles thousands separators', () => {
    expect(parsePounds('1,250.00')).toEqual({ ok: true, pence: 125000 });
  });

  it('avoids floating point drift', () => {
    expect(parsePounds('19.99')).toEqual({ ok: true, pence: 1999 });
    expect(parsePounds('0.07')).toEqual({ ok: true, pence: 7 });
    expect(parsePounds('1234.56')).toEqual({ ok: true, pence: 123456 });
  });

  it('rejects more than two decimal places', () => {
    const res = parsePounds('4.805');
    expect(res.ok).toBe(false);
  });

  it('rejects zero', () => {
    expect(parsePounds('0').ok).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(parsePounds('-5').ok).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(parsePounds('abc').ok).toBe(false);
    expect(parsePounds('').ok).toBe(false);
  });
});

describe('formatPence', () => {
  it('formats with a pound sign and two decimals', () => {
    expect(formatPence(480)).toBe('£4.80');
  });

  it('formats whole pounds with trailing zeros', () => {
    expect(formatPence(40000)).toBe('£400.00');
  });

  it('adds thousands separators', () => {
    expect(formatPence(125000)).toBe('£1,250.00');
  });

  it('formats zero', () => {
    expect(formatPence(0)).toBe('£0.00');
  });
});

describe('formatPencePlain', () => {
  it('formats without a currency symbol for form inputs', () => {
    expect(formatPencePlain(480)).toBe('4.80');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test app/lib/__tests__/money.test.ts
```

Expected: FAIL — module `../money` does not exist.

- [ ] **Step 3: Implement the module**

Create `app/lib/money.ts`:

```typescript
export type ParseResult =
  | { ok: true; pence: number }
  | { ok: false; message: string };

export function parsePounds(input: string): ParseResult {
  const cleaned = input.trim().replace(/^£/, '').replace(/,/g, '').trim();

  if (cleaned === '') {
    return { ok: false, message: 'Enter an amount' };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    if (/^\d+\.\d{3,}$/.test(cleaned)) {
      return { ok: false, message: 'Use at most two decimal places' };
    }
    return { ok: false, message: 'Enter a valid amount' };
  }

  const [whole, fraction = ''] = cleaned.split('.');
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (pence <= 0) {
    return { ok: false, message: 'Amount must be greater than zero' };
  }

  return { ok: true, pence };
}

const formatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

export function formatPence(pence: number): string {
  return formatter.format(pence / 100);
}

export function formatPencePlain(pence: number): string {
  return (pence / 100).toFixed(2);
}
```

Note: parsing works on the decimal string rather than `parseFloat`, so `19.99`
never becomes `1998.9999999999998`.

- [ ] **Step 4: Run tests**

```bash
yarn test app/lib/__tests__/money.test.ts && yarn typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/money.ts app/lib/__tests__/money.test.ts
git commit -m "feat: add pence/pounds conversion module"
```

---

### Task 3: Month summary aggregation module

Turns a month of transactions into the home screen's view model. Pure function — no React, no fetching — including the weekly-to-monthly target normalisation.

**Files:**
- Create: `app/lib/summary.ts`
- Create: `app/lib/__tests__/summary.test.ts`

**Interfaces:**
- Consumes: `Category`, `Transaction`, `CategoryTarget` types (re-exported in Step 3)
- Produces:
  ```typescript
  interface CategoryProgress {
    categoryId: string;
    name: string;
    icon: string;
    spent: number;          // pence
    target: number;         // pence, normalised to the month
    rawTarget: number;      // pence, as stored
    period: 'MONTHLY' | 'WEEKLY';
    percent: number;        // 0..n, integer
    isOver: boolean;
  }
  interface MonthSummary {
    spending: CategoryProgress[];
    saving: CategoryProgress[];
    incomeTotal: number;
    recent: Transaction[];
  }
  function normaliseTargetToMonth(target: number, period: 'MONTHLY' | 'WEEKLY', yearMonth: string): number
  function buildMonthSummary(input: {
    transactions: Transaction[];
    categories: Category[];
    targets: CategoryTarget[];
    yearMonth: string;
    recentLimit?: number;
  }): MonthSummary
  ```

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/summary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildMonthSummary, normaliseTargetToMonth } from '../summary';
import type { Category, Transaction, CategoryTarget } from '../types';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '' },
  { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'tools-kitchen-2', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
  { categoryId: 'cat-stocks', name: 'Stocks', type: 'INVESTMENT', icon: 'chart-line', isDefault: true, createdAt: '' },
];

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't', yearMonth: '2026-07', amount: 100, type: 'EXPENSE',
    categoryId: 'cat-food', description: '', date: '2026-07-10', createdAt: '', ...over,
  };
}

describe('normaliseTargetToMonth', () => {
  it('leaves a monthly target unchanged', () => {
    expect(normaliseTargetToMonth(40000, 'MONTHLY', '2026-07')).toBe(40000);
  });

  it('scales a weekly target by days in a 31-day month', () => {
    // 5000p * 31/7 = 22142.85 -> 22143
    expect(normaliseTargetToMonth(5000, 'WEEKLY', '2026-07')).toBe(22143);
  });

  it('scales a weekly target by days in February', () => {
    // 5000p * 28/7 = 20000
    expect(normaliseTargetToMonth(5000, 'WEEKLY', '2026-02')).toBe(20000);
  });

  it('accounts for a leap February', () => {
    // 5000p * 29/7 = 20714.28 -> 20714
    expect(normaliseTargetToMonth(5000, 'WEEKLY', '2028-02')).toBe(20714);
  });
});

describe('buildMonthSummary', () => {
  const base = { categories, yearMonth: '2026-07' };

  it('sums expense spending per category', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 1000, categoryId: 'cat-food' }),
        txn({ amount: 2000, categoryId: 'cat-food' }),
      ],
      targets: [{ categoryId: 'cat-food', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending).toHaveLength(1);
    expect(res.spending[0].spent).toBe(3000);
    expect(res.spending[0].percent).toBe(8);
    expect(res.spending[0].isOver).toBe(false);
  });

  it('flags a category over its target', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 22400, categoryId: 'cat-dining' })],
      targets: [{ categoryId: 'cat-dining', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending[0].isOver).toBe(true);
    expect(res.spending[0].percent).toBe(112);
  });

  it('sorts over-target categories first', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 1000, categoryId: 'cat-food' }),
        txn({ amount: 22400, categoryId: 'cat-dining' }),
      ],
      targets: [
        { categoryId: 'cat-food', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' },
        { categoryId: 'cat-dining', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' },
      ],
    });
    expect(res.spending[0].categoryId).toBe('cat-dining');
  });

  it('nets investment IN against OUT for saving progress', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 30000, type: 'INVESTMENT_IN', categoryId: 'cat-stocks' }),
        txn({ amount: 10000, type: 'INVESTMENT_IN', categoryId: 'cat-stocks' }),
        txn({ amount: 5000, type: 'INVESTMENT_OUT', categoryId: 'cat-stocks' }),
      ],
      targets: [{ categoryId: 'cat-stocks', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.saving).toHaveLength(1);
    expect(res.saving[0].spent).toBe(35000);
  });

  it('never reports negative saving progress', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 5000, type: 'INVESTMENT_OUT', categoryId: 'cat-stocks' })],
      targets: [{ categoryId: 'cat-stocks', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.saving[0].spent).toBe(0);
  });

  it('totals income without requiring a target', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 240000, type: 'INCOME', categoryId: 'cat-salary' })],
      targets: [],
    });
    expect(res.incomeTotal).toBe(240000);
  });

  it('excludes categories with no target from progress lists', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 1000, categoryId: 'cat-food' })],
      targets: [],
    });
    expect(res.spending).toHaveLength(0);
  });

  it('ignores targets whose category no longer exists', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [],
      targets: [{ categoryId: 'cat-deleted', targetAmount: 1000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending).toHaveLength(0);
    expect(res.saving).toHaveLength(0);
  });

  it('returns recent transactions newest first, limited', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ transactionId: 'a', date: '2026-07-01' }),
        txn({ transactionId: 'b', date: '2026-07-20' }),
        txn({ transactionId: 'c', date: '2026-07-10' }),
      ],
      targets: [],
      recentLimit: 2,
    });
    expect(res.recent.map(t => t.transactionId)).toEqual(['b', 'c']);
  });

  it('reports zero percent when the normalised target is zero', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 1000, categoryId: 'cat-food' })],
      targets: [{ categoryId: 'cat-food', targetAmount: 0, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending[0].percent).toBe(0);
    expect(res.spending[0].isOver).toBe(false);
  });
});
```

- [ ] **Step 2: Create the shared frontend types**

Create `app/lib/types.ts`, mirroring the API contract so the UI does not import from `src/api`:

```typescript
export type TransactionType = 'EXPENSE' | 'INCOME' | 'INVESTMENT_IN' | 'INVESTMENT_OUT';
export type CategoryType = 'EXPENSE' | 'INCOME' | 'INVESTMENT';
export type TargetPeriod = 'MONTHLY' | 'WEEKLY';

export interface Category {
  categoryId: string;
  name: string;
  type: CategoryType;
  icon: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Transaction {
  transactionId: string;
  yearMonth: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
  createdAt: string;
}

export interface CategoryTarget {
  categoryId: string;
  targetAmount: number;
  period: TargetPeriod;
  updatedAt: string;
}
```

- [ ] **Step 3: Run to verify the summary tests fail**

```bash
yarn test app/lib/__tests__/summary.test.ts
```

Expected: FAIL — module `../summary` does not exist.

- [ ] **Step 4: Implement the module**

Create `app/lib/summary.ts`:

```typescript
import type { Category, CategoryTarget, TargetPeriod, Transaction } from './types';

export interface CategoryProgress {
  categoryId: string;
  name: string;
  icon: string;
  spent: number;
  target: number;
  rawTarget: number;
  period: TargetPeriod;
  percent: number;
  isOver: boolean;
}

export interface MonthSummary {
  spending: CategoryProgress[];
  saving: CategoryProgress[];
  incomeTotal: number;
  recent: Transaction[];
}

export function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function normaliseTargetToMonth(
  target: number,
  period: TargetPeriod,
  yearMonth: string,
): number {
  if (period === 'MONTHLY') return target;
  return Math.round((target * daysInMonth(yearMonth)) / 7);
}

function toProgress(
  category: Category,
  target: CategoryTarget,
  spent: number,
  yearMonth: string,
): CategoryProgress {
  const normalised = normaliseTargetToMonth(target.targetAmount, target.period, yearMonth);
  const percent = normalised > 0 ? Math.round((spent / normalised) * 100) : 0;
  return {
    categoryId: category.categoryId,
    name: category.name,
    icon: category.icon,
    spent,
    target: normalised,
    rawTarget: target.targetAmount,
    period: target.period,
    percent,
    isOver: normalised > 0 && spent > normalised,
  };
}

function byOverThenPercent(a: CategoryProgress, b: CategoryProgress): number {
  if (a.isOver !== b.isOver) return a.isOver ? -1 : 1;
  return b.percent - a.percent;
}

export function buildMonthSummary(input: {
  transactions: Transaction[];
  categories: Category[];
  targets: CategoryTarget[];
  yearMonth: string;
  recentLimit?: number;
}): MonthSummary {
  const { transactions, categories, targets, yearMonth, recentLimit = 5 } = input;

  const categoryById = new Map(categories.map(c => [c.categoryId, c]));

  const spending: CategoryProgress[] = [];
  const saving: CategoryProgress[] = [];
  let incomeTotal = 0;

  for (const t of transactions) {
    if (t.type === 'INCOME') incomeTotal += t.amount;
  }

  for (const target of targets) {
    const category = categoryById.get(target.categoryId);
    if (!category) continue;

    if (category.type === 'EXPENSE') {
      const spent = transactions
        .filter(t => t.categoryId === category.categoryId && t.type === 'EXPENSE')
        .reduce((sum, t) => sum + t.amount, 0);
      spending.push(toProgress(category, target, spent, yearMonth));
    } else if (category.type === 'INVESTMENT') {
      const net = transactions
        .filter(t => t.categoryId === category.categoryId)
        .reduce((sum, t) => {
          if (t.type === 'INVESTMENT_IN') return sum + t.amount;
          if (t.type === 'INVESTMENT_OUT') return sum - t.amount;
          return sum;
        }, 0);
      saving.push(toProgress(category, target, Math.max(0, net), yearMonth));
    }
  }

  const recent = [...transactions]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, recentLimit);

  return {
    spending: spending.sort(byOverThenPercent),
    saving: saving.sort(byOverThenPercent),
    incomeTotal,
    recent,
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/types.ts app/lib/summary.ts app/lib/__tests__/summary.test.ts
git commit -m "feat: add month summary aggregation module"
```

---

### Task 4: Typed API client and query hooks

Wraps `useProtectedApi` in typed calls and exposes TanStack Query hooks with the invalidation rules from the spec.

**Files:**
- Create: `app/lib/api.ts`
- Create: `app/lib/queries.ts`
- Modify: `app/hooks/useProtectedApi.ts` (return the raw `Response` handling for 204s)

**Interfaces:**
- Consumes: `useProtectedApi().request`, types from `app/lib/types.ts`
- Produces:
  ```typescript
  function useCategories(): UseQueryResult<Category[]>
  function useTargets(): UseQueryResult<CategoryTarget[]>
  function useTransactions(yearMonth: string): UseQueryResult<Transaction[]>
  function useCreateTransaction(yearMonth: string)
  function useUpdateTransaction(yearMonth: string)
  function useDeleteTransaction(yearMonth: string)
  function useSetTarget()
  function useDeleteTarget()
  function useCreateCategory()
  function useDeleteCategory()
  function useReassignCategory()
  const queryKeys = { categories: ['categories'], targets: ['targets'], transactions: (ym: string) => ['transactions', ym] }
  ```

- [ ] **Step 1: Make useProtectedApi tolerate empty responses**

`DELETE` endpoints return 204 with an empty body, which `response.json()` rejects. In `app/hooks/useProtectedApi.ts`, replace the `return await response.json();` line:

```typescript
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
```

- [ ] **Step 2: Create the typed API client**

Create `app/lib/api.ts`:

```typescript
import type { Category, CategoryTarget, TargetPeriod, Transaction, TransactionType } from './types';

type Request = (endpoint: string, options?: RequestInit) => Promise<unknown>;

export interface TransactionInput {
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
}

export function createApi(request: Request) {
  return {
    getCategories: async (): Promise<Category[]> => {
      const res = await request('/api/categories') as { categories: Category[] };
      return res.categories;
    },
    createCategory: async (input: { name: string; type: Category['type']; icon: string }): Promise<Category> => {
      const res = await request('/api/categories', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { category: Category };
      return res.category;
    },
    deleteCategory: async (categoryId: string): Promise<void> => {
      await request(`/api/categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE' });
    },
    reassignCategory: async (categoryId: string, toCategoryId: string): Promise<number> => {
      const res = await request(`/api/categories/${encodeURIComponent(categoryId)}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ toCategoryId }),
      }) as { reassigned: number };
      return res.reassigned;
    },

    getTransactions: async (yearMonth: string): Promise<Transaction[]> => {
      const [year, month] = yearMonth.split('-');
      const res = await request(`/api/transactions?year=${year}&month=${Number(month)}`) as { transactions: Transaction[] };
      return res.transactions;
    },
    createTransaction: async (input: TransactionInput): Promise<Transaction> => {
      const res = await request('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { transaction: Transaction };
      return res.transaction;
    },
    updateTransaction: async (yearMonth: string, transactionId: string, input: TransactionInput): Promise<Transaction> => {
      const res = await request(`/api/transactions/${yearMonth}/${encodeURIComponent(transactionId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }) as { transaction: Transaction };
      return res.transaction;
    },
    deleteTransaction: async (yearMonth: string, transactionId: string): Promise<void> => {
      await request(`/api/transactions/${yearMonth}/${encodeURIComponent(transactionId)}`, { method: 'DELETE' });
    },

    getTargets: async (): Promise<CategoryTarget[]> => {
      const res = await request('/api/targets') as { targets: CategoryTarget[] };
      return res.targets;
    },
    setTarget: async (categoryId: string, targetAmount: number, period: TargetPeriod): Promise<CategoryTarget> => {
      const res = await request(`/api/targets/${encodeURIComponent(categoryId)}`, {
        method: 'PUT',
        body: JSON.stringify({ targetAmount, period }),
      }) as { target: CategoryTarget };
      return res.target;
    },
    deleteTarget: async (categoryId: string): Promise<void> => {
      await request(`/api/targets/${encodeURIComponent(categoryId)}`, { method: 'DELETE' });
    },
  };
}

export type Api = ReturnType<typeof createApi>;
```

The response envelope keys above are verified against the handlers as of
2026-07-26: `{ categories }` and `{ category }` from `categories.ts`,
`{ targets }` and `{ target }` from `targets.ts`, `{ transactions }` and
`{ transaction }` from `transactions.ts`. The target PUT body is
`{ targetAmount, period }`, where `targetAmount` must be a positive integer —
`parsePounds` already rejects zero and negatives.

- [ ] **Step 3: Create the query hooks**

Create `app/lib/queries.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useProtectedApi } from '~/hooks/useProtectedApi';
import { createApi, type TransactionInput } from './api';
import type { Category, TargetPeriod } from './types';

export const queryKeys = {
  categories: ['categories'] as const,
  targets: ['targets'] as const,
  transactions: (yearMonth: string) => ['transactions', yearMonth] as const,
};

function useApi() {
  const { request } = useProtectedApi();
  return useMemo(() => createApi(request), [request]);
}

export function useCategories() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.getCategories(),
    staleTime: 5 * 60_000,
  });
}

export function useTargets() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.targets, queryFn: () => api.getTargets() });
}

export function useTransactions(yearMonth: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.transactions(yearMonth),
    queryFn: () => api.getTransactions(yearMonth),
  });
}

export function useCreateTransaction(yearMonth: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransactionInput) => api.createTransaction(input),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(yearMonth) });
      if (created.yearMonth !== yearMonth) {
        qc.invalidateQueries({ queryKey: queryKeys.transactions(created.yearMonth) });
      }
    },
  });
}

export function useUpdateTransaction(yearMonth: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; input: TransactionInput }) =>
      api.updateTransaction(yearMonth, vars.transactionId, vars.input),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(yearMonth) });
      if (updated.yearMonth !== yearMonth) {
        qc.invalidateQueries({ queryKey: queryKeys.transactions(updated.yearMonth) });
      }
    },
  });
}

export function useDeleteTransaction(yearMonth: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transactionId: string) => api.deleteTransaction(yearMonth, transactionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions(yearMonth) }),
  });
}

export function useSetTarget() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; targetAmount: number; period: TargetPeriod }) =>
      api.setTarget(vars.categoryId, vars.targetAmount, vars.period),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.targets }),
  });
}

export function useDeleteTarget() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => api.deleteTarget(categoryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.targets }),
  });
}

export function useCreateCategory() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; type: Category['type']; icon: string }) => api.createCategory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.categories }),
  });
}

export function useReassignCategory() {
  const api = useApi();
  return useMutation({
    mutationFn: (vars: { categoryId: string; toCategoryId: string }) =>
      api.reassignCategory(vars.categoryId, vars.toCategoryId),
  });
}

export function useDeleteCategory() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => api.deleteCategory(categoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories });
      qc.invalidateQueries({ queryKey: queryKeys.targets });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
```

- [ ] **Step 4: Verify it compiles**

```bash
yarn typecheck && yarn test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/api.ts app/lib/queries.ts app/hooks/useProtectedApi.ts
git commit -m "feat: add typed API client and query hooks"
```

---

### Task 5: Month navigation helpers and shared UI shell

Adds month arithmetic used by every screen, plus the bottom tab bar and floating action button.

**Files:**
- Create: `app/lib/months.ts`
- Create: `app/lib/__tests__/months.test.ts`
- Modify: `app/components/layout/DefaultLayout.tsx`

**Interfaces:**
- Produces:
  ```typescript
  function currentYearMonth(now?: Date): string      // "2026-07"
  function shiftMonth(yearMonth: string, delta: number): string
  function formatMonthLabel(yearMonth: string): string  // "July 2026"
  function todayIso(now?: Date): string              // "2026-07-26"
  ```

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/months.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { currentYearMonth, shiftMonth, formatMonthLabel, todayIso } from '../months';

describe('currentYearMonth', () => {
  it('formats the given date as YYYY-MM', () => {
    expect(currentYearMonth(new Date(2026, 6, 26))).toBe('2026-07');
  });

  it('zero-pads single digit months', () => {
    expect(currentYearMonth(new Date(2026, 0, 5))).toBe('2026-01');
  });
});

describe('shiftMonth', () => {
  it('moves forward within a year', () => {
    expect(shiftMonth('2026-07', 1)).toBe('2026-08');
  });

  it('moves backward within a year', () => {
    expect(shiftMonth('2026-07', -1)).toBe('2026-06');
  });

  it('rolls over the year boundary forward', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('rolls over the year boundary backward', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('formatMonthLabel', () => {
  it('renders a human readable label', () => {
    expect(formatMonthLabel('2026-07')).toBe('July 2026');
  });
});

describe('todayIso', () => {
  it('formats the given date as YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 6, 5))).toBe('2026-07-05');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test app/lib/__tests__/months.test.ts
```

Expected: FAIL — module `../months` does not exist.

- [ ] **Step 3: Implement the module**

Create `app/lib/months.ts`:

```typescript
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return `${d.toLocaleString('en-GB', { month: 'long' })} ${year}`;
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test app/lib/__tests__/months.test.ts && yarn typecheck
```

Expected: PASS.

- [ ] **Step 5: Add the bottom tab bar and floating action button**

In `app/components/layout/DefaultLayout.tsx`, keep the existing header and Auth0 wiring. Add below the main content area:

```tsx
import { NavLink as RouterNavLink, useLocation } from 'react-router';
import { ActionIcon, Group, Paper, Text } from '@mantine/core';
import { IconHome, IconList, IconTarget, IconPlus } from '@tabler/icons-react';

const TABS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/targets', label: 'Targets', Icon: IconTarget },
];

function BottomTabs() {
  const { pathname } = useLocation();
  return (
    <Paper
      component="nav"
      withBorder
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}
      p="xs"
    >
      <Group justify="space-around">
        {TABS.map(({ to, label, Icon }) => {
          const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
          return (
            <RouterNavLink key={to} to={to} style={{ textDecoration: 'none' }} aria-label={label}>
              <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
                <Icon size={22} stroke={active ? 2.4 : 1.6} />
                <Text size="xs" fw={active ? 700 : 400}>{label}</Text>
              </Group>
            </RouterNavLink>
          );
        })}
      </Group>
    </Paper>
  );
}
```

Render `<BottomTabs />` at the end of the layout, and add bottom padding (`pb={80}`) to the main content container so the last row is not hidden behind the bar.

The floating action button is added in Task 6, once the sheet it opens exists.

- [ ] **Step 6: Verify the app renders with tabs**

```bash
yarn typecheck
VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://example/api yarn dev
```

Open http://localhost:5173 and confirm three tabs appear fixed at the bottom and navigate correctly. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add app/lib/months.ts app/lib/__tests__/months.test.ts app/components/layout/DefaultLayout.tsx
git commit -m "feat: add month helpers and bottom tab navigation"
```

---

### Task 6: Transaction sheet for add and edit

One bottom sheet serving both creation and editing. This is the primary flow, so it defaults the date to today and opens with the amount field focused.

**Files:**
- Create: `app/components/transactions/TransactionSheet.tsx`
- Create: `app/components/transactions/__tests__/TransactionSheet.test.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx` (add the floating action button)

**Interfaces:**
- Consumes: `parsePounds`, `formatPencePlain` (Task 2), `todayIso` (Task 5), `useCategories`, `useCreateTransaction`, `useUpdateTransaction` (Task 4)
- Produces:
  ```typescript
  interface TransactionSheetProps {
    opened: boolean;
    onClose: () => void;
    yearMonth: string;
    editing?: Transaction | null;
  }
  function TransactionSheet(props: TransactionSheetProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `app/components/transactions/__tests__/TransactionSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockCreate = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
    ],
    isLoading: false,
  }),
  useCreateTransaction: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TransactionSheet } from '../TransactionSheet';

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <TransactionSheet opened onClose={() => {}} yearMonth="2026-07" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('TransactionSheet', () => {
  beforeEach(() => { mockCreate.mockReset(); mockCreate.mockResolvedValue({}); });

  it('shows a validation message for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), 'abc');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects more than two decimal places', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.805');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('submits a valid transaction as integer pence', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 480, type: 'EXPENSE' }));
  });
});
```

Install the interaction library used above:

```bash
yarn add -D @testing-library/user-event@^14.6.1
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test app/components/transactions/__tests__/TransactionSheet.test.tsx
```

Expected: FAIL — module `../TransactionSheet` does not exist.

- [ ] **Step 3: Implement the sheet**

Create `app/components/transactions/TransactionSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button, Drawer, Group, SegmentedControl, Select, Stack, TextInput } from '@mantine/core';
import { parsePounds, formatPencePlain } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useCategories, useCreateTransaction, useUpdateTransaction } from '~/lib/queries';
import type { Transaction, TransactionType } from '~/lib/types';

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
}

const TYPE_OPTIONS: { label: string; value: TransactionType }[] = [
  { label: 'Spend', value: 'EXPENSE' },
  { label: 'Income', value: 'INCOME' },
  { label: 'Invest in', value: 'INVESTMENT_IN' },
  { label: 'Invest out', value: 'INVESTMENT_OUT' },
];

export function TransactionSheet({ opened, onClose, yearMonth, editing }: TransactionSheetProps) {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction(yearMonth);
  const update = useUpdateTransaction(yearMonth);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
    }
    setError(null);
  }, [opened, editing]);

  const expectedCategoryType =
    type === 'EXPENSE' ? 'EXPENSE' : type === 'INCOME' ? 'INCOME' : 'INVESTMENT';

  const options = categories
    .filter(c => c.type === expectedCategoryType)
    .map(c => ({ value: c.categoryId, label: c.name }));

  async function handleSave() {
    const parsed = parsePounds(amount);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (!categoryId) {
      setError('Choose a category');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Date must be YYYY-MM-DD');
      return;
    }

    const input = { amount: parsed.pence, type, categoryId, description, date };

    try {
      if (editing) {
        await update.mutateAsync({ transactionId: editing.transactionId, input });
      } else {
        await create.mutateAsync(input);
      }
      onClose();
    } catch {
      setError('Could not save. Check your connection and try again.');
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto"
      title={editing ? 'Edit transaction' : 'Add transaction'}>
      <Stack>
        <TextInput
          label="Amount"
          placeholder="0.00"
          inputMode="decimal"
          data-autofocus
          value={amount}
          onChange={e => setAmount(e.currentTarget.value)}
          error={error}
        />
        <SegmentedControl
          fullWidth
          value={type}
          onChange={value => { setType(value as TransactionType); setCategoryId(null); }}
          data={TYPE_OPTIONS}
        />
        <Select
          label="Category"
          placeholder="Choose"
          searchable
          data={options}
          value={categoryId}
          onChange={setCategoryId}
        />
        <TextInput
          label="Note (optional)"
          value={description}
          onChange={e => setDescription(e.currentTarget.value)}
          maxLength={200}
        />
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={e => setDate(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={pending}>Save</Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck
```

Expected: PASS.

- [ ] **Step 5: Add the floating action button to the layout**

In `app/components/layout/DefaultLayout.tsx`, add state and render the button plus sheet above `<BottomTabs />`:

```tsx
const [addOpen, setAddOpen] = useState(false);
```

```tsx
<ActionIcon
  size={56} radius="xl" variant="filled" aria-label="Add transaction"
  onClick={() => setAddOpen(true)}
  style={{ position: 'fixed', right: 16, bottom: 84, zIndex: 101 }}
>
  <IconPlus size={26} />
</ActionIcon>
<TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />
```

- [ ] **Step 6: Verify in the browser**

```bash
VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://example/api yarn dev
```

Confirm the button opens the sheet and the amount field is focused. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add app/components/transactions app/components/layout/DefaultLayout.tsx package.json yarn.lock
git commit -m "feat: add transaction entry and edit sheet"
```

---

### Task 7: Home screen

The month view: spending against targets, saving against targets, income total, recent transactions.

**Files:**
- Create: `app/components/budget/CategoryProgressRow.tsx`
- Create: `app/components/budget/MonthHeader.tsx`
- Create: `app/components/transactions/TransactionRow.tsx`
- Modify: `app/routes/_index.tsx`

**Interfaces:**
- Consumes: `buildMonthSummary` (Task 3), `formatPence` (Task 2), month helpers (Task 5), query hooks (Task 4)
- Produces: `CategoryProgressRow({ progress })`, `MonthHeader({ yearMonth, onChange })`, `TransactionRow({ transaction, categoryName, onEdit, onDelete })`

- [ ] **Step 1: Create the month header**

Create `app/components/budget/MonthHeader.tsx`:

```tsx
import { ActionIcon, Group, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { formatMonthLabel, shiftMonth } from '~/lib/months';

export function MonthHeader({ yearMonth, onChange }: { yearMonth: string; onChange: (ym: string) => void }) {
  return (
    <Group justify="space-between" mb="md">
      <ActionIcon variant="subtle" aria-label="Previous month" onClick={() => onChange(shiftMonth(yearMonth, -1))}>
        <IconChevronLeft size={20} />
      </ActionIcon>
      <Title order={3}>{formatMonthLabel(yearMonth)}</Title>
      <ActionIcon variant="subtle" aria-label="Next month" onClick={() => onChange(shiftMonth(yearMonth, 1))}>
        <IconChevronRight size={20} />
      </ActionIcon>
    </Group>
  );
}
```

- [ ] **Step 2: Create the progress row**

Create `app/components/budget/CategoryProgressRow.tsx`:

```tsx
import { Group, Progress, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { CategoryProgress } from '~/lib/summary';

export function CategoryProgressRow({ progress }: { progress: CategoryProgress }) {
  const { name, spent, target, percent, isOver, period, rawTarget } = progress;
  return (
    <Stack gap={4} mb="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>{isOver ? `⚠ ${name}` : name}</Text>
        <Text size="sm" c={isOver ? 'red' : undefined}>
          {formatPence(spent)} / {formatPence(target)} · {percent}%
        </Text>
      </Group>
      <Progress value={Math.min(percent, 100)} color={isOver ? 'red' : 'teal'} aria-label={`${name} progress`} />
      {period === 'WEEKLY' && (
        <Text size="xs" c="dimmed">{formatPence(rawTarget)}/wk (≈{formatPence(target)}/mo)</Text>
      )}
    </Stack>
  );
}
```

- [ ] **Step 3: Create the transaction row**

Create `app/components/transactions/TransactionRow.tsx`:

```tsx
import { ActionIcon, Group, Menu, Text } from '@mantine/core';
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import type { Transaction } from '~/lib/types';

const OUTGOING = new Set(['EXPENSE', 'INVESTMENT_IN']);

export function TransactionRow({
  transaction, categoryName, onEdit, onDelete,
}: {
  transaction: Transaction;
  categoryName: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
}) {
  const label = transaction.description || categoryName;
  const sign = OUTGOING.has(transaction.type) ? '−' : '+';

  return (
    <Group justify="space-between" wrap="nowrap" py={6}>
      <div style={{ minWidth: 0 }}>
        <Text truncate>{label}</Text>
        <Text size="xs" c="dimmed">{categoryName} · {transaction.date}</Text>
      </div>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{sign}{formatPence(transaction.amount)}</Text>
        {(onEdit || onDelete) && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDelete && <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
```

`categoryName` is resolved by the caller; when a category id does not resolve,
the caller passes `'Unknown category'` so an orphaned row renders rather than
crashing.

- [ ] **Step 4: Build the home route**

Replace `app/routes/_index.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { CategoryProgressRow } from '~/components/budget/CategoryProgressRow';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { buildMonthSummary } from '~/lib/summary';
import { formatPence } from '~/lib/money';
import { currentYearMonth } from '~/lib/months';
import { useCategories, useTargets, useTransactions } from '~/lib/queries';

export default function Home() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const categories = useCategories();
  const targets = useTargets();
  const transactions = useTransactions(yearMonth);

  const isLoading = categories.isLoading || targets.isLoading || transactions.isLoading;
  const error = categories.error || targets.error || transactions.error;

  const summary = useMemo(() => buildMonthSummary({
    transactions: transactions.data ?? [],
    categories: categories.data ?? [],
    targets: targets.data ?? [],
    yearMonth,
  }), [transactions.data, categories.data, targets.data, yearMonth]);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';

  if (error) {
    return (
      <Alert color="red" title="Could not load your budget">
        <Text mb="sm">Something went wrong fetching this month.</Text>
        <Button onClick={() => { categories.refetch(); targets.refetch(); transactions.refetch(); }}>
          Try again
        </Button>
      </Alert>
    );
  }

  if (isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const hasTargets = summary.spending.length > 0 || summary.saving.length > 0;

  return (
    <Stack>
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />

      {!hasTargets && (
        <Card withBorder>
          <Text mb="sm">Set a target on a category to track your spending against it.</Text>
          <Button component={Link} to="/targets">Set targets</Button>
        </Card>
      )}

      {summary.spending.length > 0 && (
        <div>
          <Title order={5} mb="xs">Spending vs target</Title>
          {summary.spending.map(p => <CategoryProgressRow key={p.categoryId} progress={p} />)}
        </div>
      )}

      {summary.saving.length > 0 && (
        <div>
          <Title order={5} mb="xs">Saving vs target</Title>
          {summary.saving.map(p => <CategoryProgressRow key={p.categoryId} progress={p} />)}
        </div>
      )}

      <Group justify="space-between">
        <Text c="dimmed">Income this month</Text>
        <Text fw={600}>{formatPence(summary.incomeTotal)}</Text>
      </Group>

      <div>
        <Title order={5} mb="xs">Recent</Title>
        {summary.recent.length === 0
          ? <Text c="dimmed" size="sm">Nothing logged yet this month.</Text>
          : summary.recent.map(t => (
              <TransactionRow key={t.transactionId} transaction={t} categoryName={nameFor(t.categoryId)} />
            ))}
        <Button component={Link} to="/transactions" variant="subtle" mt="xs">See all</Button>
      </div>
    </Stack>
  );
}
```

- [ ] **Step 5: Verify**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/budget app/components/transactions/TransactionRow.tsx app/routes/_index.tsx
git commit -m "feat: add home month view with progress and recent transactions"
```

---

### Task 8: Transactions screen

Full month list with edit and delete.

**Files:**
- Create: `app/routes/transactions.tsx`

**Interfaces:**
- Consumes: `TransactionRow` (Task 7), `TransactionSheet` (Task 6), `MonthHeader` (Task 7), `useTransactions`/`useDeleteTransaction` (Task 4)

- [ ] **Step 1: Create the route**

Create `app/routes/transactions.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, Divider, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { formatPence } from '~/lib/money';
import { currentYearMonth } from '~/lib/months';
import { useCategories, useDeleteTransaction, useTransactions } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export default function Transactions() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [editing, setEditing] = useState<Transaction | null>(null);
  const categories = useCategories();
  const transactions = useTransactions(yearMonth);
  const remove = useDeleteTransaction(yearMonth);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';

  if (transactions.error) {
    return (
      <Alert color="red" title="Could not load transactions">
        <Button onClick={() => transactions.refetch()}>Try again</Button>
      </Alert>
    );
  }

  if (transactions.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const items = [...(transactions.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const outgoing = items
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const byDate = items.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.date] ||= []).push(t);
    return acc;
  }, {});

  return (
    <Stack>
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />
      <Group justify="space-between">
        <Text c="dimmed">{items.length} transactions</Text>
        <Text fw={600}>{formatPence(outgoing)} spent</Text>
      </Group>

      {items.length === 0 && <Text c="dimmed">Nothing logged this month yet.</Text>}

      {Object.entries(byDate).map(([date, dayItems]) => (
        <div key={date}>
          <Divider my="xs" label={date} labelPosition="left" />
          {dayItems.map(t => (
            <TransactionRow
              key={t.transactionId}
              transaction={t}
              categoryName={nameFor(t.categoryId)}
              onEdit={setEditing}
              onDelete={(item) => remove.mutate(item.transactionId)}
            />
          ))}
        </div>
      ))}

      <TransactionSheet
        opened={editing !== null}
        onClose={() => setEditing(null)}
        yearMonth={yearMonth}
        editing={editing}
      />
    </Stack>
  );
}
```

- [ ] **Step 2: Verify**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/routes/transactions.tsx
git commit -m "feat: add transactions list screen with edit and delete"
```

---

### Task 9: Targets screen

Set, edit and clear a target per expense or investment category. Income categories are excluded — income has no target by design.

**Files:**
- Create: `app/routes/targets.tsx`

**Interfaces:**
- Consumes: `parsePounds`, `formatPencePlain` (Task 2), `useCategories`/`useTargets`/`useSetTarget`/`useDeleteTarget` (Task 4)

- [ ] **Step 1: Create the route**

Create `app/routes/targets.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, Card, Group, Loader, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { formatPencePlain, parsePounds } from '~/lib/money';
import { useCategories, useDeleteTarget, useSetTarget, useTargets } from '~/lib/queries';
import type { Category, TargetPeriod } from '~/lib/types';

function TargetRow({ category, amountPence, period }: {
  category: Category;
  amountPence: number | null;
  period: TargetPeriod;
}) {
  const [value, setValue] = useState(amountPence !== null ? formatPencePlain(amountPence) : '');
  const [selectedPeriod, setSelectedPeriod] = useState<TargetPeriod>(period);
  const [error, setError] = useState<string | null>(null);
  const setTarget = useSetTarget();
  const clearTarget = useDeleteTarget();

  function save() {
    const parsed = parsePounds(value);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    setTarget.mutate({ categoryId: category.categoryId, targetAmount: parsed.pence, period: selectedPeriod });
  }

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>{category.name}</Text>
        {amountPence !== null && (
          <Button size="compact-xs" variant="subtle" color="red"
            onClick={() => { setValue(''); clearTarget.mutate(category.categoryId); }}>
            Clear
          </Button>
        )}
      </Group>
      <Group align="flex-end" wrap="nowrap">
        <TextInput
          label="Target" placeholder="0.00" inputMode="decimal" style={{ flex: 1 }}
          value={value} onChange={e => setValue(e.currentTarget.value)} error={error}
          aria-label={`Target for ${category.name}`}
        />
        <SegmentedControl
          value={selectedPeriod}
          onChange={v => setSelectedPeriod(v as TargetPeriod)}
          data={[{ label: '/mo', value: 'MONTHLY' }, { label: '/wk', value: 'WEEKLY' }]}
        />
        <Button onClick={save} loading={setTarget.isPending}>Save</Button>
      </Group>
    </Card>
  );
}

export default function Targets() {
  const categories = useCategories();
  const targets = useTargets();

  if (categories.error || targets.error) {
    return (
      <Alert color="red" title="Could not load targets">
        <Button onClick={() => { categories.refetch(); targets.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || targets.isLoading) {
    return <Group justify="center" py="xl"><Loader /></Group>;
  }

  const targetFor = (id: string) => targets.data?.find(t => t.categoryId === id);
  const eligible = (categories.data ?? []).filter(c => c.type !== 'INCOME');
  const expense = eligible.filter(c => c.type === 'EXPENSE');
  const investment = eligible.filter(c => c.type === 'INVESTMENT');

  return (
    <Stack>
      <Title order={3}>Targets</Title>
      <Text c="dimmed" size="sm">Income has no target — it is shown as a monthly total instead.</Text>

      <Title order={5} mt="md">Spending</Title>
      {expense.map(c => {
        const t = targetFor(c.categoryId);
        return <TargetRow key={c.categoryId} category={c}
          amountPence={t?.targetAmount ?? null} period={t?.period ?? 'MONTHLY'} />;
      })}

      <Title order={5} mt="md">Saving</Title>
      {investment.map(c => {
        const t = targetFor(c.categoryId);
        return <TargetRow key={c.categoryId} category={c}
          amountPence={t?.targetAmount ?? null} period={t?.period ?? 'MONTHLY'} />;
      })}
    </Stack>
  );
}
```

- [ ] **Step 2: Verify**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/routes/targets.tsx
git commit -m "feat: add targets screen"
```

---

### Task 10: Categories screen with reassignment on delete

Create and delete custom categories. Deleting reassigns the category's transactions across all months first, so nothing is orphaned.

**Files:**
- Create: `app/components/categories/ReassignDialog.tsx`
- Create: `app/routes/categories.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx` (link Categories from the header menu)

**Interfaces:**
- Consumes: `useCategories`/`useCreateCategory`/`useDeleteCategory`/`useReassignCategory` (Task 4)
- Produces: `ReassignDialog({ opened, category, candidates, onCancel, onConfirm })`

- [ ] **Step 1: Create the reassign dialog**

Create `app/components/categories/ReassignDialog.tsx`:

```tsx
import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import type { Category } from '~/lib/types';

export function ReassignDialog({
  opened, category, candidates, onCancel, onConfirm, pending,
}: {
  opened: boolean;
  category: Category | null;
  candidates: Category[];
  onCancel: () => void;
  onConfirm: (toCategoryId: string) => void;
  pending: boolean;
}) {
  const [target, setTarget] = useState<string | null>(null);

  return (
    <Modal opened={opened} onClose={onCancel} title={`Delete ${category?.name ?? ''}?`}>
      <Stack>
        <Text size="sm">
          Its transactions will be moved to another category so none are lost.
          This applies to every month, not just this one.
        </Text>
        <Select
          label="Move transactions to"
          placeholder="Choose a category"
          data={candidates.map(c => ({ value: c.categoryId, label: c.name }))}
          value={target}
          onChange={setTarget}
          searchable
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onCancel}>Cancel</Button>
          <Button color="red" disabled={!target} loading={pending}
            onClick={() => target && onConfirm(target)}>
            Move and delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

- [ ] **Step 2: Create the categories route**

Create `app/routes/categories.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { ReassignDialog } from '~/components/categories/ReassignDialog';
import { useCategories, useCreateCategory, useDeleteCategory, useReassignCategory } from '~/lib/queries';
import type { Category, CategoryType } from '~/lib/types';

const TYPES: { value: CategoryType; label: string }[] = [
  { value: 'EXPENSE', label: 'Spending' },
  { value: 'INCOME', label: 'Income' },
  { value: 'INVESTMENT', label: 'Investment' },
];

export default function Categories() {
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const reassign = useReassignCategory();

  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('EXPENSE');
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete(toCategoryId: string) {
    if (!pendingDelete) return;
    try {
      await reassign.mutateAsync({ categoryId: pendingDelete.categoryId, toCategoryId });
      await deleteCategory.mutateAsync(pendingDelete.categoryId);
      setPendingDelete(null);
    } catch {
      setError('Could not delete the category. Nothing was changed.');
      setPendingDelete(null);
    }
  }

  if (categories.error) {
    return (
      <Alert color="red" title="Could not load categories">
        <Button onClick={() => categories.refetch()}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = categories.data ?? [];

  return (
    <Stack>
      <Title order={3}>Categories</Title>
      {error && <Alert color="red" onClose={() => setError(null)} withCloseButton>{error}</Alert>}

      <Card withBorder>
        <Group align="flex-end" wrap="nowrap">
          <TextInput label="New category" placeholder="e.g. Padel" style={{ flex: 1 }}
            value={name} onChange={e => setName(e.currentTarget.value)} />
          <Select label="Type" data={TYPES} value={type}
            onChange={v => setType(v as CategoryType)} allowDeselect={false} />
          <Button
            disabled={name.trim() === ''}
            loading={createCategory.isPending}
            onClick={() => {
              createCategory.mutate({ name: name.trim(), type, icon: 'tag' });
              setName('');
            }}
          >
            Add
          </Button>
        </Group>
      </Card>

      {TYPES.map(({ value, label }) => (
        <div key={value}>
          <Title order={5} mt="md" mb="xs">{label}</Title>
          {all.filter(c => c.type === value).map(c => (
            <Group key={c.categoryId} justify="space-between" py={6}>
              <Group gap="xs">
                <Text>{c.name}</Text>
                {c.isDefault && <Badge size="xs" variant="light">default</Badge>}
              </Group>
              {!c.isDefault && (
                <Button size="compact-xs" variant="subtle" color="red"
                  onClick={() => setPendingDelete(c)}>
                  Delete
                </Button>
              )}
            </Group>
          ))}
        </div>
      ))}

      <ReassignDialog
        opened={pendingDelete !== null}
        category={pendingDelete}
        candidates={all.filter(c => c.type === pendingDelete?.type && c.categoryId !== pendingDelete?.categoryId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        pending={reassign.isPending || deleteCategory.isPending}
      />
    </Stack>
  );
}
```

- [ ] **Step 3: Link Categories from the header menu**

In `app/components/layout/DefaultLayout.tsx`, add a menu item pointing at `/categories` within the existing header menu.

- [ ] **Step 4: Verify**

```bash
yarn test && yarn typecheck
VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://example/api yarn build
```

Expected: all pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/components/categories app/routes/categories.tsx app/components/layout/DefaultLayout.tsx
git commit -m "feat: add categories screen with reassignment on delete"
```

---

### Task 11: End-to-end verification against the deployed API

Everything so far has been verified against mocks. This task exercises the real data path — the part never proven, because every request so far has returned 401 before reaching a handler.

**Files:** none modified.

- [ ] **Step 1: Build and deploy**

Merge to `main` and let CI deploy, or run locally:

```bash
yarn build && cd infra && tofu apply
```

- [ ] **Step 2: Log in through the deployed app**

Open the API Gateway URL, sign in via Auth0, and confirm the home screen loads with the 22 default categories available in the add sheet.

- [ ] **Step 3: Exercise the full loop**

Confirm each of the following in the browser:

1. Add a transaction — appears under Recent immediately.
2. Set a target on that transaction's category — a progress bar appears on Home with the correct percentage.
3. Edit the transaction's amount — the bar updates without a manual refresh.
4. Edit the transaction's date into the next month — it disappears from this month and appears when the arrow moves forward. This is the `TransactWriteItems` path.
5. Set a weekly target — the row shows `£X/wk (≈£Y/mo)` and the percentage uses the monthly figure.
6. Add a custom category, log a transaction against it, then delete the category choosing a replacement — the transaction survives under the new category.
7. Delete a transaction — it disappears and totals update.

- [ ] **Step 4: Confirm no console errors**

Open developer tools and verify the console is clean throughout the loop above.

- [ ] **Step 5: Record the outcome**

If any step fails, capture the failing request and response before fixing. Do not mark this plan complete until every step passes against the deployed environment.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| TanStack Query for fetching and invalidation | 1, 4 |
| `money.ts` pure and tested | 2 |
| `summary.ts` pure and tested | 3 |
| Weekly targets normalised to the month, both shown | 3, 7 |
| Expense progress, saving progress, income as total | 3, 7 |
| Over-target rows sort first | 3 |
| Query keys `categories` / `targets` / `transactions[yearMonth]` | 4 |
| Invalidation rules incl. category delete | 4 |
| Bottom tabs (Home, Transactions, Targets) | 5 |
| Categories in the header menu, not a tab | 10 |
| Add transaction as a sheet, not a route | 6 |
| Date defaults to today | 6 |
| Description optional in the form | 6 |
| Edit reuses the add sheet, prefilled | 6, 8 |
| Month arrows on Home and Transactions | 7, 8 |
| Income excluded from targets screen | 9 |
| Custom category create and delete | 10 |
| Reassign across all months before delete | 10 |
| Defaults not deletable in UI | 10 |
| Unknown category renders as "Unknown category" | 7, 8 |
| No optimistic updates | 4, 6 (all mutations await the server) |
| Empty states for no targets and no transactions | 7 |
| Error states with retry | 7, 8, 9, 10 |
| Component test for the validation path | 6 |
| Vitest covers `app/**` with a DOM environment | 1 |

**Type consistency:** `CategoryProgress` is defined in Task 3 and consumed unchanged in Task 7. `TransactionInput` is defined in Task 4 and used in Task 6. `queryKeys` is defined once in Task 4 and referenced nowhere else by literal. Hook names match between Tasks 4, 6, 7, 8, 9 and 10.

**Known gaps deliberately left:** icon selection for custom categories defaults to `tag` rather than offering a picker — the spec does not require one, and the icon field is not surfaced anywhere in Phase 1+2 beyond storage.
