# Entry Sheet Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding a transaction as fast as possible: one-tap category chips, save-and-add-another, an optimistic save with Undo, and a keyboard-friendly desktop modal.

**Architecture:** Frontend only. Pure helpers (`topCategories`, date helpers, `useSnapshotWhileOpen`) are built and tested first. Then the React Query mutation hooks become optimistic, a new `CategoryChips` component replaces the category dropdown, and `TransactionSheet` is rebuilt around it. The sheet closes immediately on save, and Undo/Retry toasts chain on the in-flight create promise. Finally the sheet becomes a Modal on wide screens and an `N` hotkey opens it.

**Tech Stack:** React 19, React Router v8 (SPA), Mantine 8 (`core`, `dates`, `hooks`, new `notifications`), TanStack Query 5, Vitest 4 + Testing Library, yarn.

**Spec:** `docs/superpowers/specs/2026-09-18-entry-sheet-rework-design.md`

## Global Constraints

- Frontend only. **No API, infrastructure or `SECURITY.md` control changes.** Server validation (IO-01) is untouched.
- Chip count is **5** (`CHIP_LIMIT`). Chips are the most-used categories of the selected type in the **current month**, padded with default category order.
- Chip ranking input is **frozen while the sheet is open**.
- "Save & add another" clears **amount, note and category**, and keeps **type and date**. "Save" closes the sheet.
- Edit mode has a single Save, stays **awaited**, and shows inline errors. Only *create* is optimistic.
- Enter runs Save & add another when adding and Save when editing.
- Modal at the Mantine `sm` breakpoint (`48em`) and up; bottom Drawer below it.
- `N` opens the add sheet from anywhere, and is ignored while typing in a field.
- Toasts auto-dismiss after about **5 seconds**, sit bottom-centre above the bottom tab bar and the floating button (`bottom: 84`, 56px tall, z-index 101), and render the note as plain React text (never HTML).
- Code style: `~/` alias for `app/`, explicit types on function parameters and return values, early returns, no nested ternaries, no comments that restate the code, no empty catch blocks.
- Every commit uses conventional commits with an imperative subject under 72 characters and ends with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Run tests with `yarn test` (Vitest); type-check with `yarn typecheck`. Both must pass before finishing.
- Work on branch `feat/entry-sheet-rework`. Leave the unrelated modified `infra/*.zip` files alone: stage explicit paths only, never `git add -A` or `git add .`.

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/transactions.ts` | Add pure `topCategories(...)` |
| `app/lib/months.ts` | Add `yesterdayIso`, `DateChoice`, `dateChoiceFor` |
| `app/hooks/useSnapshotWhileOpen.ts` | New: freeze a value while `opened` is true |
| `app/lib/queries.ts` | Optimistic `useCreateTransaction()`; `useDeleteTransaction()` takes `{ transactionId, yearMonth }` |
| `app/routes/transactions.tsx` | Update the single delete caller |
| `app/components/transactions/CategoryChips.tsx` | New: chip group plus "More…" reveal |
| `app/components/transactions/TransactionSheet.tsx` | Rebuilt form, save flow, toasts, Modal/Drawer switch |
| `app/components/layout/DefaultLayout.tsx` | `N` hotkey and tooltip |
| `app/root.tsx`, `package.json`, `yarn.lock` | `@mantine/notifications` provider and styles |

---

### Task 1: `topCategories` ranking helper

**Files:**
- Modify: `app/lib/transactions.ts`
- Test: `app/lib/__tests__/transactions.test.ts`

**Interfaces:**
- Consumes: `categoryTypeFor(type: TransactionType): CategoryType` from `app/lib/transactionTypes.ts`; types `Category`, `Transaction`, `TransactionType`.
- Produces: `topCategories(transactions: Transaction[], categories: Category[], type: TransactionType, limit: number): Category[]`. Used by Task 6.

- [ ] **Step 1: Write the failing tests**

In `app/lib/__tests__/transactions.test.ts`, change line 2 to:

```ts
import { filterTransactions, topCategories } from '../transactions';
```

Append to the end of the file:

```ts
function cat(categoryId: string, type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name: categoryId, type, icon: 'x', isDefault: true, createdAt: '' };
}

describe('topCategories', () => {
  const list = [cat('a'), cat('b'), cat('c'), cat('salary', 'INCOME'), cat('stocks', 'INVESTMENT')];

  it('ranks categories by transaction count, most used first', () => {
    const items = [txn({ categoryId: 'c' }), txn({ categoryId: 'c' }), txn({ categoryId: 'b' })];
    const result = topCategories(items, list, 'EXPENSE', 5);
    expect(result.map(c => c.categoryId)).toEqual(['c', 'b', 'a']);
  });

  it('keeps default category order when counts are equal, including with no history', () => {
    const result = topCategories([], list, 'EXPENSE', 5);
    expect(result.map(c => c.categoryId)).toEqual(['a', 'b', 'c']);
  });

  it('only returns categories of the matching category type', () => {
    expect(topCategories([], list, 'INCOME', 5).map(c => c.categoryId)).toEqual(['salary']);
  });

  it('maps both investment transaction types to investment categories', () => {
    expect(topCategories([], list, 'INVESTMENT_IN', 5).map(c => c.categoryId)).toEqual(['stocks']);
    expect(topCategories([], list, 'INVESTMENT_OUT', 5).map(c => c.categoryId)).toEqual(['stocks']);
  });

  it('respects the limit', () => {
    const items = [txn({ categoryId: 'c' }), txn({ categoryId: 'b' })];
    const result = topCategories(items, list, 'EXPENSE', 2);
    expect(result.map(c => c.categoryId)).toEqual(['b', 'c']);
  });
});
```

`b` and `c` each have one transaction, so they tie and keep default order (`b` before `c`). `a` has none and is cut by the limit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/transactions.test.ts`
Expected: FAIL: `topCategories is not a function` (or similar import error).

- [ ] **Step 3: Implement**

In `app/lib/transactions.ts`, change the import on line 1 and append the function:

```ts
import type { Category, Transaction, TransactionType } from './types';
import { categoryTypeFor } from './transactionTypes';
```

```ts
export function topCategories(
  transactions: Transaction[],
  categories: Category[],
  type: TransactionType,
  limit: number,
): Category[] {
  const categoryType = categoryTypeFor(type);
  const counts = new Map<string, number>();
  for (const t of transactions) {
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }

  return categories
    .filter(c => c.type === categoryType)
    .sort((a, b) => (counts.get(b.categoryId) ?? 0) - (counts.get(a.categoryId) ?? 0))
    .slice(0, limit);
}
```

`Array.prototype.sort` is stable, so equal counts (including zero) keep the input order. That is the "padding with default order" behaviour. `filter` returns a new array, so the caller's `categories` is not mutated.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run app/lib/__tests__/transactions.test.ts`
Expected: PASS (all `filterTransactions` and `topCategories` tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/transactions.ts app/lib/__tests__/transactions.test.ts
git commit -m "feat: add topCategories ranking helper" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Date quick-pick helpers and `useSnapshotWhileOpen`

**Files:**
- Modify: `app/lib/months.ts`
- Test: `app/lib/__tests__/months.test.ts`
- Create: `app/hooks/useSnapshotWhileOpen.ts`
- Test: `app/hooks/__tests__/useSnapshotWhileOpen.test.ts`

**Interfaces:**
- Consumes: `todayIso(now?: Date): string` (existing in `app/lib/months.ts`).
- Produces:
  - `yesterdayIso(now?: Date): string`
  - `type DateChoice = 'today' | 'yesterday' | 'other'`
  - `dateChoiceFor(date: string, now?: Date): DateChoice`
  - `useSnapshotWhileOpen<T>(value: T | undefined, opened: boolean): T | undefined`
  All used by Task 6.

- [ ] **Step 1: Write the failing date tests**

In `app/lib/__tests__/months.test.ts`, change line 2 to:

```ts
import { currentYearMonth, shiftMonth, formatMonthLabel, todayIso, yesterdayIso, dateChoiceFor } from '../months';
```

Append:

```ts
describe('yesterdayIso', () => {
  it('returns the previous day', () => {
    expect(yesterdayIso(new Date(2026, 6, 5))).toBe('2026-07-04');
  });

  it('crosses month and year boundaries', () => {
    expect(yesterdayIso(new Date(2026, 6, 1))).toBe('2026-06-30');
    expect(yesterdayIso(new Date(2026, 0, 1))).toBe('2025-12-31');
  });
});

describe('dateChoiceFor', () => {
  const now = new Date(2026, 6, 5);

  it('recognises today', () => {
    expect(dateChoiceFor('2026-07-05', now)).toBe('today');
  });

  it('recognises yesterday', () => {
    expect(dateChoiceFor('2026-07-04', now)).toBe('yesterday');
  });

  it('treats any other date as other', () => {
    expect(dateChoiceFor('2026-06-30', now)).toBe('other');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/months.test.ts`
Expected: FAIL: `yesterdayIso is not a function`.

- [ ] **Step 3: Implement the date helpers**

In `app/lib/months.ts`, after `todayIso`, add:

```ts
export function yesterdayIso(now: Date = new Date()): string {
  return todayIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

export type DateChoice = 'today' | 'yesterday' | 'other';

export function dateChoiceFor(date: string, now: Date = new Date()): DateChoice {
  if (date === todayIso(now)) return 'today';
  if (date === yesterdayIso(now)) return 'yesterday';
  return 'other';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/months.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the date helpers**

```bash
git add app/lib/months.ts app/lib/__tests__/months.test.ts
git commit -m "feat: add yesterday and date-choice helpers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing `useSnapshotWhileOpen` test**

Create `app/hooks/__tests__/useSnapshotWhileOpen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSnapshotWhileOpen } from '../useSnapshotWhileOpen';

describe('useSnapshotWhileOpen', () => {
  it('tracks the value while closed and holds it steady while open', () => {
    const first = [1];
    const second = [1, 2];
    const third = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ value, opened }) => useSnapshotWhileOpen(value, opened),
      { initialProps: { value: first, opened: false } },
    );
    expect(result.current).toBe(first);

    rerender({ value: second, opened: false });
    expect(result.current).toBe(second);

    rerender({ value: second, opened: true });
    rerender({ value: third, opened: true });
    expect(result.current).toBe(second);

    rerender({ value: third, opened: false });
    expect(result.current).toBe(third);
  });

  it('adopts the first defined value even when it arrives while open', () => {
    const loaded = [1];
    const { result, rerender } = renderHook(
      ({ value, opened }) => useSnapshotWhileOpen(value, opened),
      { initialProps: { value: undefined as number[] | undefined, opened: true } },
    );
    expect(result.current).toBeUndefined();

    rerender({ value: loaded, opened: true });
    expect(result.current).toBe(loaded);
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `yarn vitest run app/hooks/__tests__/useSnapshotWhileOpen.test.ts`
Expected: FAIL: cannot resolve `../useSnapshotWhileOpen`.

- [ ] **Step 8: Implement the hook**

Create `app/hooks/useSnapshotWhileOpen.ts`:

```ts
import { useEffect, useState } from 'react';

// `value` must be referentially stable between renders (e.g. React Query data),
// otherwise the effect would set state on every render.
export function useSnapshotWhileOpen<T>(value: T | undefined, opened: boolean): T | undefined {
  const [snapshot, setSnapshot] = useState(value);

  useEffect(() => {
    if (!opened || snapshot === undefined) setSnapshot(value);
  }, [opened, value, snapshot]);

  return snapshot;
}
```

- [ ] **Step 9: Run to verify pass**

Run: `yarn vitest run app/hooks/__tests__/useSnapshotWhileOpen.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/hooks/useSnapshotWhileOpen.ts app/hooks/__tests__/useSnapshotWhileOpen.test.ts
git commit -m "feat: add useSnapshotWhileOpen hook" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `@mantine/notifications` dependency and provider

**Files:**
- Modify: `package.json`, `yarn.lock`, `app/root.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a mounted `<Notifications />` so `notifications.show/hide/clean` from `@mantine/notifications` work app-wide. Used by Tasks 7 and 8.

- [ ] **Step 1: Add the dependency at the same range as `@mantine/core`**

Run: `yarn add @mantine/notifications@^8.3.7`
Expected: `package.json` gains `"@mantine/notifications": "^8.3.7"` and `yarn.lock` updates. If yarn reports a peer-dependency mismatch, check that the installed `@mantine/core` version matches (`node_modules/@mantine/core/package.json`) and use that exact range.

- [ ] **Step 2: Import the styles and mount the provider in `app/root.tsx`**

Add below the existing `@mantine/dates/styles.css` import (line 2):

```ts
import '@mantine/notifications/styles.css';
```

Add to the Mantine imports:

```ts
import { Notifications } from '@mantine/notifications';
```

In `Layout`, mount it directly inside `MantineProvider`, before `DatesProvider`:

```tsx
<MantineProvider defaultColorScheme="auto" theme={theme}>
  <Notifications position="bottom-center" styles={{ root: { bottom: 150 } }} />
  <DatesProvider settings={{ locale: 'en-gb' }}>{children}</DatesProvider>
</MantineProvider>
```

`bottom: 150` clears the bottom tab bar and the floating button (top edge at `bottom: 140`). Mantine's default notifications z-index (400) is above the button's 101, so no `zIndex` override is needed.

- [ ] **Step 3: Type-check and run the suite**

Run: `yarn typecheck && yarn test`
Expected: both pass. If `tsc` rejects `styles={{ root: ... }}`, open `node_modules/@mantine/notifications` types to find the correct Styles API selector and adjust. The intent is only "push the container up by 150px".

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock app/root.tsx
git commit -m "feat: add Mantine notifications provider" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Optimistic create and month-aware delete

**Files:**
- Modify: `app/lib/queries.ts:56-68` (`useCreateTransaction`) and `:85-92` (`useDeleteTransaction`)
- Modify: `app/routes/transactions.tsx:27` and `:112`
- Modify: `app/components/transactions/TransactionSheet.tsx:19`
- Test: `app/lib/__tests__/transactionMutations.test.tsx` (new)

**Interfaces:**
- Consumes: `createApi`, `TransactionInput` from `app/lib/api.ts`; `queryKeys.transactions(yearMonth)`.
- Produces:
  - `useCreateTransaction(): UseMutationResult<Transaction, Error, TransactionInput, { yearMonth: string; tempId: string }>`: no parameter any more.
  - `useDeleteTransaction(): UseMutationResult<void, Error, { transactionId: string; yearMonth: string }>`
  Used by Task 7 (sheet) and the existing Transactions route.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/transactionMutations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Transaction } from '../types';

const request = vi.fn();

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true }) }));

import { queryKeys, useCreateTransaction, useDeleteTransaction } from '../queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const input = {
  amount: 480,
  type: 'EXPENSE' as const,
  categoryId: 'cat-dining',
  description: '',
  date: '2026-07-10',
};

const existing: Transaction = {
  transactionId: 't1', yearMonth: '2026-07', amount: 100, type: 'EXPENSE',
  categoryId: 'cat-food', description: '', date: '2026-07-01', createdAt: '',
};

const july = queryKeys.transactions('2026-07');
const june = queryKeys.transactions('2026-06');

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
});

describe('useCreateTransaction', () => {
  it('adds a temporary row to the date\'s month while the request is in flight', async () => {
    const pending = deferred<{ transaction: Transaction }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(july, [existing]);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(client.getQueryData<Transaction[]>(july)).toHaveLength(2));
    const rows = client.getQueryData<Transaction[]>(july)!;
    expect(rows[1]).toMatchObject({ amount: 480, categoryId: 'cat-dining', yearMonth: '2026-07' });
    expect(rows[1].transactionId).toMatch(/^temp-/);

    pending.resolve({ transaction: { ...existing, transactionId: 'real' } });
  });

  it('writes a backdated entry to its own month, not the current one', async () => {
    const pending = deferred<{ transaction: Transaction }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(june, []);
    client.setQueryData(july, [existing]);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate({ ...input, date: '2026-06-30' }); });

    await waitFor(() => expect(client.getQueryData<Transaction[]>(june)).toHaveLength(1));
    expect(client.getQueryData<Transaction[]>(july)).toEqual([existing]);

    pending.resolve({ transaction: { ...existing, transactionId: 'real' } });
  });

  it('removes only the temporary row when the request fails', async () => {
    request.mockRejectedValue(new Error('boom'));
    client.setQueryData(july, [existing]);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Transaction[]>(july)).toEqual([existing]);
  });

  it('does not write a partial cache when the month is not loaded', async () => {
    const pending = deferred<{ transaction: Transaction }>();
    request.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(client.getQueryData(july)).toBeUndefined();

    pending.resolve({ transaction: { ...existing, transactionId: 'real' } });
  });

  it('invalidates the date\'s month once the request settles', async () => {
    request.mockResolvedValue({ transaction: { ...existing, transactionId: 'real' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: july }));
  });
});

describe('useDeleteTransaction', () => {
  it('deletes from the supplied month and invalidates that month', async () => {
    request.mockResolvedValue(null);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });

    act(() => { result.current.mutate({ transactionId: 'abc', yearMonth: '2026-06' }); });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('/api/transactions/2026-06/abc', { method: 'DELETE' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: june });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/transactionMutations.test.tsx`
Expected: FAIL. The temp-row tests time out (the current hook does no optimistic write) and the delete test fails because `useDeleteTransaction` requires a `yearMonth` argument and takes a plain string.

- [ ] **Step 3: Implement the hooks in `app/lib/queries.ts`**

Change the type import on line 6:

```ts
import type { Category, TargetPeriod, Transaction } from './types';
```

Replace `useCreateTransaction` (lines 56-68) with:

```ts
interface CreateContext {
  yearMonth: string;
  tempId: string;
}

export function useCreateTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<Transaction, Error, TransactionInput, CreateContext>({
    mutationFn: (input) => api.createTransaction(input),
    onMutate: async (input) => {
      const yearMonth = input.date.slice(0, 7);
      const key = queryKeys.transactions(yearMonth);
      const tempId = `temp-${crypto.randomUUID()}`;
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Transaction[]>(key);
      if (previous !== undefined) {
        const temp: Transaction = { ...input, transactionId: tempId, yearMonth, createdAt: new Date().toISOString() };
        qc.setQueryData<Transaction[]>(key, [...previous, temp]);
      }
      return { yearMonth, tempId };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      qc.setQueryData<Transaction[]>(
        queryKeys.transactions(context.yearMonth),
        (rows) => rows?.filter(t => t.transactionId !== context.tempId),
      );
    },
    onSettled: (_created, _error, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(input.date.slice(0, 7)) });
    },
  });
}
```

Replace `useDeleteTransaction` (lines 85-92) with:

```ts
export function useDeleteTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; yearMonth: string }) =>
      api.deleteTransaction(vars.yearMonth, vars.transactionId),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.transactions(vars.yearMonth) }),
  });
}
```

- [ ] **Step 4: Update the callers so the build stays green**

`app/routes/transactions.tsx`, line 27:

```ts
  const remove = useDeleteTransaction();
```

`app/routes/transactions.tsx`, line 112, using the row's own month (correct even if the list ever shows more than one month):

```tsx
              onDelete={(item) => remove.mutate({ transactionId: item.transactionId, yearMonth: item.yearMonth })}
```

`app/components/transactions/TransactionSheet.tsx`, line 19 (the parameter is gone; the sheet is rebuilt in later tasks):

```ts
  const create = useCreateTransaction();
```

- [ ] **Step 5: Run everything**

Run: `yarn vitest run app/lib/__tests__/transactionMutations.test.tsx && yarn typecheck && yarn test`
Expected: the new tests PASS; typecheck and the whole suite pass (the existing sheet tests still pass because the sheet still awaits `mutateAsync`).

- [ ] **Step 6: Commit**

```bash
git add app/lib/queries.ts app/lib/__tests__/transactionMutations.test.tsx app/routes/transactions.tsx app/components/transactions/TransactionSheet.tsx
git commit -m "feat: make transaction create optimistic" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `CategoryChips` component

**Files:**
- Create: `app/components/transactions/CategoryChips.tsx`
- Test: `app/components/transactions/__tests__/CategoryChips.test.tsx` (new)

**Interfaces:**
- Consumes: `Category` type.
- Produces: `CategoryChips` with props `{ chips: Category[]; all: Category[]; value: string | null; onChange: (categoryId: string) => void; loading?: boolean; error?: string | null }`. It renders a `radiogroup` named "Category". Used by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `app/components/transactions/__tests__/CategoryChips.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { CategoryChips } from '../CategoryChips';
import type { Category } from '~/lib/types';

function cat(categoryId: string, name: string): Category {
  return { categoryId, name, type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' };
}

const groceries = cat('cat-food', 'Groceries');
const dining = cat('cat-dining', 'Dining');
const travel = cat('cat-travel', 'Travel');

function renderChips(props: Partial<React.ComponentProps<typeof CategoryChips>> = {}) {
  const onChange = vi.fn();
  render(
    <MantineProvider>
      <CategoryChips
        chips={[groceries, dining]}
        all={[groceries, dining, travel]}
        value={null}
        onChange={onChange}
        {...props}
      />
    </MantineProvider>,
  );
  return onChange;
}

describe('CategoryChips', () => {
  it('shows one radio per chip', () => {
    renderChips();
    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: 'Groceries' })).toBeInTheDocument();
  });

  it('reports the chosen category', async () => {
    const onChange = renderChips();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Dining' }));
    expect(onChange).toHaveBeenCalledWith('cat-dining');
  });

  it('marks the current value as checked', () => {
    renderChips({ value: 'cat-dining' });
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('shows a category chosen outside the chips as an extra selected chip', () => {
    renderChips({ value: 'cat-travel' });
    expect(screen.getByRole('radio', { name: 'Travel' })).toBeChecked();
  });

  it('reveals a searchable list under More and reports the pick', async () => {
    const user = userEvent.setup();
    const onChange = renderChips();
    expect(screen.queryByPlaceholderText('Search categories')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));
    await user.keyboard('Tra{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('cat-travel');
  });

  it('shows a loading message instead of chips while categories load', () => {
    renderChips({ loading: true });
    expect(screen.getByText(/loading categories/i)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows the error message when categories fail to load', () => {
    renderChips({ error: 'Could not load categories' });
    expect(screen.getByText('Could not load categories')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/CategoryChips.test.tsx`
Expected: FAIL: cannot resolve `../CategoryChips`.

- [ ] **Step 3: Implement the component**

Create `app/components/transactions/CategoryChips.tsx`:

```tsx
import { useState } from 'react';
import { Button, Chip, Group, Input, Select, Text } from '@mantine/core';
import type { Category } from '~/lib/types';

export interface CategoryChipsProps {
  chips: Category[];
  all: Category[];
  value: string | null;
  onChange: (categoryId: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function CategoryChips({ chips, all, value, onChange, loading = false, error = null }: CategoryChipsProps) {
  const [showAll, setShowAll] = useState(false);

  if (loading) return <Text size="sm" c="dimmed">Loading categories…</Text>;
  if (error) return <Text size="sm" c="danger">{error}</Text>;

  const chosenOutsideChips = value !== null && !chips.some(c => c.categoryId === value)
    ? all.find(c => c.categoryId === value)
    : undefined;
  const visible = chosenOutsideChips ? [...chips, chosenOutsideChips] : chips;

  return (
    <Input.Wrapper label="Category">
      <Chip.Group multiple={false} value={value ?? ''} onChange={onChange}>
        <Group gap="xs" mt={4} role="radiogroup" aria-label="Category">
          {visible.map(c => (
            <Chip key={c.categoryId} value={c.categoryId} variant="outline">{c.name}</Chip>
          ))}
          <Button variant="subtle" size="compact-sm" aria-expanded={showAll} onClick={() => setShowAll(open => !open)}>
            More…
          </Button>
        </Group>
      </Chip.Group>
      {showAll && (
        <Select
          mt="xs"
          aria-label="All categories"
          placeholder="Search categories"
          searchable
          autoFocus
          data={all.map(c => ({ value: c.categoryId, label: c.name }))}
          value={value}
          onChange={picked => {
            if (!picked) return;
            onChange(picked);
            setShowAll(false);
          }}
        />
      )}
    </Input.Wrapper>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/CategoryChips.test.tsx && yarn typecheck`
Expected: PASS. If `tsc` objects to the `Chip.Group` generics, check `multiple={false}` and that `onChange` is `(value: string) => void`. If the "More" test can't find the option via the keyboard sequence, mirror the pattern in the existing sheet test (`{ArrowDown}{Enter}` after focusing the input).

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/CategoryChips.tsx app/components/transactions/__tests__/CategoryChips.test.tsx
git commit -m "feat: add CategoryChips component" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Rework the sheet form (chips, date quick-pick, note)

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx` (full rewrite below; the save flow is unchanged in this task)
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: `topCategories` (Task 1); `yesterdayIso`, `dateChoiceFor`, `DateChoice` (Task 2); `useSnapshotWhileOpen` (Task 2); `CategoryChips` (Task 5); `useCreateTransaction()` (Task 4); `useTransactions(yearMonth)` from `~/lib/queries`.
- Produces: the same exported `TransactionSheet` and `TransactionSheetProps`. The form body is held in a `const form` so Task 8 can wrap it in a Modal or Drawer.

- [ ] **Step 1: Update the tests first (they should fail against the current sheet)**

Replace the whole of `app/components/transactions/__tests__/TransactionSheet.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIso, yesterdayIso } from '~/lib/months';
import type { Transaction } from '~/lib/types';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
let mockTransactions: Transaction[] = [];

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-food', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
    ],
    isLoading: false,
  }),
  useTransactions: () => ({ data: mockTransactions }),
  useCreateTransaction: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

import { TransactionSheet, type TransactionSheetProps } from '../TransactionSheet';

function renderSheet(props: Partial<TransactionSheetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <TransactionSheet opened onClose={() => {}} yearMonth="2026-07" {...props} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

function chipNames(): (string | undefined)[] {
  const group = screen.getByRole('radiogroup', { name: 'Category' });
  return within(group).getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0]?.textContent ?? undefined);
}

const editing: Transaction = {
  transactionId: 't1', yearMonth: '2026-07', amount: 480, type: 'EXPENSE', categoryId: 'cat-dining',
  description: 'Lunch', date: '2026-07-03', createdAt: '',
};

describe('TransactionSheet', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ transactionId: 't-real', yearMonth: '2026-07' });
    mockUpdate.mockReset();
    mockTransactions = [];
  });

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

  it('requires a category before submitting', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/choose a category/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('submits a valid transaction as integer pence', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 480, type: 'EXPENSE', categoryId: 'cat-dining' }),
    );
  });

  it('lists the most-used categories first', () => {
    mockTransactions = [
      { ...editing, transactionId: 'a', categoryId: 'cat-food' },
      { ...editing, transactionId: 'b', categoryId: 'cat-food' },
      { ...editing, transactionId: 'c', categoryId: 'cat-dining' },
    ];
    renderSheet();
    expect(chipNames()).toEqual(['Groceries', 'Dining']);
  });

  it('only offers categories that match the chosen type', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    expect(chipNames()).toEqual(['Salary']);
  });

  it('defaults the date to today and lets you pick yesterday', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: yesterdayIso() }));
  });

  it('saves with today\'s date when no date is chosen', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: todayIso() }));
  });

  it('hides the note until asked for', async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
  });

  it('shows every field when editing', () => {
    renderSheet({ editing });
    expect(screen.getByLabelText(/note/i)).toHaveValue('Lunch');
    expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Yesterday' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL. There is no `radiogroup` named "Category", no "Yesterday" radio and no "add note" button in the current sheet.

- [ ] **Step 3: Rewrite `app/components/transactions/TransactionSheet.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Button, Drawer, Group, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useSnapshotWhileOpen } from '~/hooks/useSnapshotWhileOpen';
import { parsePounds, formatPencePlain } from '~/lib/money';
import { currentYearMonth, dateChoiceFor, todayIso, yesterdayIso, type DateChoice } from '~/lib/months';
import { useCategories, useCreateTransaction, useTransactions, useUpdateTransaction } from '~/lib/queries';
import { topCategories } from '~/lib/transactions';
import { TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes';
import type { Transaction, TransactionType } from '~/lib/types';
import { CategoryChips } from './CategoryChips';

const CHIP_LIMIT = 5;

const DATE_OPTIONS: { label: string; value: DateChoice }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Other…', value: 'other' },
];

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
}

export function TransactionSheet({ opened, onClose, yearMonth, editing }: TransactionSheetProps) {
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  const monthTransactions = useSnapshotWhileOpen(useTransactions(currentYearMonth()).data, opened);
  const create = useCreateTransaction();
  const update = useUpdateTransaction(yearMonth);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dateChoice, setDateChoice] = useState<DateChoice>('today');
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
    }
    setNoteOpen(false);
    setError(null);
  }, [opened, editing]);

  const eligible = categories.filter(c => c.type === categoryTypeFor(type));
  const chips = topCategories(monthTransactions ?? [], categories, type, CHIP_LIMIT);

  function chooseDate(choice: DateChoice): void {
    setDateChoice(choice);
    if (choice === 'today') setDate(todayIso());
    if (choice === 'yesterday') setDate(yesterdayIso());
  }

  async function handleSave(): Promise<void> {
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

  const form = (
    <form onSubmit={e => { e.preventDefault(); void handleSave(); }}>
      <Stack>
        <TextInput
          label="Amount"
          placeholder="0.00"
          leftSection="£"
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
        <CategoryChips
          chips={chips}
          all={eligible}
          value={categoryId}
          onChange={setCategoryId}
          loading={categoriesLoading}
          error={categoriesError ? 'Could not load categories' : null}
        />
        {editing ? (
          <DateInput
            label="Date"
            valueFormat="DD/MM/YYYY"
            value={date}
            onChange={value => setDate(value ?? '')}
          />
        ) : (
          <>
            <SegmentedControl
              fullWidth
              aria-label="Quick date"
              value={dateChoice}
              onChange={value => chooseDate(value as DateChoice)}
              data={DATE_OPTIONS}
            />
            {dateChoice === 'other' && (
              <DateInput
                label="Date"
                valueFormat="DD/MM/YYYY"
                value={date}
                onChange={value => setDate(value ?? '')}
              />
            )}
          </>
        )}
        {editing || noteOpen ? (
          <TextInput
            label="Note (optional)"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            maxLength={200}
          />
        ) : (
          <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNoteOpen(true)}>
            + Add note
          </Button>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={pending}>Save</Button>
        </Group>
      </Stack>
    </form>
  );

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto"
      title={editing ? 'Edit transaction' : 'Add transaction'}>
      {form}
    </Drawer>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck`
Expected: all sheet tests PASS and `tsc` is clean. If the "shows every field when editing" test can't find the date field by `/^date/i`, check that `DateInput` renders a labelled input in jsdom and adjust the query to match the actual label element.

- [ ] **Step 5: Run the whole suite**

Run: `yarn test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -m "feat: rework entry sheet with category chips" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Save flow: Save & add another, instant close, Undo and Retry

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx` (full file below)
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: `useCreateTransaction()`, `useUpdateTransaction(yearMonth)`, `useDeleteTransaction()` (`mutate({ transactionId, yearMonth })`) from `~/lib/queries`; `notifications` from `@mantine/notifications`; `TransactionInput` from `~/lib/api`; `formatPence` from `~/lib/money`.
- Produces: the final behaviour of `TransactionSheet`. `TransactionSheetProps` is unchanged.

- [ ] **Step 1: Update the sheet tests (they should fail against the Task 6 sheet)**

In `app/components/transactions/__tests__/TransactionSheet.test.tsx`:

(a) Extend the imports and mocks. Replace the import block at the top with:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIso, yesterdayIso } from '~/lib/months';
import type { Transaction } from '~/lib/types';
```

Add beside `mockUpdate`:

```tsx
const mockRemove = vi.fn();
```

Add to the `vi.mock('~/lib/queries', ...)` factory:

```tsx
  useDeleteTransaction: () => ({ mutate: mockRemove }),
```

(b) Replace `renderSheet` with a version that mounts `Notifications` and defaults `onClose` to a spy, returning it:

```tsx
function renderSheet(props: Partial<TransactionSheetProps> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <Notifications />
        <TransactionSheet opened onClose={onClose} yearMonth="2026-07" {...props} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
```

(c) In `beforeEach`, add `mockRemove.mockReset();`. Add below it:

```tsx
  afterEach(() => { notifications.clean(); });
```

(d) With a second button named "Save & add another", `name: /save/i` is now ambiguous. In the existing tests that click Save (`invalid amount`, `two decimal places`, `requires a category`, `submits a valid transaction`, and the two date tests), change every

```tsx
screen.getByRole('button', { name: /save/i })
```

to

```tsx
screen.getByRole('button', { name: /^save$/i })
```

(e) Append these tests inside the `describe`:

```tsx
  it('closes immediately without waiting for the create to finish', async () => {
    const user = userEvent.setup();
    mockCreate.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the sheet open on Save & add another, clearing amount, note and category', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.click(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.type(screen.getByLabelText(/amount/i), '10');
    await user.click(screen.getByRole('radio', { name: 'Salary' }));
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'March');

    await user.click(screen.getByRole('button', { name: /save & add another/i }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/amount/i)).toHaveValue('');
    expect(screen.getByLabelText(/amount/i)).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yesterday' })).toBeChecked();
  });

  it('runs Save & add another when Enter is pressed while adding', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.type(screen.getByLabelText(/amount/i), '4.80{Enter}');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 480, categoryId: 'cat-dining' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers Undo that deletes the created transaction', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/saved £4\.80 · dining/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
  });

  it('defers Undo until the create has finished', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ transactionId: string; yearMonth: string }>();
    mockCreate.mockReturnValue(pending.promise);
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(mockRemove).not.toHaveBeenCalled();

    pending.resolve({ transactionId: 'late-id', yearMonth: '2026-07' });
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 'late-id', yearMonth: '2026-07' }));
  });

  it('shows a Retry toast when the create fails and re-sends the same input', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new Error('boom'));
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenLastCalledWith(mockCreate.mock.calls[0][0]);
  });

  it('does nothing on Undo when the create failed', async () => {
    const user = userEvent.setup();
    const pending = deferred<never>();
    mockCreate.mockReturnValue(pending.promise.then(() => { throw new Error('boom'); }));
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    pending.resolve(undefined as never);
    await screen.findByRole('button', { name: 'Retry' });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('awaits the update in edit mode and shows an inline error on failure', async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new Error('boom'));
    const { onClose } = renderSheet({ editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /save & add another/i })).not.toBeInTheDocument();
  });

  it('closes after a successful edit', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({});
    const { onClose } = renderSheet({ editing });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
```

Note: the `renderSheet` return value is now `{ onClose }`. Existing tests that call `renderSheet();` without using the return value keep working.

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL. There is no "Save & add another" button, no toasts, and the sheet still awaits the create.

- [ ] **Step 3: Replace `app/components/transactions/TransactionSheet.tsx` with the final save flow**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useSnapshotWhileOpen } from '~/hooks/useSnapshotWhileOpen';
import type { TransactionInput } from '~/lib/api';
import { formatPence, formatPencePlain, parsePounds } from '~/lib/money';
import { currentYearMonth, dateChoiceFor, todayIso, yesterdayIso, type DateChoice } from '~/lib/months';
import {
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from '~/lib/queries';
import { topCategories } from '~/lib/transactions';
import { TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes';
import type { Transaction, TransactionType } from '~/lib/types';
import { CategoryChips } from './CategoryChips';

const CHIP_LIMIT = 5;
const TOAST_MS = 5000;

const DATE_OPTIONS: { label: string; value: DateChoice }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Other…', value: 'other' },
];

type SaveMode = 'close' | 'addAnother';

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
}

interface ToastActionProps {
  text: string;
  actionLabel: string;
  onAction: () => void;
}

function ToastAction({ text, actionLabel, onAction }: ToastActionProps) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm">{text}</Text>
      <Button variant="subtle" size="compact-sm" onClick={onAction}>{actionLabel}</Button>
    </Group>
  );
}

export function TransactionSheet({ opened, onClose, yearMonth, editing }: TransactionSheetProps) {
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  const monthTransactions = useSnapshotWhileOpen(useTransactions(currentYearMonth()).data, opened);
  const create = useCreateTransaction();
  const update = useUpdateTransaction(yearMonth);
  const remove = useDeleteTransaction();
  const amountRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dateChoice, setDateChoice] = useState<DateChoice>('today');
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
    }
    setNoteOpen(false);
    setError(null);
  }, [opened, editing]);

  const eligible = categories.filter(c => c.type === categoryTypeFor(type));
  const chips = topCategories(monthTransactions ?? [], categories, type, CHIP_LIMIT);

  function chooseDate(choice: DateChoice): void {
    setDateChoice(choice);
    if (choice === 'today') setDate(todayIso());
    if (choice === 'yesterday') setDate(yesterdayIso());
  }

  function validate(): TransactionInput | null {
    const parsed = parsePounds(amount);
    if (!parsed.ok) {
      setError(parsed.message);
      return null;
    }
    if (!categoryId) {
      setError('Choose a category');
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Date must be YYYY-MM-DD');
      return null;
    }
    return { amount: parsed.pence, type, categoryId, description, date };
  }

  function describeInput(input: TransactionInput): string {
    const categoryName = categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    return `${formatPence(input.amount)} · ${categoryName}`;
  }

  function showFailureToast(input: TransactionInput): void {
    const toastId = `failed-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      color: 'danger',
      autoClose: false,
      message: (
        <ToastAction
          text={`Couldn't save ${describeInput(input)}`}
          actionLabel="Retry"
          onAction={() => {
            notifications.hide(toastId);
            submitNew(input);
          }}
        />
      ),
    });
  }

  function submitNew(input: TransactionInput): void {
    const toastId = `saved-${crypto.randomUUID()}`;
    const outcome = create.mutateAsync(input).then(
      created => created,
      () => {
        notifications.hide(toastId);
        showFailureToast(input);
        return null;
      },
    );

    notifications.show({
      id: toastId,
      autoClose: TOAST_MS,
      message: (
        <ToastAction
          text={`Saved ${describeInput(input)}`}
          actionLabel="Undo"
          onAction={() => {
            notifications.hide(toastId);
            void outcome.then(created => {
              if (!created) return;
              remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
            });
          }}
        />
      ),
    });
  }

  function resetForNextEntry(): void {
    setAmount('');
    setCategoryId(null);
    setDescription('');
    setNoteOpen(false);
    setError(null);
    amountRef.current?.focus();
  }

  async function handleSubmit(mode: SaveMode): Promise<void> {
    const input = validate();
    if (!input) return;

    if (editing) {
      try {
        await update.mutateAsync({ transactionId: editing.transactionId, input });
        onClose();
      } catch {
        setError('Could not save. Check your connection and try again.');
      }
      return;
    }

    submitNew(input);
    if (mode === 'addAnother') {
      resetForNextEntry();
      return;
    }
    onClose();
  }

  const form = (
    <form onSubmit={e => { e.preventDefault(); void handleSubmit(editing ? 'close' : 'addAnother'); }}>
      <Stack>
        <TextInput
          ref={amountRef}
          label="Amount"
          placeholder="0.00"
          leftSection="£"
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
        <CategoryChips
          chips={chips}
          all={eligible}
          value={categoryId}
          onChange={setCategoryId}
          loading={categoriesLoading}
          error={categoriesError ? 'Could not load categories' : null}
        />
        {editing ? (
          <DateInput
            label="Date"
            valueFormat="DD/MM/YYYY"
            value={date}
            onChange={value => setDate(value ?? '')}
          />
        ) : (
          <>
            <SegmentedControl
              fullWidth
              aria-label="Quick date"
              value={dateChoice}
              onChange={value => chooseDate(value as DateChoice)}
              data={DATE_OPTIONS}
            />
            {dateChoice === 'other' && (
              <DateInput
                label="Date"
                valueFormat="DD/MM/YYYY"
                value={date}
                onChange={value => setDate(value ?? '')}
              />
            )}
          </>
        )}
        {editing || noteOpen ? (
          <TextInput
            label="Note (optional)"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            maxLength={200}
          />
        ) : (
          <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNoteOpen(true)}>
            + Add note
          </Button>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          {editing ? (
            <Button type="submit" loading={update.isPending}>Save</Button>
          ) : (
            <>
              <Button type="submit" variant="light">Save & add another</Button>
              <Button onClick={() => void handleSubmit('close')}>Save</Button>
            </>
          )}
        </Group>
      </Stack>
    </form>
  );

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto"
      title={editing ? 'Edit transaction' : 'Add transaction'}>
      {form}
    </Drawer>
  );
}
```

Mantine `Button` renders `type="button"` by default, so "Save" and "Cancel" do not submit the form. The first `type="submit"` button ("Save & add another") is what Enter triggers.

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck`
Expected: PASS. If a toast test can't find the toast text, the Notifications transition may need a moment: the tests already use `findBy…` (which waits up to 1s), so first check that `<Notifications />` is mounted in `renderSheet`. If the "Save & add another" focus assertion fails, confirm `ref={amountRef}` reaches the `<input>` (Mantine `TextInput` forwards refs to the input element).

- [ ] **Step 5: Run the whole suite**

Run: `yarn test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -m "feat: save instantly with add-another, undo and retry" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Desktop modal and the `N` shortcut

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx` (imports and the `return`)
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx` (one test)
- Modify: `app/components/layout/DefaultLayout.tsx`
- Test: `app/components/layout/__tests__/DefaultLayout.test.tsx` (new)

**Interfaces:**
- Consumes: the `form` constant from Task 7; `useMediaQuery`, `useHotkeys` from `@mantine/hooks`.
- Produces: the finished behaviour: Modal on `sm` and up, Drawer below; `N` opens the add sheet.

- [ ] **Step 1: Write the failing modal test**

Append inside the `describe` in `app/components/transactions/__tests__/TransactionSheet.test.tsx`:

```tsx
  it('renders as a centred modal on wide screens', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: true })) as typeof window.matchMedia;
    try {
      renderSheet();
      expect(document.querySelector('.mantine-Modal-root')).not.toBeNull();
      expect(document.querySelector('.mantine-Drawer-root')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('renders as a bottom drawer on narrow screens', () => {
    renderSheet();
    expect(document.querySelector('.mantine-Drawer-root')).not.toBeNull();
    expect(document.querySelector('.mantine-Modal-root')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx -t "modal"`
Expected: FAIL: the sheet only ever renders a Drawer.

- [ ] **Step 3: Switch between Modal and Drawer**

In `TransactionSheet.tsx`, change the Mantine imports:

```tsx
import { Button, Drawer, Group, Modal, SegmentedControl, Stack, Text, TextInput, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
```

Add at the top of the component body, before the other hooks:

```tsx
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
```

Replace the final `return` with:

```tsx
  const title = editing ? 'Edit transaction' : 'Add transaction';

  if (isDesktop) {
    return (
      <Modal opened={opened} onClose={onClose} title={title} centered size={440}>
        {form}
      </Modal>
    );
  }

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" title={title}>
      {form}
    </Drawer>
  );
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: PASS (the whole file, including the earlier tests, which run under the default `matches: false` stub and so use the Drawer).

- [ ] **Step 5: Write the failing hotkey tests**

Create `app/components/layout/__tests__/DefaultLayout.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock('../../authentication/Authentication', () => ({ default: () => null }));
vi.mock('../../transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened }: { opened: boolean }) => (opened ? <div>Add sheet open</div> : null),
}));

import { DefaultLayout } from '../DefaultLayout';

function renderLayout(children: React.ReactNode = <p>page</p>) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <DefaultLayout>{children}</DefaultLayout>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('DefaultLayout add shortcut', () => {
  it('opens the add sheet when N is pressed', async () => {
    renderLayout();
    await userEvent.setup().keyboard('n');
    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
  });

  it('ignores N while typing in a field', async () => {
    const user = userEvent.setup();
    renderLayout(<input aria-label="Search" />);
    await user.click(screen.getByLabelText('Search'));
    await user.keyboard('n');
    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });

  it('ignores N while another dialog is open', async () => {
    renderLayout(<div role="dialog" aria-label="Edit transaction" />);
    await userEvent.setup().keyboard('n');
    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });

  it('opens the add sheet from the floating button', async () => {
    renderLayout();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx`
Expected: "opens the add sheet when N is pressed" FAILS. The two "ignores N" tests and the floating-button test pass even before the feature exists, because they assert that nothing (or the existing button behaviour) happens. They are regression guards that only become meaningful once N does something, so the first test is the one that proves the feature. If the file fails to run at all (for example the layout needs something the mocks don't provide), fix the mocks before continuing. If testing at this level proves impractical, delete this file and rely on the manual browser check in Task 9.

- [ ] **Step 7: Add the hotkey and tooltip in `DefaultLayout.tsx`**

Update the imports:

```tsx
import { ActionIcon, AppShell, Flex, Text, NavLink, Group, Paper, Tooltip } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
```

Directly after `const [addOpen, setAddOpen] = useState(false);` add:

```tsx
  useHotkeys([['n', () => {
    if (document.querySelector('[role="dialog"]')) return;
    setAddOpen(true);
  }]]);
```

Wrap the floating button:

```tsx
        <Tooltip label="Add transaction (N)" events={{ hover: true, focus: true, touch: false }}>
          <ActionIcon
            size={56} radius="xl" variant="filled" aria-label="Add transaction"
            onClick={() => setAddOpen(true)}
            style={{ position: 'fixed', right: 16, bottom: 84, zIndex: 101 }}
          >
            <IconPlus size={26} />
          </ActionIcon>
        </Tooltip>
```

`useHotkeys` ignores keystrokes from `INPUT`, `TEXTAREA` and `SELECT` targets by default (which covers the sheet's radios and fields), and it calls `preventDefault`, so the "n" is not typed into the amount field when the sheet opens with focus on it. The `[role="dialog"]` guard stops `N` opening a second sheet on top of the edit sheet.

- [ ] **Step 8: Run to verify pass**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx && yarn typecheck && yarn test`
Expected: PASS everywhere.

- [ ] **Step 9: Commit**

```bash
git add app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/DefaultLayout.test.tsx
git commit -m "feat: show sheet as modal on desktop, add N shortcut" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Verification in a real browser and closing docs

**Files:**
- Modify: `docs/ROADMAP.md` (status row for A)

**Interfaces:**
- Consumes: everything above.
- Produces: verified work, ready for review.

- [ ] **Step 1: Full automated verification**

Run: `yarn typecheck && yarn test`
Expected: both exit 0. Report the actual test counts.

- [ ] **Step 2: Start the app**

Run: `yarn dev` (needs `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` in `.env`; do not print or commit them). Open the printed local URL and sign in. Use a narrow window (under 768px wide) for the mobile checks and a wide one for the desktop checks.

- [ ] **Step 3: Manual checklist (report each item pass/fail honestly)**

Mobile width:
- [ ] Tap the floating button. The sheet opens as a bottom drawer with Amount focused and the decimal keypad on a phone.
- [ ] Chips show up to 5 categories. Tap "More…", search and pick a category not in the chips. It appears as a selected chip.
- [ ] Save closes the sheet at once and a "Saved £x · Category  Undo" toast appears **above** the bottom tab bar and the floating button, not behind them. It auto-dismisses after about 5s.
- [ ] Undo removes the entry (the list updates within about a second).
- [ ] Yesterday and Other… work, and a backdated entry into a previous month shows up when you navigate to that month.
- [ ] Add note reveals the field; editing an existing transaction shows note and date without extra taps.
- [ ] Turn the network off in dev tools, save, and confirm the row rolls back and a Retry toast appears. Turn it on and Retry works.

Desktop width:
- [ ] The sheet is a centred modal about 440px wide.
- [ ] Press **N** from the Transactions page (focus not in a field): the sheet opens and no "n" appears in Amount. Press **N** while in the search box: nothing opens. Press **N** while the edit sheet is open: no second sheet opens.
- [ ] Keyboard only: type an amount, Tab to the type control (arrows change it), Tab into the chips (arrows move, one Tab stop), press **Enter**: it saves and stays open with Amount focused. **This is the check for Enter on a focused radio.** If Enter does nothing there, handle Enter explicitly on the chip group (`onKeyDown` on the `Group` that calls `handleSubmit`) and add a test.
- [ ] Toggle dark mode and confirm the chips, toast and modal are legible.
- [ ] Add three transactions in a row with Save & add another, and confirm the chip order does not change between them.

- [ ] **Step 4: Update `docs/ROADMAP.md`**

Change the status cell for row A from "Spec approved: …" to "Implemented on `feat/entry-sheet-rework` (PR pending)". Once the PR is opened, replace it with the PR number.

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark entry sheet rework as implemented" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off**

Use superpowers:verification-before-completion, then superpowers:requesting-code-review, then superpowers:finishing-a-development-branch. Do not push or open a PR without the user's go-ahead.
