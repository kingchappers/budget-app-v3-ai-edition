# Smart Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add category memory keyed on the note, a one-line quick add atop the add sheet, duplicate-from-row, and in-app discoverability of the quick-entry options.

**Architecture:** Frontend only. Pure units (`parseQuickAdd`, `noteMemory`) and a history hook (`useNoteHistory`, last three months via the existing per-month endpoint) are built first. Then `TransactionSheet` gains a `template` prop (Duplicate), a `categorySource` state that lets memory pre-select a category as the note is typed, and a Quick add field whose Enter only fills the form. Finally an inline example and a header "Quick entry tips" modal make it all discoverable.

**Tech Stack:** React 19 (StrictMode), React Router 8 (SPA), Mantine 8.3.12 (`core`, `hooks`, `notifications`), TanStack Query 5, Vitest 4 + Testing Library, yarn.

**Spec:** `docs/superpowers/specs/2026-09-19-smart-prefill-design.md` (builds on `2026-09-18-entry-sheet-rework-design.md`, PR #29)

## Global Constraints

- **Frontend only.** No API, infrastructure, auth or `SECURITY.md` control changes. Matching, parsing and history all run in the browser over data the API already returns.
- **Nothing is ever saved from a guess.** Enter on the Quick add line only fills the form. It never calls create.
- **Memory keys on the note text only** (never the amount). **Match is exact, ignoring case and extra spaces** (`normaliseNote`: trim, lowercase, collapse whitespace). **No prefix or fuzzy matching.** The most recent match wins (by `date` descending, ties by `createdAt` descending). A match must have a category of the current type (`categoryTypeFor`) that still exists.
- **History** is the current month plus the two previous months (`shiftMonth(..., -1)`, `-2`) via `useTransactions(month, opened)`, gated on `opened`.
- **Grammar:** the amount is the last token if it looks like an amount, otherwise the first; a `+` immediately before the amount (`+2400`, `+£2400`) means Income, otherwise Spend; a `+` separated by a space is not a marker; a note over 200 characters is an error ("Note is too long"); no amount is "Couldn't find an amount". No date keyword.
- **Category source:** `'none' | 'memory' | 'user'`. A user pick (chip or More…) is never overwritten by memory; a `memory` category clears when the note stops matching; type change clears the category then re-runs the lookup; **edit mode has no memory**; a Duplicate template's category counts as `user`.
- **Duplicate** opens the add sheet prefilled (amount, type, category, note), date **today**, title "Add transaction". `editing` takes precedence over `template`.
- **Amount stays autofocused** (`data-autofocus`); Quick add is the tab stop above it. Quick add appears in add mode only.
- **Focus after a successful quick-add fill:** "Save & add another" if a category was recalled, otherwise the first category chip.
- The note is rendered as plain React text (never HTML), including in the "Suggested from your earlier '<note>'" hint.
- **Read event values in the handler, never inside a functional state updater** (`setX(f => ... e.currentTarget.value ...)` crashes under StrictMode; this was the Transactions search bug fixed in `554adb3`). Tests for components with such handlers should render under `<StrictMode>`.
- Code style: `~/` alias for `app/`, explicit types on function parameters and return values, early returns, no nested ternaries, no comments that restate the code, no empty catch blocks.
- **Commits:** conventional commits, imperative subject under 72 characters. The body ends with the two trailer lines **contiguous in one paragraph** (no blank line between them). Build the message with a heredoc:

  ```bash
  git commit -q -F - <<'EOF'
  feat: short imperative subject

  Optional body explaining why.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
  EOF
  ```
- The working tree has unrelated modified files `infra/api_lambda_function.zip` and `infra/lambda_function.zip`. **Stage explicit paths only**; never `git add -A` or `git add .`.
- Run tests with `yarn test`, type-check with `yarn typecheck`. Baseline on this branch: **171/171 tests, typecheck clean**. Both must pass at the end of every task, with pristine output (no `act()` or React warnings).
- Work on branch `feat/smart-prefill` (branched from `feat/entry-sheet-rework`; the search-box fix `554adb3` is already on it).

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/quickAdd.ts` | New: `parseQuickAdd(line)` |
| `app/lib/noteMemory.ts` | New: `NoteIndex`, `normaliseNote`, `buildNoteIndex`, `categoryForNote` |
| `app/hooks/useNoteHistory.ts` | New: three gated `useTransactions` calls plus a memoised index |
| `app/components/transactions/TransactionRow.tsx` | `onDuplicate` prop and menu item |
| `app/routes/transactions.tsx` | `duplicating` state; sheet `template`/`opened`/`onClose` wiring |
| `app/components/transactions/TransactionSheet.tsx` | `template`, `categorySource` and memory, Quick add field, focus, example line |
| `app/components/layout/QuickEntryTips.tsx` | New: header help button and tips modal |
| `app/components/layout/DefaultLayout.tsx` | Render `QuickEntryTips` in the header |
| `docs/ROADMAP.md` | Status row for B |

---

### Task 1: `parseQuickAdd`

**Files:**
- Create: `app/lib/quickAdd.ts`
- Test: `app/lib/__tests__/quickAdd.test.ts`

**Interfaces:**
- Consumes: `parsePounds(input: string): ParseResult` from `app/lib/money.ts` (`{ ok: true; pence: number } | { ok: false; message: string }`).
- Produces: `parseQuickAdd(line: string): QuickAddResult` and `type QuickAddResult = { ok: true; amount: number; note: string; type: 'EXPENSE' | 'INCOME' } | { ok: false; message: string }` (`amount` is integer pence). Used by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/quickAdd.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from '../quickAdd';

describe('parseQuickAdd', () => {
  it('reads the amount at the end', () => {
    expect(parseQuickAdd('coffee 3.50')).toEqual({ ok: true, amount: 350, note: 'coffee', type: 'EXPENSE' });
  });

  it('reads the amount at the start', () => {
    expect(parseQuickAdd('3.50 coffee')).toEqual({ ok: true, amount: 350, note: 'coffee', type: 'EXPENSE' });
  });

  it('treats a + on the amount as income', () => {
    expect(parseQuickAdd('+2400 salary')).toEqual({ ok: true, amount: 240000, note: 'salary', type: 'INCOME' });
  });

  it('treats a + before a pound sign as income', () => {
    expect(parseQuickAdd('+£2400 salary')).toEqual({ ok: true, amount: 240000, note: 'salary', type: 'INCOME' });
  });

  it('treats a + on a trailing amount as income', () => {
    expect(parseQuickAdd('salary +2400')).toEqual({ ok: true, amount: 240000, note: 'salary', type: 'INCOME' });
  });

  it('does not treat a + separated by a space as income', () => {
    expect(parseQuickAdd('salary + 2400')).toEqual({ ok: true, amount: 240000, note: 'salary +', type: 'EXPENSE' });
  });

  it('accepts pound signs and thousands separators', () => {
    expect(parseQuickAdd('rent £1,200.50')).toEqual({ ok: true, amount: 120050, note: 'rent', type: 'EXPENSE' });
  });

  it('accepts a whole-number amount with no note', () => {
    expect(parseQuickAdd('3')).toEqual({ ok: true, amount: 300, note: '', type: 'EXPENSE' });
  });

  it('collapses extra whitespace in the note', () => {
    expect(parseQuickAdd('  flat    white   3.50  ')).toEqual({ ok: true, amount: 350, note: 'flat white', type: 'EXPENSE' });
  });

  it('prefers the last amount-like token and keeps the rest as the note', () => {
    expect(parseQuickAdd('2 coffee 3.50')).toEqual({ ok: true, amount: 350, note: '2 coffee', type: 'EXPENSE' });
  });

  it('reports a missing amount', () => {
    expect(parseQuickAdd('coffee')).toEqual({ ok: false, message: "Couldn't find an amount" });
  });

  it('reports a blank line as a missing amount', () => {
    expect(parseQuickAdd('   ')).toEqual({ ok: false, message: "Couldn't find an amount" });
  });

  it('passes on the money parser message for too many decimal places', () => {
    expect(parseQuickAdd('coffee 3.505')).toEqual({ ok: false, message: 'Use at most two decimal places' });
  });

  it('rejects a zero amount', () => {
    expect(parseQuickAdd('coffee 0')).toEqual({ ok: false, message: 'Amount must be greater than zero' });
  });

  it('rejects a note over 200 characters', () => {
    expect(parseQuickAdd(`${'a'.repeat(201)} 3.50`)).toEqual({ ok: false, message: 'Note is too long' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/quickAdd.test.ts`
Expected: FAIL, cannot resolve `../quickAdd`.

- [ ] **Step 3: Implement**

Create `app/lib/quickAdd.ts`:

```ts
import { parsePounds } from './money';

export type QuickAddResult =
  | { ok: true; amount: number; note: string; type: 'EXPENSE' | 'INCOME' }
  | { ok: false; message: string };

const MAX_NOTE_LENGTH = 200;
const AMOUNT_LIKE = /^\+?£?\d[\d,]*(\.\d*)?$/;

function findAmountIndex(tokens: string[]): number {
  const last = tokens.length - 1;
  if (last < 0) return -1;
  if (AMOUNT_LIKE.test(tokens[last])) return last;
  if (AMOUNT_LIKE.test(tokens[0])) return 0;
  return -1;
}

export function parseQuickAdd(line: string): QuickAddResult {
  const tokens = line.trim().split(/\s+/).filter(token => token !== '');
  const amountIndex = findAmountIndex(tokens);
  if (amountIndex === -1) return { ok: false, message: "Couldn't find an amount" };

  const raw = tokens[amountIndex];
  const income = raw.startsWith('+');
  const parsed = parsePounds(income ? raw.slice(1) : raw);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const note = tokens.filter((_, index) => index !== amountIndex).join(' ');
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, message: 'Note is too long' };

  return { ok: true, amount: parsed.pence, note, type: income ? 'INCOME' : 'EXPENSE' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/quickAdd.test.ts && yarn typecheck && yarn test`
Expected: the new file PASSES (15 tests); typecheck clean; whole suite 186/186.

- [ ] **Step 5: Commit**

```bash
git add app/lib/quickAdd.ts app/lib/__tests__/quickAdd.test.ts
git commit -q -F - <<'EOF'
feat: add quick add line parser

parseQuickAdd reads "coffee 3.50", "3.50 coffee" and "+2400 salary"
into an amount in pence, a note and an income/spend type, reusing the
existing money parser for validation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 2: `noteMemory`

**Files:**
- Create: `app/lib/noteMemory.ts`
- Test: `app/lib/__tests__/noteMemory.test.ts`

**Interfaces:**
- Consumes: `categoryTypeFor(type: TransactionType): CategoryType` from `app/lib/transactionTypes.ts`; types `Category`, `Transaction`, `TransactionType` from `app/lib/types.ts`.
- Produces:
  - `type NoteIndex = Map<string, Transaction[]>`
  - `normaliseNote(note: string): string`
  - `buildNoteIndex(transactions: Transaction[]): NoteIndex`
  - `categoryForNote(index: NoteIndex, note: string, type: TransactionType, categories: Category[]): string | null`
  Used by Tasks 3, 5 and 6.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/noteMemory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildNoteIndex, categoryForNote, normaliseNote } from '../noteMemory';
import type { Category, Transaction } from '../types';

function cat(categoryId: string, type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name: categoryId, type, icon: 'x', isDefault: true, createdAt: '' };
}

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 100, type: 'EXPENSE',
    categoryId: 'cat-dining', description: '', date: '2026-09-10', createdAt: '2026-09-10T10:00:00Z', ...over,
  };
}

const categories = [cat('cat-dining'), cat('cat-food'), cat('cat-salary', 'INCOME')];

describe('normaliseNote', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normaliseNote('  Flat   WHITE ')).toBe('flat white');
  });
});

describe('buildNoteIndex', () => {
  it('groups transactions by normalised note, most recent first', () => {
    const older = txn({ transactionId: 'older', description: 'Starbucks', date: '2026-08-01' });
    const newer = txn({ transactionId: 'newer', description: ' starbucks ', date: '2026-09-05' });
    const index = buildNoteIndex([older, newer]);
    expect(index.get('starbucks')?.map(t => t.transactionId)).toEqual(['newer', 'older']);
  });

  it('breaks date ties by createdAt, most recent first', () => {
    const first = txn({ transactionId: 'first', description: 'Tesco', createdAt: '2026-09-10T09:00:00Z' });
    const second = txn({ transactionId: 'second', description: 'Tesco', createdAt: '2026-09-10T18:00:00Z' });
    const index = buildNoteIndex([first, second]);
    expect(index.get('tesco')?.map(t => t.transactionId)).toEqual(['second', 'first']);
  });

  it('skips transactions with no note', () => {
    expect(buildNoteIndex([txn({ description: '' }), txn({ description: '   ' })]).size).toBe(0);
  });
});

describe('categoryForNote', () => {
  it('returns the category of the most recent match', () => {
    const index = buildNoteIndex([
      txn({ transactionId: 'old', description: 'Lunch', categoryId: 'cat-food', date: '2026-08-01' }),
      txn({ transactionId: 'new', description: 'Lunch', categoryId: 'cat-dining', date: '2026-09-01' }),
    ]);
    expect(categoryForNote(index, 'lunch', 'EXPENSE', categories)).toBe('cat-dining');
  });

  it('ignores case and extra spaces in the typed note', () => {
    const index = buildNoteIndex([txn({ description: 'Flat White', categoryId: 'cat-dining' })]);
    expect(categoryForNote(index, '  flat   WHITE ', 'EXPENSE', categories)).toBe('cat-dining');
  });

  it('does not match a partial note', () => {
    const index = buildNoteIndex([txn({ description: 'Starbucks', categoryId: 'cat-dining' })]);
    expect(categoryForNote(index, 'star', 'EXPENSE', categories)).toBeNull();
  });

  it('skips a match whose category type does not fit the chosen type', () => {
    const index = buildNoteIndex([
      txn({ transactionId: 'a', description: 'Refund', categoryId: 'cat-food', date: '2026-08-01' }),
      txn({ transactionId: 'b', description: 'Refund', categoryId: 'cat-salary', type: 'INCOME', date: '2026-09-01' }),
    ]);
    expect(categoryForNote(index, 'refund', 'EXPENSE', categories)).toBe('cat-food');
    expect(categoryForNote(index, 'refund', 'INCOME', categories)).toBe('cat-salary');
  });

  it('returns null when only a wrong-type match exists', () => {
    const index = buildNoteIndex([txn({ description: 'Salary', categoryId: 'cat-salary', type: 'INCOME' })]);
    expect(categoryForNote(index, 'salary', 'EXPENSE', categories)).toBeNull();
  });

  it('skips a category that has since been deleted', () => {
    const index = buildNoteIndex([
      txn({ transactionId: 'old', description: 'Gym', categoryId: 'cat-food', date: '2026-08-01' }),
      txn({ transactionId: 'new', description: 'Gym', categoryId: 'cat-deleted', date: '2026-09-01' }),
    ]);
    expect(categoryForNote(index, 'gym', 'EXPENSE', categories)).toBe('cat-food');
  });

  it('never matches an empty or blank note', () => {
    const index = buildNoteIndex([txn({ description: 'Tesco', categoryId: 'cat-food' })]);
    expect(categoryForNote(index, '', 'EXPENSE', categories)).toBeNull();
    expect(categoryForNote(index, '   ', 'EXPENSE', categories)).toBeNull();
  });

  it('returns null for an unknown note or empty history', () => {
    expect(categoryForNote(buildNoteIndex([]), 'anything', 'EXPENSE', categories)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/noteMemory.test.ts`
Expected: FAIL, cannot resolve `../noteMemory`.

- [ ] **Step 3: Implement**

Create `app/lib/noteMemory.ts`:

```ts
import { categoryTypeFor } from './transactionTypes';
import type { Category, Transaction, TransactionType } from './types';

export type NoteIndex = Map<string, Transaction[]>;

export function normaliseNote(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, ' ');
}

function newestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date > b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  return 0;
}

export function buildNoteIndex(transactions: Transaction[]): NoteIndex {
  const index: NoteIndex = new Map();
  for (const transaction of transactions) {
    const key = normaliseNote(transaction.description);
    if (key === '') continue;
    const group = index.get(key);
    if (group) {
      group.push(transaction);
    } else {
      index.set(key, [transaction]);
    }
  }
  for (const group of index.values()) group.sort(newestFirst);
  return index;
}

export function categoryForNote(
  index: NoteIndex,
  note: string,
  type: TransactionType,
  categories: Category[],
): string | null {
  const key = normaliseNote(note);
  if (key === '') return null;

  const categoryType = categoryTypeFor(type);
  const usable = new Set(categories.filter(c => c.type === categoryType).map(c => c.categoryId));
  const match = index.get(key)?.find(t => usable.has(t.categoryId));
  return match?.categoryId ?? null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/noteMemory.test.ts && yarn typecheck && yarn test`
Expected: the new file PASSES (12 tests); typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/lib/noteMemory.ts app/lib/__tests__/noteMemory.test.ts
git commit -q -F - <<'EOF'
feat: add note-to-category memory helpers

Index past transactions by normalised note and look up the most recent
category of the right type that still exists.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 3: `useNoteHistory`

**Files:**
- Create: `app/hooks/useNoteHistory.ts`
- Test: `app/hooks/__tests__/useNoteHistory.test.ts`

**Interfaces:**
- Consumes: `useTransactions(yearMonth: string, enabled?: boolean)` from `~/lib/queries` (returns a query result with `data?: Transaction[]`); `currentYearMonth()`, `shiftMonth(yearMonth, delta)` from `~/lib/months`; `buildNoteIndex`, `NoteIndex` from `~/lib/noteMemory`.
- Produces: `useNoteHistory(opened: boolean): NoteIndex`. Used by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `app/hooks/__tests__/useNoteHistory.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import type { Transaction } from '~/lib/types';

const mockUseTransactions = vi.hoisted(() => vi.fn());
vi.mock('~/lib/queries', () => ({ useTransactions: mockUseTransactions }));

import { useNoteHistory } from '../useNoteHistory';

const thisMonth = currentYearMonth();
const lastMonth = shiftMonth(thisMonth, -1);
const monthBefore = shiftMonth(thisMonth, -2);

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: thisMonth, amount: 100, type: 'EXPENSE',
    categoryId: 'cat-dining', description: '', date: `${thisMonth}-10`, createdAt: '', ...over,
  };
}

let dataByMonth: Record<string, Transaction[] | undefined>;

beforeEach(() => {
  dataByMonth = {};
  mockUseTransactions.mockReset();
  mockUseTransactions.mockImplementation((month: string) => ({ data: dataByMonth[month] }));
});

describe('useNoteHistory', () => {
  it('requests the current month and the two before it, enabled while open', () => {
    renderHook(() => useNoteHistory(true));
    expect(mockUseTransactions).toHaveBeenCalledWith(thisMonth, true);
    expect(mockUseTransactions).toHaveBeenCalledWith(lastMonth, true);
    expect(mockUseTransactions).toHaveBeenCalledWith(monthBefore, true);
  });

  it('disables all three requests while closed', () => {
    renderHook(() => useNoteHistory(false));
    expect(mockUseTransactions.mock.calls.length).toBe(3);
    expect(mockUseTransactions.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
  });

  it('indexes notes from all three months', () => {
    dataByMonth[thisMonth] = [txn({ transactionId: 'a', description: 'Coffee' })];
    dataByMonth[lastMonth] = [txn({ transactionId: 'b', description: 'Rent' })];
    dataByMonth[monthBefore] = [txn({ transactionId: 'c', description: 'Gym' })];

    const { result } = renderHook(() => useNoteHistory(true));

    expect([...result.current.keys()].sort()).toEqual(['coffee', 'gym', 'rent']);
  });

  it('copes with months that have not loaded yet', () => {
    const { result } = renderHook(() => useNoteHistory(true));
    expect(result.current.size).toBe(0);
  });

  it('picks up data that arrives later', () => {
    const { result, rerender } = renderHook(() => useNoteHistory(true));
    expect(result.current.has('coffee')).toBe(false);

    dataByMonth[thisMonth] = [txn({ description: 'Coffee' })];
    rerender();

    expect(result.current.has('coffee')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/hooks/__tests__/useNoteHistory.test.ts`
Expected: FAIL, cannot resolve `../useNoteHistory`.

- [ ] **Step 3: Implement**

Create `app/hooks/useNoteHistory.ts`:

```ts
import { useMemo } from 'react';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import { buildNoteIndex, type NoteIndex } from '~/lib/noteMemory';
import { useTransactions } from '~/lib/queries';

export function useNoteHistory(opened: boolean): NoteIndex {
  const thisMonth = currentYearMonth();
  const current = useTransactions(thisMonth, opened).data;
  const previous = useTransactions(shiftMonth(thisMonth, -1), opened).data;
  const beforePrevious = useTransactions(shiftMonth(thisMonth, -2), opened).data;

  return useMemo(
    () => buildNoteIndex([...(current ?? []), ...(previous ?? []), ...(beforePrevious ?? [])]),
    [current, previous, beforePrevious],
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/hooks/__tests__/useNoteHistory.test.ts && yarn typecheck && yarn test`
Expected: the new file PASSES (5 tests); typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useNoteHistory.ts app/hooks/__tests__/useNoteHistory.test.ts
git commit -q -F - <<'EOF'
feat: add note history hook

Reads the current month and the two before it through the existing
per-month query, gated on the sheet being open, and memoises a note
index over them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 4: Duplicate (row menu, route wiring, sheet `template`)

**Files:**
- Modify: `app/components/transactions/TransactionRow.tsx`
- Modify: `app/routes/transactions.tsx`
- Modify: `app/components/transactions/TransactionSheet.tsx`
- Create: `app/components/transactions/__tests__/TransactionRow.test.tsx`
- Modify: `app/routes/__tests__/transactions.test.tsx`
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: the existing `Transaction` type; `formatPencePlain`, `todayIso` (already imported in the sheet).
- Produces: `TransactionRow` prop `onDuplicate?: (t: Transaction) => void`; `TransactionSheetProps.template?: Transaction | null`. Task 5 extends the same reset effect.

- [ ] **Step 1: Write the failing tests**

Create `app/components/transactions/__tests__/TransactionRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { TransactionRow } from '../TransactionRow';
import type { Transaction } from '~/lib/types';

const transaction: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 1000, type: 'EXPENSE', categoryId: 'cat-food',
  description: 'Weekly Shop', date: '2026-09-10', createdAt: '',
};

function renderRow(props: Partial<React.ComponentProps<typeof TransactionRow>> = {}) {
  render(
    <MantineProvider>
      <TransactionRow transaction={transaction} categoryName="Groceries" categoryIcon="shopping-cart" {...props} />
    </MantineProvider>,
  );
}

describe('TransactionRow menu', () => {
  it('offers Duplicate and reports the transaction', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    renderRow({ onEdit: vi.fn(), onDuplicate });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    expect(onDuplicate).toHaveBeenCalledWith(transaction);
  });

  it('omits Duplicate when no handler is given', async () => {
    const user = userEvent.setup();
    renderRow({ onEdit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await screen.findByRole('menuitem', { name: 'Edit' });

    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument();
  });

  it('shows the menu when Duplicate is the only action', async () => {
    renderRow({ onDuplicate: vi.fn() });
    expect(screen.getByRole('button', { name: 'Actions for Weekly Shop' })).toBeInTheDocument();
  });
});
```

In `app/routes/__tests__/transactions.test.tsx`, replace the sheet mock

```tsx
vi.mock('~/components/transactions/TransactionSheet', () => ({ TransactionSheet: () => null }));
```

with:

```tsx
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, template }: { opened: boolean; template?: { description: string } | null }) =>
    opened ? <div>{template ? `Sheet template: ${template.description}` : 'Sheet open'}</div> : null,
}));
```

and append a test inside the existing `describe('Transactions route search', ...)` block's file, as a new `describe` at the end of the file:

```tsx
describe('Transactions route duplicate', () => {
  it('opens the add sheet prefilled from a row via Duplicate', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    expect(screen.getByText('Sheet template: Weekly Shop')).toBeInTheDocument();
  });
});
```

In `app/components/transactions/__tests__/TransactionSheet.test.tsx`, add these tests inside the `describe('TransactionSheet', ...)` block (after the `'shows every field when editing'` test):

```tsx
  it('prefills from a template, dated today', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing });

    expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    expect(screen.getByLabelText(/note/i)).toHaveValue('Lunch');
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 480, categoryId: 'cat-dining', description: 'Lunch', date: todayIso() }),
    );
  });

  it('keeps the note collapsed for a template with no note', () => {
    renderSheet({ template: { ...editing, description: '' } });
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });

  it('prefers the transaction being edited over a template', () => {
    renderSheet({ editing, template: { ...editing, amount: 999 } });
    expect(screen.getByLabelText(/amount/i)).toHaveValue('4.80');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionRow.test.tsx app/routes/__tests__/transactions.test.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL. Duplicate menu item is missing, the route shows no template, the sheet ignores `template` (amount empty). TypeScript errors on the unknown `template`/`onDuplicate` props are also expected under `yarn typecheck`.

- [ ] **Step 3: Implement `TransactionRow`**

In `app/components/transactions/TransactionRow.tsx`:

Change the icon import to:

```tsx
import { IconCopy, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
```

Change the props (lines 9-17) to:

```tsx
export function TransactionRow({
  transaction, categoryName, categoryIcon, onEdit, onDelete, onDuplicate,
}: {
  transaction: Transaction;
  categoryName: string;
  categoryIcon: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  onDuplicate?: (t: Transaction) => void;
}) {
```

Change `{(onEdit || onDelete) && (` to `{(onEdit || onDelete || onDuplicate) && (` and add the Duplicate item between Edit and Delete:

```tsx
              {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDuplicate && <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => onDuplicate(transaction)}>Duplicate</Menu.Item>}
              {onDelete && <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
```

- [ ] **Step 4: Implement the route wiring**

In `app/routes/transactions.tsx`:

Add state after the `editing` state (line 23):

```tsx
  const [duplicating, setDuplicating] = useState<Transaction | null>(null);
```

Add the prop to the row (after `onEdit={setEditing}`):

```tsx
              onEdit={setEditing}
              onDuplicate={setDuplicating}
```

Replace the sheet block (lines 121-126) with:

```tsx
      <TransactionSheet
        opened={editing !== null || duplicating !== null}
        onClose={() => {
          setEditing(null);
          setDuplicating(null);
        }}
        yearMonth={yearMonth}
        editing={editing}
        template={duplicating}
      />
```

- [ ] **Step 5: Implement the sheet `template` prop**

In `app/components/transactions/TransactionSheet.tsx`:

Add to the props interface (after `editing?: Transaction | null;`):

```tsx
  template?: Transaction | null;
```

Change the signature to:

```tsx
export function TransactionSheet({ opened, onClose, yearMonth, editing, template }: TransactionSheetProps) {
```

Replace the reset effect (lines 75-95) with:

```tsx
  useEffect(() => {
    if (!opened) return;
    createSubmittedRef.current = false;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
    } else if (template) {
      setAmount(formatPencePlain(template.amount));
      setType(template.type);
      setCategoryId(template.categoryId);
      setDescription(template.description);
      setDate(todayIso());
      setDateChoice('today');
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
    }
    setNoteOpen(!editing && template != null && template.description !== '');
    setError(null);
  }, [opened, editing, template]);
```

- [ ] **Step 6: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionRow.test.tsx app/routes/__tests__/transactions.test.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: all new tests PASS (row 3, route 1, sheet 3); typecheck clean; whole suite passes. If `findByRole('menuitem', ...)` cannot find the item in jsdom, confirm the menu opened by asserting on `Edit` first, and adapt the query to Mantine's actual rendered role; do not weaken what is asserted.

- [ ] **Step 7: Commit**

```bash
git add app/components/transactions/TransactionRow.tsx app/routes/transactions.tsx app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionRow.test.tsx app/routes/__tests__/transactions.test.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -q -F - <<'EOF'
feat: duplicate a transaction from its row

The row menu gets a Duplicate item that opens the add sheet prefilled
with the amount, type, category and note, dated today. Nothing is saved
until the user confirms.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 5: Memory pre-selection from the note

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx`
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: `useNoteHistory(opened: boolean): NoteIndex` (Task 3); `categoryForNote(index, note, type, categories): string | null` (Task 2); the `template` prop and reset effect from Task 4.
- Produces: `type CategorySource = 'none' | 'memory' | 'user'` (local to the sheet) and the sheet handlers `handleCategoryChange(id: string)`, `handleNoteChange(note: string)`, `handleTypeChange(next: TransactionType)`. Task 6 relies on `categorySource`/`setCategorySource`.

- [ ] **Step 1: Write the failing tests**

In `app/components/transactions/__tests__/TransactionSheet.test.tsx`, add this helper next to the `editing` constant:

```tsx
function pastTxn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 'p1', yearMonth: '2026-07', amount: 100, type: 'EXPENSE', categoryId: 'cat-dining',
    description: '', date: '2026-07-01', createdAt: '', ...over,
  };
}
```

and add these tests inside the `describe('TransactionSheet', ...)` block:

```tsx
  it('selects the remembered category when a known note is fully typed', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');

    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    expect(screen.getByText("Suggested from your earlier 'starbucks'")).toBeInTheDocument();
  });

  it('does not select a category for a partial note', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starb');

    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('never overwrites a category the user picked', async () => {
    const user = userEvent.setup();
    mockTransactions = [
      pastTxn({ transactionId: 'a', description: 'Starbucks', categoryId: 'cat-dining' }),
      pastTxn({ transactionId: 'b', description: 'Tesco', categoryId: 'cat-food' }),
    ];
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
  });

  it('clears a remembered category when the note stops matching', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

    await user.type(screen.getByLabelText(/note/i), 'x');

    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('drops the hint once the user picks a category', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    await user.click(screen.getByRole('radio', { name: 'Groceries' }));

    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });

  it('re-runs the lookup when the type changes', async () => {
    const user = userEvent.setup();
    mockTransactions = [
      pastTxn({ transactionId: 'a', description: 'Refund', categoryId: 'cat-dining' }),
      pastTxn({ transactionId: 'b', description: 'Refund', categoryId: 'cat-salary', type: 'INCOME', date: '2026-07-02' }),
    ];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'refund');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.getByRole('radio', { name: 'Salary' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Spend' }));
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('clears the category on a type change when the note has no match there', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    await user.click(screen.getByRole('radio', { name: 'Income' }));

    expect(screen.getByRole('radio', { name: 'Salary' })).not.toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('never recalls a category while editing', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet({ editing: { ...editing, categoryId: 'cat-food', description: 'Lunch' } });

    const note = screen.getByLabelText(/note/i);
    await user.clear(note);
    await user.type(note, 'starbucks');

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    expect(screen.queryByText(/suggested from your earlier/i)).not.toBeInTheDocument();
  });

  it('keeps a duplicated category when the note is changed', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    renderSheet({ template: { ...editing, categoryId: 'cat-food', description: 'Tesco' } });

    const note = screen.getByLabelText(/note/i);
    await user.clear(note);
    await user.type(note, 'starbucks');

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: the new memory tests FAIL (no category is ever selected from a note, no hint). The template and edit-mode tests may pass trivially before the feature; the "selects the remembered category" and "re-runs the lookup" tests are the RED proof.

- [ ] **Step 3: Implement**

In `app/components/transactions/TransactionSheet.tsx`:

**Imports.** Add these two lines with the other `~/` imports (for example after the `useSnapshotWhileOpen` import and after the `~/lib/months` import respectively):

```tsx
import { useNoteHistory } from '~/hooks/useNoteHistory';
```
```tsx
import { categoryForNote } from '~/lib/noteMemory';
```

**Type.** After `type SaveMode = 'close' | 'addAnother';` add:

```tsx
type CategorySource = 'none' | 'memory' | 'user';
```

**Hook and state.** After the line `const monthTransactions = useSnapshotWhileOpen(...)` add:

```tsx
  const noteIndex = useNoteHistory(opened);
```

After `const [error, setError] = useState<string | null>(null);` add:

```tsx
  const [categorySource, setCategorySource] = useState<CategorySource>('none');
```

**Reset effect.** Replace the effect from Task 4 with:

```tsx
  useEffect(() => {
    if (!opened) return;
    createSubmittedRef.current = false;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
      setCategorySource('none');
    } else if (template) {
      setAmount(formatPencePlain(template.amount));
      setType(template.type);
      setCategoryId(template.categoryId);
      setDescription(template.description);
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('user');
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('none');
    }
    setNoteOpen(!editing && template != null && template.description !== '');
    setError(null);
  }, [opened, editing, template]);
```

**Handlers.** Add these three functions after `chooseDate`:

```tsx
  function handleCategoryChange(id: string): void {
    setCategoryId(id);
    setCategorySource('user');
  }

  function handleNoteChange(note: string): void {
    setDescription(note);
    if (editing || categorySource === 'user') return;

    const recalled = categoryForNote(noteIndex, note, type, categories);
    if (recalled) {
      setCategoryId(recalled);
      setCategorySource('memory');
      return;
    }
    if (categorySource === 'memory') {
      setCategoryId(null);
      setCategorySource('none');
    }
  }

  function handleTypeChange(next: TransactionType): void {
    setType(next);
    const recalled = editing ? null : categoryForNote(noteIndex, description, next, categories);
    setCategoryId(recalled);
    setCategorySource(recalled ? 'memory' : 'none');
  }
```

**Reset for next entry.** In `resetForNextEntry`, add `setCategorySource('none');` after `setCategoryId(null);`:

```tsx
  function resetForNextEntry(): void {
    createSubmittedRef.current = false;
    setAmount('');
    setCategoryId(null);
    setCategorySource('none');
    setDescription('');
    setNoteOpen(false);
    setError(null);
    amountRef.current?.focus();
  }
```

**JSX.** Replace the type control:

```tsx
        <SegmentedControl
          fullWidth
          value={type}
          onChange={value => handleTypeChange(value as TransactionType)}
          data={TYPE_OPTIONS}
        />
```

Replace the `CategoryChips` block and add the hint after it:

```tsx
        <CategoryChips
          chips={chips}
          all={eligible}
          value={categoryId}
          onChange={handleCategoryChange}
          loading={categoriesLoading}
          error={categoriesError ? 'Could not load categories' : null}
        />
        {categorySource === 'memory' && description.trim() !== '' && (
          <Text size="xs" c="dimmed">Suggested from your earlier '{description.trim()}'</Text>
        )}
```

Replace the note field:

```tsx
          <TextInput
            label="Note (optional)"
            value={description}
            onChange={e => handleNoteChange(e.currentTarget.value)}
            maxLength={200}
          />
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: all sheet tests PASS (the pre-existing ones plus 9 new); typecheck clean; whole suite passes, output pristine. If the existing test `'only enables the ranking query while the sheet is open'` fails, note that the sheet now makes extra `useTransactions` calls through `useNoteHistory`; it asserts every call is disabled while closed and that `(currentMonth, true)` is among the calls once open, both of which still hold. Do not loosen it beyond what is necessary, and explain any change in the report.

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -q -F - <<'EOF'
feat: recall the category from a typed note

When a note fully matches one from the last three months, its category
is pre-selected, with a small hint saying why. A category the user
picked is never overwritten, a remembered one clears when the note stops
matching, and editing an existing transaction never recalls anything.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 6: The Quick add field and focus

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx`
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: `parseQuickAdd(line): QuickAddResult` (Task 1); `categoryForNote`, `noteIndex`, `setCategorySource` (Tasks 2 and 5); the existing `amountRef`, `setAmount`, `setType`, `setDescription`, `setNoteOpen`, `setError`.
- Produces: a labelled "Quick add" input (add mode only) whose Enter fills the form without submitting. Task 7 adds its description line.

- [ ] **Step 1: Write the failing tests**

In `TransactionSheet.test.tsx` add inside the `describe('TransactionSheet', ...)` block:

```tsx
  it('fills the form from the quick add line without saving', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByLabelText(/amount/i)).toHaveValue('3.50');
    expect(screen.getByLabelText(/note/i)).toHaveValue('coffee');
    expect(screen.getByLabelText('Quick add')).toHaveValue('');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.queryByText(/enter a valid amount/i)).not.toBeInTheDocument();
  });

  it('recalls the category and switches to income for a + line', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'salary', categoryId: 'cat-salary', type: 'INCOME' })];
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), '+2400 salary{Enter}');

    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Salary' })).toBeChecked();
    expect(screen.getByLabelText(/amount/i)).toHaveValue('2400.00');
    expect(screen.getByText("Suggested from your earlier 'salary'")).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('focuses Save & add another when a category was recalled', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('button', { name: /save & add another/i })).toHaveFocus();
  });

  it('focuses the category chips when no category was recalled', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'flat white 3.50{Enter}');

    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(within(group).getAllByRole('radio')[0]).toHaveFocus();
  });

  it('focuses the first chip of the new type when the line flips the type', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), '+2400 bonus{Enter}');

    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked();
    expect(within(group).getAllByRole('radio')[0]).toHaveFocus();
  });

  it('shows the parser message and keeps the text when the line is invalid', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');

    expect(await screen.findByText("Couldn't find an amount")).toBeInTheDocument();
    expect(screen.getByLabelText('Quick add')).toHaveValue('coffee');
    expect(screen.getByLabelText(/amount/i)).toHaveValue('');
  });

  it('clears the parser message on the next keystroke', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
    await screen.findByText("Couldn't find an amount");
    await user.type(screen.getByLabelText('Quick add'), ' 3');

    expect(screen.queryByText("Couldn't find an amount")).not.toBeInTheDocument();
  });

  it('sets the type from the line even if another type was selected', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('radio', { name: 'Spend' })).toBeChecked();
  });

  it('keeps the chosen date when filling from the line', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('radio', { name: 'Yesterday' })).toBeChecked();
  });

  it('replaces a category the user had already picked', async () => {
    const user = userEvent.setup();
    mockTransactions = [pastTxn({ description: 'coffee', categoryId: 'cat-dining' })];
    renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Groceries' }));
    await user.type(screen.getByLabelText('Quick add'), 'coffee 3.50{Enter}');

    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('does not show the quick add line when editing', () => {
    renderSheet({ editing });
    expect(screen.queryByLabelText('Quick add')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: the new tests FAIL, there is no "Quick add" field. The "does not show when editing" test passes trivially.

- [ ] **Step 3: Implement**

In `app/components/transactions/TransactionSheet.tsx`:

**Import.** Add with the other `~/lib` imports:

```tsx
import { parseQuickAdd } from '~/lib/quickAdd';
```

**Refs and state.** After `const createSubmittedRef = useRef(false);` add:

```tsx
  const saveAnotherRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const focusChipsAfterRenderRef = useRef(false);
```

After `const [categorySource, setCategorySource] = ...` add:

```tsx
  const [quickAdd, setQuickAdd] = useState('');
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
```

**Reset on open.** In the reset effect, replace the last two lines and dependency array:

```tsx
    setNoteOpen(!editing && template != null && template.description !== '');
    setError(null);
  }, [opened, editing, template]);
```

with:

```tsx
    setNoteOpen(!editing && template != null && template.description !== '');
    setError(null);
    setQuickAdd('');
    setQuickAddError(null);
  }, [opened, editing, template]);
```

**Focus effect.** Chip focus must happen **after** the render that follows the fill, because a fill that flips the type (Spend to Income) replaces the chip list; focusing a chip before that render would target one that is about to be removed. Add this effect after the reset effect (no dependency array, so it runs after every render and does nothing unless the flag is set):

```tsx
  useEffect(() => {
    if (!focusChipsAfterRenderRef.current) return;
    focusChipsAfterRenderRef.current = false;
    chipsRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  });
```

**Handlers.** Add these after `handleTypeChange`:

```tsx
  function handleQuickAddChange(value: string): void {
    setQuickAdd(value);
    setQuickAddError(null);
  }

  function handleQuickAddKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const parsed = parseQuickAdd(quickAdd);
    if (!parsed.ok) {
      setQuickAddError(parsed.message);
      return;
    }

    const recalled = categoryForNote(noteIndex, parsed.note, parsed.type, categories);
    setAmount(formatPencePlain(parsed.amount));
    setType(parsed.type);
    setDescription(parsed.note);
    if (parsed.note !== '') setNoteOpen(true);
    setCategoryId(recalled);
    setCategorySource(recalled ? 'memory' : 'none');
    setError(null);
    setQuickAdd('');
    setQuickAddError(null);

    if (recalled) {
      saveAnotherRef.current?.focus();
      return;
    }
    focusChipsAfterRenderRef.current = true;
  }
```

**JSX.** Add the field as the first child of the `<Stack>`, before the Amount `TextInput`:

```tsx
        {!editing && (
          <TextInput
            label="Quick add"
            placeholder="coffee 3.50"
            value={quickAdd}
            error={quickAddError}
            onChange={e => handleQuickAddChange(e.currentTarget.value)}
            onKeyDown={handleQuickAddKeyDown}
          />
        )}
```

Wrap the `CategoryChips` in a focus-target div (keep the hint after it):

```tsx
        <div ref={chipsRef}>
          <CategoryChips
            chips={chips}
            all={eligible}
            value={categoryId}
            onChange={handleCategoryChange}
            loading={categoriesLoading}
            error={categoriesError ? 'Could not load categories' : null}
          />
        </div>
```

Give the "Save & add another" button a ref:

```tsx
              <Button ref={saveAnotherRef} type="submit" variant="light">Save & add another</Button>
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: all sheet tests PASS (11 new); typecheck clean; whole suite passes, output pristine. If a focus assertion fails, report the actual cause (for example the element focused is not the one expected). Do not weaken the assertions.

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -q -F - <<'EOF'
feat: add a one-line quick add to the sheet

Type "coffee 3.50" or "+2400 salary" above the amount and press Enter to
fill the amount, type, note and the remembered category. Enter never
saves; focus moves to Save & add another when a category was recalled,
otherwise to the category chips.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 7: Discoverability (inline example and the tips modal)

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx` (one prop)
- Modify: `app/components/transactions/__tests__/TransactionSheet.test.tsx`
- Create: `app/components/layout/QuickEntryTips.tsx`
- Create: `app/components/layout/__tests__/QuickEntryTips.test.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`
- Modify: `app/components/layout/__tests__/DefaultLayout.test.tsx`

**Interfaces:**
- Consumes: the Quick add `TextInput` from Task 6.
- Produces: `QuickEntryTips` (no props): a header help `ActionIcon` (`aria-label="Quick entry tips"`) that opens a `Modal` titled "Quick entry tips".

- [ ] **Step 1: Write the failing tests**

In `TransactionSheet.test.tsx` add:

```tsx
  it('shows an example under the quick add field, even beside an error', async () => {
    const user = userEvent.setup();
    renderSheet();
    const example = 'e.g. coffee 3.50 · 3.50 coffee · +2400 salary (income)';

    expect(screen.getByText(example)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Quick add'), 'coffee{Enter}');
    expect(await screen.findByText("Couldn't find an amount")).toBeInTheDocument();
    expect(screen.getByText(example)).toBeInTheDocument();
  });
```

Create `app/components/layout/__tests__/QuickEntryTips.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QuickEntryTips } from '../QuickEntryTips';

function renderTips() {
  render(
    <MantineProvider>
      <QuickEntryTips />
    </MantineProvider>,
  );
}

describe('QuickEntryTips', () => {
  it('opens a tips dialog from an accessible button', async () => {
    const user = userEvent.setup();
    renderTips();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));

    expect(await screen.findByRole('dialog', { name: 'Quick entry tips' })).toBeInTheDocument();
  });

  it('describes each quick-entry option', async () => {
    const user = userEvent.setup();
    renderTips();

    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quick entry tips' });

    expect(within(dialog).getByText(/opens Add transaction/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Quick add:')).toBeInTheDocument();
    expect(within(dialog).getByText(/start the amount with \+ for income/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Remembered categories:')).toBeInTheDocument();
    expect(within(dialog).getByText('Save & add another:')).toBeInTheDocument();
    expect(within(dialog).getByText('Duplicate:')).toBeInTheDocument();
  });

  it('closes again', async () => {
    const user = userEvent.setup();
    renderTips();

    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    await screen.findByRole('dialog', { name: 'Quick entry tips' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
```

(Add `waitFor` to the `@testing-library/react` import on line 2 of this new file: `import { render, screen, waitFor, within } from '@testing-library/react';`.)

In `DefaultLayout.test.tsx` append inside the existing `describe`:

```tsx
  it('shows the quick entry tips button in the header', async () => {
    renderLayout();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quick entry tips' }));
    expect(await screen.findByRole('dialog', { name: 'Quick entry tips' })).toBeInTheDocument();
  });

  it('ignores N while the tips dialog is open', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    await screen.findByRole('dialog', { name: 'Quick entry tips' });

    await user.keyboard('n');

    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/layout/__tests__ app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL, `../QuickEntryTips` does not exist, the layout has no tips button, and the example line is absent.

- [ ] **Step 3: Implement**

Create `app/components/layout/QuickEntryTips.tsx`:

```tsx
import { useState } from 'react';
import { ActionIcon, Kbd, Modal, Stack, Text } from '@mantine/core';
import { IconHelp } from '@tabler/icons-react';

export function QuickEntryTips() {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <ActionIcon variant="subtle" size="lg" aria-label="Quick entry tips" onClick={() => setOpened(true)}>
        <IconHelp size={20} />
      </ActionIcon>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Quick entry tips" centered>
        <Stack gap="sm">
          <Text size="sm">
            <Kbd>N</Kbd> (keyboard) or the + button opens Add transaction.
          </Text>
          <Text size="sm">
            <strong>Quick add:</strong> type coffee 3.50 (or 3.50 coffee) and press Enter to fill the form.
            Start the amount with + for income (+2400 salary). It never saves by itself.
          </Text>
          <Text size="sm">
            <strong>Remembered categories:</strong> type a note you have used before and its category is
            suggested, based on the last three months.
          </Text>
          <Text size="sm">
            <strong>Save &amp; add another:</strong> Enter in any other field saves and keeps the sheet open
            for the next entry. An Undo toast follows each save.
          </Text>
          <Text size="sm">
            <strong>Duplicate:</strong> on the Transactions page, open a row's menu and choose Duplicate.
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
```

In `app/components/layout/DefaultLayout.tsx`, add the import after the `ColorSchemeToggle` import:

```tsx
import { QuickEntryTips } from './QuickEntryTips';
```

and change the header group to:

```tsx
            <Group gap="sm">
              <QuickEntryTips />
              <ColorSchemeToggle />
              <Authentication />
            </Group>
```

In `TransactionSheet.tsx`, add a `description` prop to the Quick add input:

```tsx
          <TextInput
            label="Quick add"
            description="e.g. coffee 3.50 · 3.50 coffee · +2400 salary (income)"
            placeholder="coffee 3.50"
            value={quickAdd}
            error={quickAddError}
            onChange={e => handleQuickAddChange(e.currentTarget.value)}
            onKeyDown={handleQuickAddKeyDown}
          />
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/layout/__tests__ app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: all new tests PASS (3 tips, 2 layout, 1 sheet); typecheck clean; whole suite passes. If a tips text assertion fails, match against the exact rendered wording in the component (do not weaken what is asserted: each option must still be covered). If an existing sheet test that uses a label or text query now matches the example description, tighten that query rather than removing the description.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/QuickEntryTips.tsx app/components/layout/__tests__/QuickEntryTips.test.tsx app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/DefaultLayout.test.tsx app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -q -F - <<'EOF'
feat: explain the quick entry options in the app

An example line sits under the Quick add field and a help button in the
header opens a short "Quick entry tips" modal covering the N shortcut,
quick add, remembered categories, Save & add another and Duplicate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 8: Real-browser verification and docs

**Files:**
- Modify: `docs/ROADMAP.md` (status row for B)

**Interfaces:**
- Consumes: everything above.
- Produces: verified work ready for a PR.

This is verification, not new code. Use the existing stubbed headless harness in the scratchpad (`/private/tmp/claude-501/-Users-samuelchapman-Projects-budget-app-v3-ai-edition/c36988fc-314b-4d95-a73a-309d87387391/scratchpad/task9/`, which stubs Auth0 and `/api/*` and logs every request). Read its notes first to start it. Never enter real credentials; never leave files in the repo (remove any `.playwright-mcp/` folder the Playwright tool creates in the repo).

- [ ] **Step 1: Automated verification**

Run: `yarn typecheck && yarn test`
Expected: both clean; suite green with pristine output.

- [ ] **Step 2: Seed the stub with history**

Seed the stubbed API so the current month and the previous two months contain transactions with notes, for example "Starbucks" (Restaurants & Dining), "Tesco" (Food & Groceries), "Salary" (an income category), plus a transaction whose category has since been deleted.

- [ ] **Step 3: Browser checklist (report PASS / FAIL / UNVERIFIABLE with evidence for each)**

Mobile (about 390x844) and desktop (about 1280x800):
- [ ] Transactions page: type in the search box. The page does **not** crash and the list filters (the fix `554adb3`).
- [ ] Add sheet: the Quick add field sits above Amount with the example line; **Amount is still the focused field on open**.
- [ ] Type `starbucks 3.50` in Quick add and press Enter: Amount `3.50`, note `starbucks`, the Dining chip selected with the "Suggested from your earlier 'starbucks'" hint, focus on **Save & add another**, and **no POST** was sent. Press Enter again: exactly one POST and the Saved toast.
- [ ] Type `flat white 3.50` (unknown note) and press Enter: no category, focus on the first category chip; **no POST**. Choose a chip and press Enter: one POST.
- [ ] `+2400 salary` switches to Income and selects the income category; `coffee` alone shows "Couldn't find an amount" and keeps the text.
- [ ] In the note field, type a known note fully: the category is selected; type one more character: it clears; pick a chip yourself, then edit the note: your chip is kept.
- [ ] A remembered note whose category was deleted does not select anything.
- [ ] Duplicate: open a row's menu, choose Duplicate: the add sheet opens prefilled (amount, category, note), dated **today**; saving creates one transaction.
- [ ] Editing a transaction: no Quick add field, and changing its note never changes its category.
- [ ] Header "?" button opens "Quick entry tips" on mobile and desktop; the text matches the behaviour; while it is open the `N` shortcut does nothing; Escape closes it.
- [ ] Dark mode: the hint line, example line and tips modal are legible.
- [ ] No console errors or React warnings during all of the above.

- [ ] **Step 4: Update `docs/ROADMAP.md`**

Change the status cell for row B from `Not started` to `Implemented on \`feat/smart-prefill\` (stacked on A, PR #29)`.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/ROADMAP.md
git commit -q -F - <<'EOF'
docs: mark smart prefill as implemented

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

- [ ] **Step 6: Hand off**

Use superpowers:verification-before-completion, then superpowers:requesting-code-review, then superpowers:finishing-a-development-branch. Do not push or open a PR without the user's go-ahead. B's PR should target `feat/entry-sheet-rework` (stacked on PR #29) until A merges.
