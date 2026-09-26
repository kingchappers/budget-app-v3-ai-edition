# Savings and Sinking-Fund Pots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Saving & Investment and Sinking Funds categories into pots with a carried-over balance, Set aside / Take out entries, optional monthly and goal targets, derived auto-contribute, a Pots page with per-pot history, and a Pots section on Home.

**Architecture:** `CategoryType` `INVESTMENT` becomes `POT` and the transaction types `INVESTMENT_IN` / `INVESTMENT_OUT` become `SET_ASIDE` / `TAKE_OUT`. A pure `computePots` function derives each pot's balance and month-by-month history from the full transaction list plus per-pot settings items (`POT#<categoryId>`); `GET /api/pots` and `PUT /api/pots/{categoryId}` expose it. The client gets a pots data layer, a Pots page with a history sheet (hand-drawn SVG trend, no chart library), and a Home section.

**Tech Stack:** React 19, React Router 8, Mantine 8.3.12, TanStack Query 5, Vitest 4 + Testing Library, AWS Lambda + DynamoDB (single table), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-09-25-savings-pots-design.md` (builds on F1: `docs/superpowers/specs/2026-09-24-category-groups-design.md`). Work on branch `feat/savings-pots`, which starts from `feat/category-groups`.

## Global Constraints

- No infra, IAM or dependency changes.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for every new input; AUTH-01 on new routes; API-02 generic client errors); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging (`git add <files>`), and end every commit message with these two trailer lines:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY`
- Update `docs/ROADMAP.md` (F2 status and the follow-ups).
- `CategoryType` is `EXPENSE | INCOME | POT`; `TransactionType` is `EXPENSE | INCOME | SET_ASIDE | TAKE_OUT`. `INVESTMENT`, `INVESTMENT_IN` and `INVESTMENT_OUT` are removed everywhere, and there is no data migration.
- Which categories each entry type can use (client-enforced; the transaction API validates only that `type` is one of the four values and does no category lookup): Spend = EXPENSE or POT categories; Income = INCOME only; Set aside and Take out = POT only.
- Group rule: Sinking Funds and Saving & Investment categories are `POT` type; Bills and Everyday Spending categories are `EXPENSE` type; Income has no group.
- Pot balance per month: `closing = opening + set aside + auto-contribute − take out − spent`. Entries dated after the `asOf` month are excluded; negative balances are allowed.

## Plan rulings (fill gaps the spec leaves open)

- A custom `POT` category with no group defaults to `SINKING_FUNDS`.
- `GET /api/pots?asOf=` accepts any valid past month and up to one month ahead of the server's UTC month, so Home can show a past month's balance. `PUT`'s `month` must be within one month either side of the server's UTC month.
- On `PUT`, existing auto-contribute entries starting after `month` are dropped and an entry starting exactly at `month` is replaced. Saving an amount equal to the one already in force adds nothing. The list is capped at 120 entries.
- Home's Pots section follows Home's month selector (`asOf` = the selected month).
- `TransactionRow` keeps its own outgoing-type set (updated to `EXPENSE`, `SET_ASIDE`); a shared helper is out of scope.
- The tips modal never mentions the old type names (grep-verified), so it needs no copy change.

## Review Focus

1. An overspent pot (balance below zero) and a pot with no activity: the API returns them correctly and the UI shows a "Below zero" flag and an empty state respectively. (Tasks 2 and 6.)
2. Backdated and future-dated entries: a backdated Set aside changes history from its month forward; an entry dated after `asOf` never changes the balance. (Task 2.)
3. Auto-contribute saves: re-saving the same amount is a no-op, changing it twice in one month leaves one entry, and entries starting after the saved month are dropped. (Task 3.)
4. A Set aside or Take out can never be created against a non-pot category through the UI: switching type clears the category, and the chips and dropdown for those types list pot categories only. (Task 4.)
5. A settings item left behind by a deleted category, or a pot category with settings but no transactions, must not break `GET /api/pots`. (Task 3.)

---

### Task 1: API types, validation and pot defaults

**Files:**
- Modify: `src/api/types.ts`, `src/api/constants.ts`, `src/api/defaults.ts`, `src/api/categories.ts`, `src/api/transactions.ts`, `src/api/recurring.ts`
- Modify (tests): `src/api/__tests__/defaults.test.ts`, `src/api/__tests__/categories.test.ts`, `src/api/__tests__/transactions.test.ts`, `src/api/__tests__/recurring.test.ts`

**Interfaces:**
- Produces: `TransactionType = 'EXPENSE' | 'INCOME' | 'SET_ASIDE' | 'TAKE_OUT'`; `CategoryType = 'EXPENSE' | 'INCOME' | 'POT'`; `VALID_TRANSACTION_TYPES`, `VALID_CATEGORY_TYPES` and a new `POT_GROUPS: Set<string>` (`SINKING_FUNDS`, `SAVING_INVESTMENT`) in `src/api/constants.ts`; `DEFAULT_CATEGORIES` with Sinking Funds and Saving & Investment entries typed `'POT'`.

- [ ] **Step 1: Update the tests first**

`src/api/__tests__/defaults.test.ts`: replace the test named `makes Saving & Investment categories INVESTMENT type and every other grouped one EXPENSE` with:

```ts
  it('makes Sinking Funds and Saving & Investment categories POT type and Bills and Everyday EXPENSE', () => {
    for (const c of DEFAULT_CATEGORIES.filter(c => c.group)) {
      const isPotGroup = c.group === 'SAVING_INVESTMENT' || c.group === 'SINKING_FUNDS';
      expect(c.type).toBe(isPotGroup ? 'POT' : 'EXPENSE');
    }
  });
```

`src/api/__tests__/categories.test.ts`: change the test `defaults an INVESTMENT category to SAVING_INVESTMENT` to

```ts
  it('defaults a POT category to SINKING_FUNDS', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Boiler', type: 'POT' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBe('SINKING_FUNDS');
  });
```

and replace the two `it.each` blocks at the end of `describe('createCategory')` (the 400 table and the 201 table) with:

```ts
  it.each([
    ['EXPENSE', 'SAVING_INVESTMENT'],
    ['EXPENSE', 'SINKING_FUNDS'],
    ['POT', 'BILLS'],
    ['POT', 'EVERYDAY'],
  ])('returns 400 for %s with group %s', async (type, group) => {
    const res = await createCategory(makeEvent({ name: 'X', type, group }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    ['EXPENSE', 'BILLS'],
    ['EXPENSE', 'EVERYDAY'],
    ['POT', 'SINKING_FUNDS'],
    ['POT', 'SAVING_INVESTMENT'],
  ])('returns 201 for %s with group %s', async (type, group) => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'X', type, group }), 'user-1', {});
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 for the removed INVESTMENT type', async () => {
    const res = await createCategory(makeEvent({ name: 'X', type: 'INVESTMENT' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

(keep the closing `});` of the describe exactly once).

`src/api/__tests__/transactions.test.ts`: replace the test `accepts INVESTMENT_IN as a transaction type` with:

```ts
  it.each(['SET_ASIDE', 'TAKE_OUT'])('accepts %s as a transaction type', async (type) => {
    mockSend.mockResolvedValueOnce({});
    const res = await createTransaction(makeEvent({
      body: { amount: 30000, type, categoryId: 'cat-holidays', description: 'Monthly contribution', date: '2026-07-15' },
    }), 'user-1', {});
    expect(res.statusCode).toBe(201);
  });

  it.each(['INVESTMENT_IN', 'INVESTMENT_OUT'])('rejects the removed %s type', async (type) => {
    const res = await createTransaction(makeEvent({
      body: { amount: 30000, type, categoryId: 'cat-holidays', description: 'Old type', date: '2026-07-15' },
    }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
```

`src/api/__tests__/recurring.test.ts`: in the accepts table replace `['INVESTMENT_IN', { type: 'INVESTMENT_IN' }],` with `['SET_ASIDE', { type: 'SET_ASIDE' }],` and add `['TAKE_OUT', { type: 'TAKE_OUT' }],`; in the rejects table (the `it.each` right after it) add `['the removed INVESTMENT_IN type', { type: 'INVESTMENT_IN' }],` and `['the removed INVESTMENT_OUT type', { type: 'INVESTMENT_OUT' }],`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api`
Expected: FAIL (defaults are still INVESTMENT type; SET_ASIDE and POT are rejected; the removed types are accepted).

- [ ] **Step 3: Implement**

`src/api/types.ts` lines 1-3 become:

```ts
export type TransactionType = 'EXPENSE' | 'INCOME' | 'SET_ASIDE' | 'TAKE_OUT';

export type CategoryType = 'EXPENSE' | 'INCOME' | 'POT';
```

`src/api/constants.ts`:

```ts
export const VALID_TRANSACTION_TYPES = new Set([
  'EXPENSE', 'INCOME', 'SET_ASIDE', 'TAKE_OUT',
]);

export const VALID_CATEGORY_TYPES = new Set(['EXPENSE', 'INCOME', 'POT']);
export const VALID_CATEGORY_GROUPS = new Set(['BILLS', 'SINKING_FUNDS', 'EVERYDAY', 'SAVING_INVESTMENT']);
export const POT_GROUPS = new Set(['SINKING_FUNDS', 'SAVING_INVESTMENT']);
```

`src/api/defaults.ts`: change the type argument from `'EXPENSE'` to `'POT'` on the four Sinking Funds rows (`cat-holidays`, `cat-home-maintenance`, `cat-gifts`, `cat-insurance`) and from `'INVESTMENT'` to `'POT'` on the two Saving & Investment rows (`cat-emergency-fund`, `cat-investment`). Change the comment `// SAVING & INVESTMENT (INVESTMENT type until pots replace it)` to `// SAVING & INVESTMENT`.

`src/api/categories.ts`: import `POT_GROUPS` from `./constants`; change `defaultGroupFor`:

```ts
function defaultGroupFor(type: CategoryType): CategoryGroup | undefined {
  if (type === 'INCOME') return undefined;
  if (type === 'POT') return 'SINKING_FUNDS';
  return 'EVERYDAY';
}
```

change the type error message to `'type must be EXPENSE, INCOME, or POT'`, and replace the two group/type combination checks with:

```ts
    if (type === 'POT' && !POT_GROUPS.has(group)) {
      return err(400, 'POT categories must use the SINKING_FUNDS or SAVING_INVESTMENT group');
    }
    if (type === 'EXPENSE' && POT_GROUPS.has(group)) {
      return err(400, 'EXPENSE categories cannot use the SINKING_FUNDS or SAVING_INVESTMENT group');
    }
```

`src/api/transactions.ts` and `src/api/recurring.ts`: change the type error message text to `'type must be EXPENSE, INCOME, SET_ASIDE, or TAKE_OUT'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/api` then `yarn typecheck`
Expected: PASS, typecheck clean (the client has its own copies of the types, so it still compiles until Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/constants.ts src/api/defaults.ts src/api/categories.ts src/api/transactions.ts src/api/recurring.ts src/api/__tests__/defaults.test.ts src/api/__tests__/categories.test.ts src/api/__tests__/transactions.test.ts src/api/__tests__/recurring.test.ts
git commit -m "feat: replace investment types with pot and set-aside types"
```

(Append the two trailer lines from Global Constraints.)

---

### Task 2: Pot balance calculation

**Files:**
- Modify: `src/api/types.ts`
- Create: `src/api/potsCalc.ts`, `src/api/__tests__/potsCalc.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `TransactionType` (Task 1).
- Produces (`src/api/types.ts`):

```ts
export interface PotAutoEntry { from: string; amount: number }
export interface PotSettings {
  categoryId: string;
  monthlyAmount: number | null;
  goalAmount: number | null;
  autoContribute: PotAutoEntry[];
  updatedAt: string;
}
export interface PotMonth {
  yearMonth: string; opening: number; setAside: number; autoAdded: number;
  takeOut: number; spent: number; closing: number;
}
export interface PotSummary {
  categoryId: string;
  monthlyAmount: number | null;
  goalAmount: number | null;
  autoAmountNow: number;
  balance: number;
  thisMonth: { setAside: number; autoAdded: number; takeOut: number; spent: number };
  months: PotMonth[];
}
```

- Produces (`src/api/potsCalc.ts`): `nextMonth(yearMonth: string): string`; `autoAmountFor(entries: PotAutoEntry[], yearMonth: string): number`; `computePots(input: { transactions: Transaction[]; potCategoryIds: string[]; settings: PotSettings[]; asOfMonth: string }): PotSummary[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/__tests__/potsCalc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { autoAmountFor, computePots, nextMonth } from '../potsCalc';
import type { PotAutoEntry, PotSettings, Transaction } from '../types';

function txn(yearMonth: string, type: Transaction['type'], amount: number, categoryId = 'pot-a'): Transaction {
  return {
    transactionId: `${yearMonth}-${type}-${amount}-${categoryId}`, yearMonth, amount, type, categoryId,
    description: '', date: `${yearMonth}-10`, createdAt: '',
  };
}

function settings(overrides: Partial<PotSettings> = {}): PotSettings {
  return { categoryId: 'pot-a', monthlyAmount: null, goalAmount: null, autoContribute: [], updatedAt: '', ...overrides };
}

function run(transactions: Transaction[], asOfMonth: string, potSettings: PotSettings[] = []) {
  return computePots({ transactions, potCategoryIds: ['pot-a'], settings: potSettings, asOfMonth })[0];
}

describe('nextMonth', () => {
  it.each([
    ['2026-01', '2026-02'],
    ['2026-11', '2026-12'],
    ['2026-12', '2027-01'],
  ])('%s -> %s', (from, expected) => {
    expect(nextMonth(from)).toBe(expected);
  });
});

describe('autoAmountFor', () => {
  const entries: PotAutoEntry[] = [{ from: '2026-06', amount: 5000 }, { from: '2026-08', amount: 0 }];

  it('is 0 before the first entry', () => {
    expect(autoAmountFor(entries, '2026-05')).toBe(0);
  });

  it('uses the last entry whose month has arrived', () => {
    expect(autoAmountFor(entries, '2026-07')).toBe(5000);
    expect(autoAmountFor(entries, '2026-08')).toBe(0);
    expect(autoAmountFor(entries, '2027-01')).toBe(0);
  });
});

describe('computePots', () => {
  it('returns an empty history and a zero balance for a pot with no activity', () => {
    const pot = run([], '2026-08');
    expect(pot.months).toEqual([]);
    expect(pot.balance).toBe(0);
    expect(pot.autoAmountNow).toBe(0);
    expect(pot.thisMonth).toEqual({ setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 });
    expect(pot.monthlyAmount).toBeNull();
    expect(pot.goalAmount).toBeNull();
  });

  it('adds set asides and draws down on spends, carrying the balance forward', () => {
    const pot = run([txn('2026-07', 'SET_ASIDE', 10000), txn('2026-08', 'EXPENSE', 2500)], '2026-08');
    expect(pot.months.map(m => [m.yearMonth, m.opening, m.closing])).toEqual([
      ['2026-07', 0, 10000],
      ['2026-08', 10000, 7500],
    ]);
    expect(pot.balance).toBe(7500);
    expect(pot.thisMonth).toEqual({ setAside: 0, autoAdded: 0, takeOut: 0, spent: 2500 });
  });

  it('carries the balance across months with no activity', () => {
    const pot = run([txn('2026-06', 'SET_ASIDE', 5000)], '2026-08');
    expect(pot.months.map(m => [m.yearMonth, m.closing])).toEqual([
      ['2026-06', 5000], ['2026-07', 5000], ['2026-08', 5000],
    ]);
  });

  it('takes money out of the pot', () => {
    const pot = run([txn('2026-07', 'SET_ASIDE', 10000), txn('2026-07', 'TAKE_OUT', 4000)], '2026-07');
    expect(pot.months[0]).toMatchObject({ setAside: 10000, takeOut: 4000, closing: 6000 });
  });

  it('allows a negative balance', () => {
    const pot = run([txn('2026-07', 'EXPENSE', 3000)], '2026-07');
    expect(pot.balance).toBe(-3000);
  });

  it('ignores other categories and INCOME entries', () => {
    const pot = run([
      txn('2026-07', 'SET_ASIDE', 1000, 'pot-b'),
      txn('2026-07', 'INCOME', 9999),
      txn('2026-07', 'SET_ASIDE', 2000),
    ], '2026-07');
    expect(pot.balance).toBe(2000);
  });

  it('leaves out entries dated after the as-of month', () => {
    expect(run([txn('2026-09', 'SET_ASIDE', 5000)], '2026-08').months).toEqual([]);
    const pot = run([txn('2026-07', 'SET_ASIDE', 5000), txn('2026-09', 'SET_ASIDE', 5000)], '2026-08');
    expect(pot.balance).toBe(5000);
  });

  it('spans a year boundary without gaps', () => {
    const pot = run([txn('2026-11', 'SET_ASIDE', 100)], '2027-02');
    expect(pot.months.map(m => m.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('changes a backdated month from that month forward', () => {
    const before = run([txn('2026-08', 'SET_ASIDE', 1000)], '2026-08');
    const after = run([txn('2026-08', 'SET_ASIDE', 1000), txn('2026-06', 'SET_ASIDE', 500)], '2026-08');
    expect(before.balance).toBe(1000);
    expect(after.months.map(m => m.closing)).toEqual([500, 500, 1500]);
  });

  describe('auto-contribute', () => {
    it('accrues from its first month through the as-of month inclusive', () => {
      const pot = run([], '2026-08', [settings({ autoContribute: [{ from: '2026-06', amount: 5000 }] })]);
      expect(pot.months.map(m => m.autoAdded)).toEqual([5000, 5000, 5000]);
      expect(pot.balance).toBe(15000);
      expect(pot.autoAmountNow).toBe(5000);
    });

    it('applies an amount change only from its month', () => {
      const pot = run([], '2026-09', [settings({
        autoContribute: [{ from: '2026-06', amount: 5000 }, { from: '2026-08', amount: 7000 }],
      })]);
      expect(pot.months.map(m => m.autoAdded)).toEqual([5000, 5000, 7000, 7000]);
      expect(pot.balance).toBe(24000);
    });

    it('stops when turned off', () => {
      const pot = run([], '2026-09', [settings({
        autoContribute: [{ from: '2026-06', amount: 5000 }, { from: '2026-08', amount: 0 }],
      })]);
      expect(pot.months.map(m => m.autoAdded)).toEqual([5000, 5000, 0, 0]);
      expect(pot.autoAmountNow).toBe(0);
      expect(pot.balance).toBe(10000);
    });

    it('ignores an entry that starts after the as-of month', () => {
      const pot = run([], '2026-08', [settings({ autoContribute: [{ from: '2026-10', amount: 5000 }] })]);
      expect(pot.months).toEqual([]);
      expect(pot.autoAmountNow).toBe(0);
    });

    it('combines with explicit entries in the same month', () => {
      const pot = run([txn('2026-08', 'SET_ASIDE', 1000), txn('2026-08', 'EXPENSE', 300)], '2026-08', [
        settings({ autoContribute: [{ from: '2026-08', amount: 5000 }] }),
      ]);
      expect(pot.months[0]).toMatchObject({ setAside: 1000, autoAdded: 5000, spent: 300, closing: 5700 });
    });
  });

  it('echoes the monthly and goal amounts', () => {
    const pot = run([], '2026-08', [settings({ monthlyAmount: 5000, goalAmount: 300000 })]);
    expect(pot.monthlyAmount).toBe(5000);
    expect(pot.goalAmount).toBe(300000);
  });

  it('returns pots in the order of potCategoryIds', () => {
    const pots = computePots({
      transactions: [], potCategoryIds: ['pot-b', 'pot-a'], settings: [], asOfMonth: '2026-08',
    });
    expect(pots.map(p => p.categoryId)).toEqual(['pot-b', 'pot-a']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run src/api/__tests__/potsCalc.test.ts`
Expected: FAIL (module `../potsCalc` does not exist).

- [ ] **Step 3: Implement**

Append the interfaces from the Interfaces block to `src/api/types.ts`. Create `src/api/potsCalc.ts`:

```ts
import type { PotAutoEntry, PotMonth, PotSettings, PotSummary, Transaction } from './types';

interface Totals {
  setAside: number;
  takeOut: number;
  spent: number;
}

export interface ComputePotsInput {
  transactions: Transaction[];
  potCategoryIds: string[];
  settings: PotSettings[];
  asOfMonth: string;
}

export function nextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const total = year * 12 + (month - 1) + 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function autoAmountFor(entries: PotAutoEntry[], yearMonth: string): number {
  let amount = 0;
  for (const entry of entries) {
    if (entry.from <= yearMonth) amount = entry.amount;
  }
  return amount;
}

function monthlyTotals(transactions: Transaction[], categoryId: string, asOfMonth: string): Map<string, Totals> {
  const byMonth = new Map<string, Totals>();
  for (const t of transactions) {
    if (t.categoryId !== categoryId || t.yearMonth > asOfMonth) continue;
    const totals = byMonth.get(t.yearMonth) ?? { setAside: 0, takeOut: 0, spent: 0 };
    if (t.type === 'SET_ASIDE') totals.setAside += t.amount;
    if (t.type === 'TAKE_OUT') totals.takeOut += t.amount;
    if (t.type === 'EXPENSE') totals.spent += t.amount;
    byMonth.set(t.yearMonth, totals);
  }
  return byMonth;
}

function computePot(
  categoryId: string,
  transactions: Transaction[],
  settings: PotSettings | undefined,
  asOfMonth: string,
): PotSummary {
  const entries = [...(settings?.autoContribute ?? [])]
    .filter(entry => entry.from <= asOfMonth)
    .sort((a, b) => a.from.localeCompare(b.from));
  const totalsByMonth = monthlyTotals(transactions, categoryId, asOfMonth);

  const activityMonths = [...totalsByMonth.keys(), ...entries.map(entry => entry.from)];
  const months: PotMonth[] = [];
  let balance = 0;
  if (activityMonths.length > 0) {
    let month = activityMonths.reduce((earliest, m) => (m < earliest ? m : earliest));
    while (month <= asOfMonth) {
      const totals = totalsByMonth.get(month) ?? { setAside: 0, takeOut: 0, spent: 0 };
      const autoAdded = autoAmountFor(entries, month);
      const opening = balance;
      balance = opening + totals.setAside + autoAdded - totals.takeOut - totals.spent;
      months.push({
        yearMonth: month, opening, setAside: totals.setAside, autoAdded,
        takeOut: totals.takeOut, spent: totals.spent, closing: balance,
      });
      month = nextMonth(month);
    }
  }

  const current = months[months.length - 1];
  return {
    categoryId,
    monthlyAmount: settings?.monthlyAmount ?? null,
    goalAmount: settings?.goalAmount ?? null,
    autoAmountNow: autoAmountFor(entries, asOfMonth),
    balance,
    thisMonth: current
      ? { setAside: current.setAside, autoAdded: current.autoAdded, takeOut: current.takeOut, spent: current.spent }
      : { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 },
    months,
  };
}

export function computePots({ transactions, potCategoryIds, settings, asOfMonth }: ComputePotsInput): PotSummary[] {
  const settingsById = new Map(settings.map(s => [s.categoryId, s]));
  return potCategoryIds.map(categoryId => computePot(categoryId, transactions, settingsById.get(categoryId), asOfMonth));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/api/__tests__/potsCalc.test.ts` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/potsCalc.ts src/api/__tests__/potsCalc.test.ts
git commit -m "feat: add pot balance calculation"
```

---

### Task 3: Pots API handlers

**Files:**
- Modify: `src/api/db.ts`, `api-handler.ts`
- Create: `src/api/pots.ts`, `src/api/__tests__/pots.test.ts`

**Interfaces:**
- Consumes: `computePots`, `autoAmountFor` (Task 2); `PotAutoEntry`, `PotSettings`, `Category`, `Transaction` types; `DEFAULT_CATEGORIES`; `ok`, `err`.
- Produces: `potSk(categoryId: string): string` in `src/api/db.ts`; in `src/api/pots.ts`: `getPots`, `putPot` (both `(event, userId, params) => Promise<ApiResponse>`), `applyAutoContribute(existing: PotAutoEntry[], enabled: boolean, monthlyAmount: number | null, month: string): PotAutoEntry[]`, `MAX_POT_AMOUNT_PENCE = 1_000_000_000`, `MAX_AUTO_ENTRIES = 120`. Routes `GET /api/pots` and `PUT /api/pots/{categoryId}` registered in `api-handler.ts`.
- Response contract: `GET` -> `{ pots: PotSummary[] }`; `PUT` body `{ monthlyAmount: number | null, goalAmount: number | null, autoContribute: boolean, month: 'YYYY-MM' }` -> `{ settings: PotSettings }`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/__tests__/pots.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  PutCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { applyAutoContribute, getPots, putPot, MAX_AUTO_ENTRIES } from '../pots';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { PotAutoEntry } from '../types';

function getEvent(asOf?: string): APIGatewayProxyEventV2 {
  return {
    queryStringParameters: asOf === undefined ? {} : { asOf },
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

function putEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    requestContext: { http: { method: 'PUT' } },
  } as unknown as APIGatewayProxyEventV2;
}

interface Store {
  customCategories?: unknown[];
  settings?: unknown[];
  transactionPages?: unknown[][];
  categoryById?: unknown[];
  existingSettings?: unknown[];
}

function useStore(store: Store): void {
  let page = 0;
  mockSend.mockImplementation(async (command: Record<string, any>) => {
    if (command.Item) return {};
    const values = command.ExpressionAttributeValues as Record<string, string>;
    if (values[':sk']?.startsWith('CAT#')) return { Items: store.categoryById ?? [] };
    if (values[':sk']?.startsWith('POT#')) return { Items: store.existingSettings ?? [] };
    if (values[':prefix'] === 'CAT#') return { Items: store.customCategories ?? [] };
    if (values[':prefix'] === 'POT#') return { Items: store.settings ?? [] };
    const pages = store.transactionPages ?? [[]];
    const items = pages[page] ?? [];
    const last = page < pages.length - 1;
    page += 1;
    return last ? { Items: items, LastEvaluatedKey: { PK: 'x', SK: `page-${page}` } } : { Items: items };
  });
}

function txn(yearMonth: string, type: string, amount: number, categoryId: string) {
  return { SK: `TXN#${yearMonth}#${type}${amount}`, yearMonth, amount, type, categoryId, description: '', date: `${yearMonth}-10`, createdAt: '' };
}

beforeEach(() => {
  mockSend.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
});

afterEach(() => { vi.useRealTimers(); });

describe('getPots', () => {
  it.each([undefined, '', '2026-13', '2026-9', 'nope', '2026-11'])('returns 400 for asOf %j', async (asOf) => {
    const res = await getPots(getEvent(asOf), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('accepts a past month and the month after the server month', async () => {
    useStore({});
    expect((await getPots(getEvent('2024-01'), 'user-1', {})).statusCode).toBe(200);
    expect((await getPots(getEvent('2026-10'), 'user-1', {})).statusCode).toBe(200);
  });

  it('returns only POT categories, defaults and custom, in that order', async () => {
    useStore({
      customCategories: [
        { categoryId: 'custom-pot', name: 'Boiler', type: 'POT', group: 'SINKING_FUNDS', icon: 'tag' },
        { categoryId: 'custom-spend', name: 'Padel', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag' },
      ],
    });
    const body = JSON.parse((await getPots(getEvent('2026-09'), 'user-1', {})).body);
    const ids = body.pots.map((p: { categoryId: string }) => p.categoryId);
    expect(ids).toEqual([
      'cat-holidays', 'cat-home-maintenance', 'cat-gifts', 'cat-insurance',
      'cat-emergency-fund', 'cat-investment', 'custom-pot',
    ]);
  });

  it('derives the balance from every page of transactions and the settings', async () => {
    useStore({
      transactionPages: [
        [txn('2026-07', 'SET_ASIDE', 10000, 'cat-holidays')],
        [txn('2026-08', 'EXPENSE', 2500, 'cat-holidays'), txn('2026-08', 'EXPENSE', 999, 'cat-groceries')],
      ],
      settings: [{ SK: 'POT#cat-holidays', categoryId: 'cat-holidays', monthlyAmount: 5000, goalAmount: 200000, autoContribute: [], updatedAt: 't' }],
    });
    const body = JSON.parse((await getPots(getEvent('2026-08'), 'user-1', {})).body);
    const holidays = body.pots.find((p: { categoryId: string }) => p.categoryId === 'cat-holidays');
    expect(holidays.balance).toBe(7500);
    expect(holidays.monthlyAmount).toBe(5000);
    expect(holidays.goalAmount).toBe(200000);
    const transactionQueries = mockSend.mock.calls.filter(([c]) => c.ExpressionAttributeValues[':prefix'] === 'TXN#');
    expect(transactionQueries).toHaveLength(2);
  });

  it('ignores settings left behind by a category that no longer exists', async () => {
    useStore({
      settings: [{ SK: 'POT#gone', categoryId: 'gone', monthlyAmount: 100, goalAmount: null, autoContribute: [], updatedAt: 't' }],
    });
    const body = JSON.parse((await getPots(getEvent('2026-09'), 'user-1', {})).body);
    expect(body.pots.some((p: { categoryId: string }) => p.categoryId === 'gone')).toBe(false);
  });

  it('returns a pot that has settings but no transactions', async () => {
    useStore({
      settings: [{ SK: 'POT#cat-gifts', categoryId: 'cat-gifts', monthlyAmount: 2000, goalAmount: null, autoContribute: [], updatedAt: 't' }],
    });
    const body = JSON.parse((await getPots(getEvent('2026-09'), 'user-1', {})).body);
    const gifts = body.pots.find((p: { categoryId: string }) => p.categoryId === 'cat-gifts');
    expect(gifts).toMatchObject({ balance: 0, monthlyAmount: 2000, months: [] });
  });
});

describe('applyAutoContribute', () => {
  const on: PotAutoEntry[] = [{ from: '2026-06', amount: 5000 }];

  it('adds an entry when turned on', () => {
    expect(applyAutoContribute([], true, 5000, '2026-09')).toEqual([{ from: '2026-09', amount: 5000 }]);
  });

  it('adds nothing when the amount in force already matches', () => {
    expect(applyAutoContribute(on, true, 5000, '2026-09')).toEqual(on);
    expect(applyAutoContribute([], false, null, '2026-09')).toEqual([]);
  });

  it('adds an entry for a changed amount', () => {
    expect(applyAutoContribute(on, true, 7000, '2026-09')).toEqual([...on, { from: '2026-09', amount: 7000 }]);
  });

  it('adds a zero entry when turned off', () => {
    expect(applyAutoContribute(on, false, 5000, '2026-09')).toEqual([...on, { from: '2026-09', amount: 0 }]);
  });

  it('replaces an entry that starts in the saved month', () => {
    const existing: PotAutoEntry[] = [...on, { from: '2026-09', amount: 7000 }];
    expect(applyAutoContribute(existing, true, 8000, '2026-09')).toEqual([...on, { from: '2026-09', amount: 8000 }]);
  });

  it('removes a same-month entry when the saved amount equals the earlier one', () => {
    const existing: PotAutoEntry[] = [...on, { from: '2026-09', amount: 7000 }];
    expect(applyAutoContribute(existing, true, 5000, '2026-09')).toEqual(on);
  });

  it('drops entries that start after the saved month', () => {
    const existing: PotAutoEntry[] = [...on, { from: '2026-11', amount: 9000 }];
    expect(applyAutoContribute(existing, true, 5000, '2026-09')).toEqual(on);
  });
});

describe('putPot', () => {
  const valid = { monthlyAmount: 5000, goalAmount: 300000, autoContribute: false, month: '2026-09' };

  it.each([
    ['missing monthlyAmount', { ...valid, monthlyAmount: undefined }],
    ['zero monthlyAmount', { ...valid, monthlyAmount: 0 }],
    ['negative goalAmount', { ...valid, goalAmount: -1 }],
    ['fractional goalAmount', { ...valid, goalAmount: 10.5 }],
    ['string monthlyAmount', { ...valid, monthlyAmount: '5000' }],
    ['oversized goalAmount', { ...valid, goalAmount: 1_000_000_001 }],
    ['non-boolean autoContribute', { ...valid, autoContribute: 'yes' }],
    ['malformed month', { ...valid, month: '2026-9' }],
    ['month too far ahead', { ...valid, month: '2026-11' }],
    ['month too far behind', { ...valid, month: '2026-07' }],
    ['auto-contribute without a monthly amount', { ...valid, monthlyAmount: null, autoContribute: true }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await putPot(putEvent(body), 'user-1', { categoryId: 'cat-holidays' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await putPot({ body: '{', requestContext: {} } as unknown as APIGatewayProxyEventV2, 'user-1', { categoryId: 'cat-holidays' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the category is not a pot', async () => {
    useStore({});
    const res = await putPot(putEvent(valid), 'user-1', { categoryId: 'cat-groceries' });
    expect(res.statusCode).toBe(400);
    expect(mockSend.mock.calls.every(([c]) => !c.Item)).toBe(true);
  });

  it('returns 400 when a custom category does not exist', async () => {
    useStore({ categoryById: [] });
    const res = await putPot(putEvent(valid), 'user-1', { categoryId: 'custom-missing' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when a custom category is not a pot', async () => {
    useStore({ categoryById: [{ categoryId: 'custom-1', type: 'EXPENSE' }] });
    const res = await putPot(putEvent(valid), 'user-1', { categoryId: 'custom-1' });
    expect(res.statusCode).toBe(400);
  });

  it('saves settings for a default pot without auto-contribute', async () => {
    useStore({});
    const res = await putPot(putEvent(valid), 'user-1', { categoryId: 'cat-holidays' });
    expect(res.statusCode).toBe(200);
    const put = mockSend.mock.calls.map(([c]) => c).find(c => c.Item);
    expect(put.Item).toMatchObject({
      PK: 'USER#user-1', SK: 'POT#cat-holidays', categoryId: 'cat-holidays',
      monthlyAmount: 5000, goalAmount: 300000, autoContribute: [],
    });
    expect(JSON.parse(res.body).settings.categoryId).toBe('cat-holidays');
  });

  it('starts auto-contribute from the saved month using the monthly amount', async () => {
    useStore({});
    const res = await putPot(putEvent({ ...valid, autoContribute: true }), 'user-1', { categoryId: 'cat-holidays' });
    expect(JSON.parse(res.body).settings.autoContribute).toEqual([{ from: '2026-09', amount: 5000 }]);
  });

  it('allows clearing both amounts', async () => {
    useStore({});
    const res = await putPot(putEvent({ monthlyAmount: null, goalAmount: null, autoContribute: false, month: '2026-09' }), 'user-1', { categoryId: 'cat-holidays' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when the entry list would exceed the cap', async () => {
    const full: PotAutoEntry[] = Array.from({ length: MAX_AUTO_ENTRIES }, (_, i) => ({
      from: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, amount: i % 2 === 0 ? 100 : 0,
    }));
    useStore({ existingSettings: [{ categoryId: 'cat-holidays', monthlyAmount: 5000, goalAmount: null, autoContribute: full }] });
    const res = await putPot(putEvent({ ...valid, autoContribute: true, monthlyAmount: 4242 }), 'user-1', { categoryId: 'cat-holidays' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run src/api/__tests__/pots.test.ts`
Expected: FAIL (module `../pots` does not exist).

- [ ] **Step 3: Implement**

`src/api/db.ts`: append `export const potSk = (categoryId: string): string => \`POT#${categoryId}\`;` (as a template literal on one line, matching the file's style).

Create `src/api/pots.ts`:

```ts
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, catSk, potSk } from './db';
import { DEFAULT_CATEGORIES } from './defaults';
import { autoAmountFor, computePots } from './potsCalc';
import type { ApiResponse, Category, PotAutoEntry, PotSettings, Transaction } from './types';
import { ok, err } from './http';

export const MAX_POT_AMOUNT_PENCE = 1_000_000_000;
export const MAX_AUTO_ENTRIES = 120;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

function monthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
}

function serverMonthIndex(): number {
  const now = new Date();
  return now.getUTCFullYear() * 12 + now.getUTCMonth();
}

function isOptionalAmount(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_POT_AMOUNT_PENCE;
}

async function queryAll(userId: string, prefix: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': prefix },
      ExclusiveStartKey: lastEvaluatedKey,
    }));
    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);
  return items;
}

async function queryOne(userId: string, sk: string): Promise<Record<string, unknown> | undefined> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': pk(userId), ':sk': sk },
  }));
  return result.Items?.[0];
}

function toSettings(item: Record<string, unknown>): PotSettings {
  return {
    categoryId: String(item.categoryId),
    monthlyAmount: typeof item.monthlyAmount === 'number' ? item.monthlyAmount : null,
    goalAmount: typeof item.goalAmount === 'number' ? item.goalAmount : null,
    autoContribute: Array.isArray(item.autoContribute) ? (item.autoContribute as PotAutoEntry[]) : [],
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
  };
}

export function applyAutoContribute(
  existing: PotAutoEntry[],
  enabled: boolean,
  monthlyAmount: number | null,
  month: string,
): PotAutoEntry[] {
  const kept = existing.filter(entry => entry.from < month);
  const desired = enabled ? (monthlyAmount ?? 0) : 0;
  if (autoAmountFor(kept, month) === desired) return kept;
  return [...kept, { from: month, amount: desired }];
}

export async function getPots(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const asOf = event.queryStringParameters?.asOf;
  if (!isValidMonth(asOf) || monthIndex(asOf) > serverMonthIndex() + 1) {
    return err(400, 'asOf must be a month in YYYY-MM format, at most one month ahead');
  }

  const [customCategories, settingsItems, transactionItems] = await Promise.all([
    queryAll(userId, 'CAT#'),
    queryAll(userId, 'POT#'),
    queryAll(userId, 'TXN#'),
  ]);
  const categories = [...DEFAULT_CATEGORIES, ...(customCategories as unknown as Category[])];
  const potCategoryIds = categories.filter(c => c.type === 'POT').map(c => c.categoryId);
  const pots = computePots({
    transactions: transactionItems as unknown as Transaction[],
    potCategoryIds,
    settings: settingsItems.map(toSettings),
    asOfMonth: asOf,
  });
  return ok({ pots });
}

async function findCategory(userId: string, categoryId: string): Promise<Category | undefined> {
  const builtIn = DEFAULT_CATEGORIES.find(c => c.categoryId === categoryId);
  if (builtIn) return builtIn;
  return (await queryOne(userId, catSk(categoryId))) as Category | undefined;
}

export async function putPot(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;
  if (!categoryId) {
    return err(400, 'categoryId is required');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { monthlyAmount, goalAmount, autoContribute, month } = body;
  if (!isOptionalAmount(monthlyAmount)) {
    return err(400, 'monthlyAmount must be null or a positive integer of pence');
  }
  if (!isOptionalAmount(goalAmount)) {
    return err(400, 'goalAmount must be null or a positive integer of pence');
  }
  if (typeof autoContribute !== 'boolean') {
    return err(400, 'autoContribute must be a boolean');
  }
  if (!isValidMonth(month) || Math.abs(monthIndex(month) - serverMonthIndex()) > 1) {
    return err(400, 'month must be a YYYY-MM month within one month of now');
  }
  if (autoContribute && monthlyAmount === null) {
    return err(400, 'autoContribute needs a monthlyAmount');
  }

  const category = await findCategory(userId, categoryId);
  if (!category || category.type !== 'POT') {
    return err(400, 'categoryId must be an existing pot category');
  }

  const existingItem = await queryOne(userId, potSk(categoryId));
  const existing = existingItem ? toSettings(existingItem) : undefined;
  const entries = applyAutoContribute(existing?.autoContribute ?? [], autoContribute, monthlyAmount, month);
  if (entries.length > MAX_AUTO_ENTRIES) {
    return err(400, 'Too many auto-contribute changes for this pot');
  }

  const settings: PotSettings = {
    categoryId,
    monthlyAmount,
    goalAmount,
    autoContribute: entries,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: potSk(categoryId), ...settings },
  }));
  return ok({ settings });
}
```

Wire the routes in `api-handler.ts`: add `import { getPots, putPot } from './src/api/pots';` next to the other API imports and, after the targets routes, `router.get('/api/pots', getPots);` and `router.put('/api/pots/{categoryId}', putPot);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/api` then `yarn typecheck`
Expected: PASS, clean. (The cap test relies on a 120-entry list whose amounts alternate; the new entry at `2026-09` makes it 121.)

- [ ] **Step 5: Commit**

```bash
git add src/api/db.ts src/api/pots.ts src/api/__tests__/pots.test.ts api-handler.ts
git commit -m "feat: add pots API for balances and settings"
```

---

### Task 4: Client type rename, entry types and Categories form

**Files:**
- Modify: `app/lib/types.ts`, `app/lib/transactionTypes.ts`, `app/lib/transactions.ts`, `app/lib/noteMemory.ts`, `app/lib/categoryGroups.ts`, `app/lib/summary.ts`, `app/components/transactions/TransactionSheet.tsx`, `app/components/transactions/TransactionRow.tsx`, `app/components/recurring/RecurringForm.tsx`, `app/routes/transactions.tsx`, `app/routes/categories.tsx`, `app/routes/targets.tsx`, `app/routes/_index.tsx`
- Modify (tests): `app/lib/__tests__/transactionTypes.test.ts`, `app/lib/__tests__/transactions.test.ts`, `app/lib/__tests__/categoryGroups.test.ts`, `app/lib/__tests__/summary.test.ts`, `app/routes/__tests__/categories.test.tsx`, `app/routes/__tests__/targets.test.tsx`, plus any other test the compiler flags (`TransactionSheet.test.tsx`, `RecurringForm.test.tsx`, `DueRecurringCard.test.tsx`, `noteMemory.test.ts`)

**Interfaces:**
- Produces (`app/lib/types.ts`): `TransactionType = 'EXPENSE' | 'INCOME' | 'SET_ASIDE' | 'TAKE_OUT'`, `CategoryType = 'EXPENSE' | 'INCOME' | 'POT'`.
- Produces (`app/lib/transactionTypes.ts`): `TYPE_OPTIONS`, `categoryTypesFor(type: TransactionType): CategoryType[]` (replaces `categoryTypeFor`, which is deleted), `formatSignedPence(type, pence)`.
- Produces (`app/lib/categoryGroups.ts`): `defaultGroupFor(type)` returns `null` / `'SINKING_FUNDS'` / `'EVERYDAY'`; `groupsForType(type)` returns Bills+Everyday for EXPENSE, Sinking Funds+Saving & Investment for POT, `[]` for INCOME.
- Removes: `MonthSummary.saving` from `app/lib/summary.ts` (Home's "Saving vs target" section goes; the Pots section arrives in Task 8).

- [ ] **Step 1: Update the tests first**

`app/lib/__tests__/transactionTypes.test.ts` becomes:

```ts
import { describe, it, expect } from 'vitest';
import { categoryTypesFor, formatSignedPence, TYPE_OPTIONS } from '../transactionTypes';

describe('TYPE_OPTIONS', () => {
  it('offers Spend, Income, Set aside and Take out in that order', () => {
    expect(TYPE_OPTIONS.map(option => [option.label, option.value])).toEqual([
      ['Spend', 'EXPENSE'],
      ['Income', 'INCOME'],
      ['Set aside', 'SET_ASIDE'],
      ['Take out', 'TAKE_OUT'],
    ]);
  });
});

describe('categoryTypesFor', () => {
  it.each([
    ['EXPENSE', ['EXPENSE', 'POT']],
    ['INCOME', ['INCOME']],
    ['SET_ASIDE', ['POT']],
    ['TAKE_OUT', ['POT']],
  ] as const)('%s -> %j', (type, expected) => {
    expect(categoryTypesFor(type)).toEqual(expected);
  });
});

describe('formatSignedPence', () => {
  it('shows outgoing types with a minus and incoming types with a plus', () => {
    expect(formatSignedPence('EXPENSE', 480)).toBe('−£4.80');
    expect(formatSignedPence('SET_ASIDE', 10000)).toBe('−£100.00');
    expect(formatSignedPence('INCOME', 240000)).toBe('+£2,400.00');
    expect(formatSignedPence('TAKE_OUT', 5000)).toBe('+£50.00');
  });
});
```

`app/lib/__tests__/transactions.test.ts`: in the `topCategories` tests around line 79, change the fixture to `[cat('a'), cat('b'), cat('c'), cat('salary', 'INCOME'), cat('holidays', 'POT')]` and replace the two `INVESTMENT_IN` / `INVESTMENT_OUT` expectations with:

```ts
    expect(topCategories([], list, 'SET_ASIDE', 5).map(c => c.categoryId)).toEqual(['holidays']);
    expect(topCategories([], list, 'TAKE_OUT', 5).map(c => c.categoryId)).toEqual(['holidays']);
    expect(topCategories([], list, 'EXPENSE', 5).map(c => c.categoryId)).toEqual(['a', 'b', 'c', 'holidays']);
```

Keep the surrounding assertions (including any ordering-by-usage test) working against the new fixture; where a test counts usage for the old `stocks` id, use `holidays`.

`app/lib/__tests__/categoryGroups.test.ts`: change the fixture `cat('save', 'INVESTMENT', 'SAVING_INVESTMENT')` to `cat('save', 'POT', 'SAVING_INVESTMENT')`, and replace the `defaultGroupFor` and `groupsForType` tests with:

```ts
describe('defaultGroupFor', () => {
  it('returns null for income, Sinking Funds for pot and Everyday for spending', () => {
    expect(defaultGroupFor('INCOME')).toBeNull();
    expect(defaultGroupFor('POT')).toBe('SINKING_FUNDS');
    expect(defaultGroupFor('EXPENSE')).toBe('EVERYDAY');
  });
});

describe('groupsForType', () => {
  it('offers Bills and Everyday Spending for EXPENSE', () => {
    expect(groupsForType('EXPENSE').map(o => o.value)).toEqual(['BILLS', 'EVERYDAY']);
  });

  it('offers Sinking Funds and Saving & Investment for POT', () => {
    expect(groupsForType('POT').map(o => o.value)).toEqual(['SINKING_FUNDS', 'SAVING_INVESTMENT']);
  });

  it('offers nothing for INCOME', () => {
    expect(groupsForType('INCOME')).toEqual([]);
  });
});
```

`app/lib/__tests__/summary.test.ts`: remove the `cat-stocks` INVESTMENT fixture and the two tests `nets investment IN against OUT for saving progress` and `never reports negative saving progress`; add:

```ts
  it('ignores targets on pot categories', () => {
    const res = buildMonthSummary({
      transactions: [],
      categories: [{ categoryId: 'pot-1', name: 'Holidays', type: 'POT', icon: 'tag', isDefault: true, createdAt: '', group: 'SINKING_FUNDS' }],
      targets: [{ categoryId: 'pot-1', targetAmount: 5000, period: 'MONTHLY', updatedAt: '' }],
      yearMonth: '2026-09',
    });
    expect(res.spending).toEqual([]);
    expect('saving' in res).toBe(false);
  });
```

`app/routes/__tests__/targets.test.tsx`: change the `Windows` fixture to `{ categoryId: 'w', name: 'Emergency fund', type: 'POT', group: 'SAVING_INVESTMENT', icon: '😌', isDefault: true, createdAt: '' }`; change the heading expectation to `['Bills', 'Everyday Spending']` and add `expect(screen.queryByText('😌 Emergency fund')).not.toBeInTheDocument();`.

`app/routes/__tests__/categories.test.tsx`: replace the test that selects Type `Investment` and expects `type: 'INVESTMENT'` with:

```tsx
  it('offers Sinking Funds and Saving & Investment for a Pot and sends the chosen group', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Pot', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Sinking Funds');

    await user.type(screen.getByLabelText('New category'), 'Boiler');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Boiler', type: 'POT', icon: 'tag', group: 'SINKING_FUNDS' });
  });
```

and make the existing "does not offer Saving & Investment for Spending" test also assert `'Sinking Funds'` is not offered. Update any remaining `'Investment'` Type option labels in that file to `'Pot'`.

For every other test the compiler flags (`yarn typecheck` lists them), apply this mapping: `INVESTMENT_IN` -> `SET_ASIDE`, `INVESTMENT_OUT` -> `TAKE_OUT`, category type `'INVESTMENT'` -> `'POT'`, labels `Invest in` / `Invest out` -> `Set aside` / `Take out`. Assertions must keep their strength (do not delete a test to make it compile unless the behaviour is removed, as with the Home saving tests).

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn typecheck; yarn vitest run app`
Expected: FAIL (type errors and failing tests; the old types are still in the code).

- [ ] **Step 3: Implement**

`app/lib/types.ts` lines 1-2:

```ts
export type TransactionType = 'EXPENSE' | 'INCOME' | 'SET_ASIDE' | 'TAKE_OUT';
export type CategoryType = 'EXPENSE' | 'INCOME' | 'POT';
```

Replace the whole of `app/lib/transactionTypes.ts` with:

```ts
import { formatPence } from './money';
import type { CategoryType, TransactionType } from './types';

export const TYPE_OPTIONS: { label: string; value: TransactionType }[] = [
  { label: 'Spend', value: 'EXPENSE' },
  { label: 'Income', value: 'INCOME' },
  { label: 'Set aside', value: 'SET_ASIDE' },
  { label: 'Take out', value: 'TAKE_OUT' },
];

const CATEGORY_TYPES_BY_TRANSACTION_TYPE: Record<TransactionType, CategoryType[]> = {
  EXPENSE: ['EXPENSE', 'POT'],
  INCOME: ['INCOME'],
  SET_ASIDE: ['POT'],
  TAKE_OUT: ['POT'],
};

export function categoryTypesFor(type: TransactionType): CategoryType[] {
  return CATEGORY_TYPES_BY_TRANSACTION_TYPE[type];
}

const OUTGOING_TYPES: ReadonlySet<TransactionType> = new Set<TransactionType>(['EXPENSE', 'SET_ASIDE']);

export function formatSignedPence(type: TransactionType, pence: number): string {
  return `${OUTGOING_TYPES.has(type) ? '−' : '+'}${formatPence(pence)}`;
}
```

`app/lib/transactions.ts`: import `categoryTypesFor` instead of `categoryTypeFor`; in `topCategories` replace `const categoryType = categoryTypeFor(type);` and its filter with `const categoryTypes = categoryTypesFor(type);` and `.filter(c => categoryTypes.includes(c.type))`.

`app/lib/noteMemory.ts` (around lines 1 and 41): import `categoryTypesFor`; replace `const categoryType = categoryTypeFor(type);` / `c.type === categoryType` with `const categoryTypes = categoryTypesFor(type);` / `categoryTypes.includes(c.type)`.

`app/components/transactions/TransactionSheet.tsx`: change the import to `import { TYPE_OPTIONS, categoryTypesFor } from '~/lib/transactionTypes';` and line 104 to `const eligible = categories.filter(c => categoryTypesFor(type).includes(c.type));`.

`app/components/recurring/RecurringForm.tsx` (line 8 import and line 56): same change (`categoryTypesFor(type).includes(c.type)`).

`app/components/transactions/TransactionRow.tsx` line 7: `const OUTGOING = new Set(['EXPENSE', 'SET_ASIDE']);`.

`app/routes/transactions.tsx` filter options:

```ts
const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'SET_ASIDE', label: 'Set aside' },
  { value: 'TAKE_OUT', label: 'Take out' },
];
```

`app/lib/categoryGroups.ts`: replace `defaultGroupFor` and `groupsForType` with:

```ts
export function defaultGroupFor(type: CategoryType): CategoryGroup | null {
  if (type === 'INCOME') return null;
  if (type === 'POT') return 'SINKING_FUNDS';
  return 'EVERYDAY';
}

const GROUPS_BY_TYPE: Record<CategoryType, CategoryGroup[]> = {
  EXPENSE: ['BILLS', 'EVERYDAY'],
  POT: ['SINKING_FUNDS', 'SAVING_INVESTMENT'],
  INCOME: [],
};

export function groupsForType(type: CategoryType): { value: CategoryGroup; label: string }[] {
  return GROUP_OPTIONS.filter(option => GROUPS_BY_TYPE[type].includes(option.value));
}
```

`app/lib/summary.ts`: delete `saving` from `MonthSummary`, delete the `saving` array and the whole `else if (category.type === 'INVESTMENT') { ... }` branch in `buildMonthSummary`, and remove `saving: saving.sort(byOverThenPercent)` from the return object.

`app/routes/categories.tsx`: change the `TYPES` entry `{ value: 'INVESTMENT', label: 'Investment' }` to `{ value: 'POT', label: 'Pot' }`, and change the Group select's `disabled={type !== 'EXPENSE'}` to `disabled={type === 'INCOME'}`. (The Type `onChange` already keeps a still-valid group and otherwise resets to `defaultGroupFor`, and the create payload already omits `group` only for INCOME.)

`app/routes/targets.tsx`: change `const eligible = (categories.data ?? []).filter(c => c.type !== 'INCOME');` to `const eligible = (categories.data ?? []).filter(c => c.type === 'EXPENSE');` and the helper text to `Income and pots have no monthly target here. Set a pot's goal and plan on the Pots page.`

`app/routes/_index.tsx`: change `const hasTargets = summary.spending.length > 0 || summary.saving.length > 0;` to `const hasTargets = summary.spending.length > 0;` and delete the whole `{summary.saving.length > 0 && (...)}` block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: full suite PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app src
git commit -m "feat: rename client types to pots and set-aside entries"
```

(Stage explicitly with `git add` on the files you changed rather than whole directories if other files are dirty.)

---

### Task 5: Client pots data layer

**Files:**
- Modify: `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`
- Create: `app/lib/__tests__/potsHooks.test.tsx`
- Modify (tests): `app/lib/__tests__/transactionMutations.test.tsx`

**Interfaces:**
- Consumes: the types from Task 4.
- Produces (`app/lib/types.ts`):

```ts
export interface PotMonth {
  yearMonth: string; opening: number; setAside: number; autoAdded: number;
  takeOut: number; spent: number; closing: number;
}
export interface PotSummary {
  categoryId: string;
  monthlyAmount: number | null;
  goalAmount: number | null;
  autoAmountNow: number;
  balance: number;
  thisMonth: { setAside: number; autoAdded: number; takeOut: number; spent: number };
  months: PotMonth[];
}
export interface PotSettingsInput {
  monthlyAmount: number | null;
  goalAmount: number | null;
  autoContribute: boolean;
  month: string;
}
```

- Produces (`app/lib/api.ts`): `getPots(asOf: string): Promise<PotSummary[]>`, `savePot(categoryId: string, input: PotSettingsInput): Promise<void>`.
- Produces (`app/lib/queries.ts`): `queryKeys.pots: (asOf: string) => ['pots', asOf]`, `usePots(asOf: string, enabled?: boolean)`, `useSavePot()` (mutation variables `{ categoryId: string; input: PotSettingsInput }`), and `['pots']` invalidation from every hook that changes transactions, categories or pot settings.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/potsHooks.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PotSummary } from '../types';

const request = vi.fn();

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: true }) }));

import { queryKeys, usePots, useSavePot } from '../queries';

const pot: PotSummary = {
  categoryId: 'cat-holidays', monthlyAmount: 5000, goalAmount: null, autoAmountNow: 0, balance: 1000,
  thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [],
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
});

describe('usePots', () => {
  it('fetches the pots for the given month', async () => {
    request.mockResolvedValue({ pots: [pot] });
    const { result } = renderHook(() => usePots('2026-09'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([pot]));
    expect(request).toHaveBeenCalledWith('/api/pots?asOf=2026-09');
  });

  it('does not fetch when disabled', () => {
    renderHook(() => usePots('2026-09', false), { wrapper });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('useSavePot', () => {
  const input = { monthlyAmount: 5000, goalAmount: null, autoContribute: true, month: '2026-09' };

  it('PUTs the settings and invalidates every cached pots query', async () => {
    request.mockResolvedValue({ settings: {} });
    client.setQueryData(queryKeys.pots('2026-09'), [pot]);
    client.setQueryData(queryKeys.pots('2026-08'), [pot]);
    const { result } = renderHook(() => useSavePot(), { wrapper });

    await act(async () => { await result.current.mutateAsync({ categoryId: 'cat-holidays', input }); });

    expect(request).toHaveBeenCalledWith('/api/pots/cat-holidays', { method: 'PUT', body: JSON.stringify(input) });
    expect(client.getQueryState(queryKeys.pots('2026-09'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.pots('2026-08'))?.isInvalidated).toBe(true);
  });
});
```

In `app/lib/__tests__/transactionMutations.test.tsx` add (inside the file's existing structure, using its `request`, `client`, `wrapper`, `input`, `existing`, `deferred` helpers; import `useUpdateTransaction` and `useDeleteTransaction` from `../queries` if not already imported):

```tsx
describe('pots invalidation', () => {
  const potsKey = queryKeys.pots('2026-07');

  it('invalidates pots when a transaction is created', async () => {
    request.mockResolvedValue({ transaction: { ...existing, transactionId: 'real' } });
    client.setQueryData(potsKey, []);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(client.getQueryState(potsKey)?.isInvalidated).toBe(true);
  });

  it('invalidates pots when a transaction is deleted', async () => {
    request.mockResolvedValue(undefined);
    client.setQueryData(potsKey, []);
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ transactionId: 't1', yearMonth: '2026-07' }); });
    expect(client.getQueryState(potsKey)?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run app/lib/__tests__/potsHooks.test.tsx app/lib/__tests__/transactionMutations.test.tsx`
Expected: FAIL (`usePots`, `useSavePot`, `queryKeys.pots` do not exist).

- [ ] **Step 3: Implement**

Append the three interfaces above to `app/lib/types.ts`.

`app/lib/api.ts`: extend the type import with `PotSettingsInput, PotSummary`, and add inside the object returned by `createApi`, after `deleteTarget`:

```ts
    getPots: async (asOf: string): Promise<PotSummary[]> => {
      const res = await request(`/api/pots?asOf=${encodeURIComponent(asOf)}`) as { pots: PotSummary[] };
      return res.pots;
    },
    savePot: async (categoryId: string, input: PotSettingsInput): Promise<void> => {
      await request(`/api/pots/${encodeURIComponent(categoryId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
```

`app/lib/queries.ts`: add `PotSettingsInput` to the types import; add `pots: (asOf: string) => ['pots', asOf] as const,` to `queryKeys`; add:

```ts
export function usePots(asOf: string, enabled: boolean = true) {
  const api = useApi();
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.pots(asOf),
    queryFn: () => api.getPots(asOf),
    enabled: authReady && enabled,
  });
}

export function useSavePot() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; input: PotSettingsInput }) =>
      api.savePot(vars.categoryId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pots'] }),
  });
}
```

and add `qc.invalidateQueries({ queryKey: ['pots'] });` to: `useCreateTransaction`'s `onSettled`; `useUpdateTransaction`'s `onSuccess`; `useDeleteTransaction`'s `onSuccess` (change it to a block body that invalidates both keys); `useCreateCategory`'s `onSuccess`; `useReassignCategory`'s `onSuccess`; `useDeleteCategory`'s `onSuccess`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/lib/types.ts app/lib/api.ts app/lib/queries.ts app/lib/__tests__/potsHooks.test.tsx app/lib/__tests__/transactionMutations.test.tsx
git commit -m "feat: add the pots data layer"
```

---

### Task 6: Pots page, navigation and the Set aside shortcut

**Files:**
- Create: `app/lib/pots.ts`, `app/lib/__tests__/pots.test.ts`, `app/components/pots/PotRow.tsx`, `app/routes/pots.tsx`, `app/routes/__tests__/pots.test.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`, `app/components/layout/__tests__/DefaultLayout.test.tsx`, `app/components/transactions/TransactionSheet.tsx`, `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: `PotSummary` (Task 5), `usePots`, `useCategories`, `groupItems`, `bucketKeyFor`, `categoryLabel`, `formatPence`, `currentYearMonth`, `TransactionSheet`.
- Produces (`app/lib/pots.ts`): `goalPercent(balance: number, goal: number | null): number | null`; `thisMonthSummary(pot: PotSummary): string | null`.
- Produces: `PotRow({ pot, category, onOpen?, onSetAside })`; `TransactionSheet` gains `preset?: { type: TransactionType; categoryId: string } | null`; route `/pots` and a Pots nav item.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/pots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { goalPercent, thisMonthSummary } from '../pots';
import type { PotSummary } from '../types';

function pot(thisMonth: Partial<PotSummary['thisMonth']> = {}): PotSummary {
  return {
    categoryId: 'p', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0, months: [],
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0, ...thisMonth },
  };
}

describe('goalPercent', () => {
  it('is null without a goal', () => {
    expect(goalPercent(5000, null)).toBeNull();
    expect(goalPercent(5000, 0)).toBeNull();
  });

  it('rounds and clamps between 0 and 100', () => {
    expect(goalPercent(80000, 300000)).toBe(27);
    expect(goalPercent(400000, 300000)).toBe(100);
    expect(goalPercent(-500, 300000)).toBe(0);
  });
});

describe('thisMonthSummary', () => {
  it('is null when nothing happened', () => {
    expect(thisMonthSummary(pot())).toBeNull();
  });

  it('joins set aside (including auto), take out and spent with signs', () => {
    expect(thisMonthSummary(pot({ setAside: 3000, autoAdded: 2000, takeOut: 500, spent: 1250 })))
      .toBe('+£50.00 set aside · −£5.00 taken out · −£12.50 spent');
  });

  it('omits the parts that are zero', () => {
    expect(thisMonthSummary(pot({ spent: 2000 }))).toBe('−£20.00 spent');
  });
});
```

Create `app/routes/__tests__/pots.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, PotSummary } from '~/lib/types';

const state = vi.hoisted(() => ({
  categories: [] as unknown[],
  pots: [] as unknown[],
  potsError: false,
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, preset }: { opened: boolean; preset?: { type: string; categoryId: string } | null }) =>
    (opened ? <div>Add sheet: {preset?.type} {preset?.categoryId}</div> : null),
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  usePots: () => ({
    data: state.potsError ? undefined : state.pots,
    isLoading: false,
    error: state.potsError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
}));

import Pots from '../pots';

function cat(categoryId: string, name: string, group: Category['group'], icon = 'tag'): Category {
  return { categoryId, name, type: 'POT', group, icon, isDefault: true, createdAt: '' };
}

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function renderPage() {
  return render(<MantineProvider><Pots /></MantineProvider>);
}

beforeEach(() => {
  state.potsError = false;
  state.categories = [
    cat('cat-holidays', 'Holidays', 'SINKING_FUNDS', '✈️'),
    cat('cat-emergency-fund', 'Emergency fund', 'SAVING_INVESTMENT', '😌'),
  ];
  state.pots = [
    pot('cat-holidays', { balance: 25000, thisMonth: { setAside: 5000, autoAdded: 0, takeOut: 0, spent: 1000 } }),
    pot('cat-emergency-fund', { balance: 80000, goalAmount: 300000, monthlyAmount: 5000, autoAmountNow: 5000 }),
  ];
});

describe('Pots page', () => {
  it('groups pots under Sinking Funds and Saving & Investment in group order', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(headings).toEqual(['Sinking Funds', 'Saving & Investment']);
  });

  it('shows the emoji label, balance and this month for a pot', () => {
    renderPage();
    expect(screen.getByText('✈️ Holidays')).toBeInTheDocument();
    expect(screen.getByText('£250.00')).toBeInTheDocument();
    expect(screen.getByText('+£50.00 set aside · −£10.00 spent')).toBeInTheDocument();
  });

  it('shows goal progress and the auto-contribute badge', () => {
    renderPage();
    expect(screen.getByText('£800.00 of £3,000.00')).toBeInTheDocument();
    expect(screen.getByText('Auto £50.00/mo')).toBeInTheDocument();
  });

  it('flags a balance below zero', () => {
    state.pots = [pot('cat-holidays', { balance: -3000 }), pot('cat-emergency-fund')];
    renderPage();
    expect(screen.getByText('Below zero')).toBeInTheDocument();
    expect(screen.getByText('−£30.00')).toBeInTheDocument();
  });

  it('opens the Add sheet on Set aside with the pot preselected', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set aside to Holidays' }));
    expect(screen.getByText('Add sheet: SET_ASIDE cat-holidays')).toBeInTheDocument();
  });

  it('shows an empty state when there are no pots', () => {
    state.categories = [];
    state.pots = [];
    renderPage();
    expect(screen.getByText(/No pots yet/)).toBeInTheDocument();
  });

  it('shows an error with a retry when the pots fail to load', () => {
    state.potsError = true;
    renderPage();
    expect(screen.getByText('Could not load pots')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
```

`app/components/layout/__tests__/DefaultLayout.test.tsx`: add inside `describe('DefaultLayout add shortcut')`:

```tsx
  it('links to Pots from both the bottom tab bar and the sidebar', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: 'Pots' });
    expect(links).toHaveLength(2);
    links.forEach(link => expect(link).toHaveAttribute('href', '/pots'));
  });
```

`app/components/transactions/__tests__/TransactionSheet.test.tsx`: read the file's existing render helper and mocks, then add a test in its style (no new mocks) that renders the sheet opened with `preset={{ type: 'SET_ASIDE', categoryId: 'cat-holidays' }}` and a categories fixture containing a `POT` category with id `cat-holidays` named `Holidays`, and asserts (a) the type control has `Set aside` selected (`screen.getByRole('radio', { name: 'Set aside' })` is checked) and (b) the `Holidays` chip radio is checked. Add a second test that opening with `editing` set ignores `preset`.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run app/lib/__tests__/pots.test.ts app/routes/__tests__/pots.test.tsx app/components/layout app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/lib/pots.ts`:

```ts
import { formatPence } from './money';
import type { PotSummary } from './types';

export function goalPercent(balance: number, goal: number | null): number | null {
  if (goal === null || goal <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((balance / goal) * 100)));
}

export function thisMonthSummary(pot: PotSummary): string | null {
  const { setAside, autoAdded, takeOut, spent } = pot.thisMonth;
  const parts: string[] = [];
  if (setAside + autoAdded > 0) parts.push(`+${formatPence(setAside + autoAdded)} set aside`);
  if (takeOut > 0) parts.push(`−${formatPence(takeOut)} taken out`);
  if (spent > 0) parts.push(`−${formatPence(spent)} spent`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
```

Create `app/components/pots/PotRow.tsx`:

```tsx
import { Badge, Button, Card, Group, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence } from '~/lib/money';
import { goalPercent, thisMonthSummary } from '~/lib/pots';
import type { Category, PotSummary } from '~/lib/types';

export interface PotRowProps {
  pot: PotSummary;
  category: Category;
  onSetAside: () => void;
  onOpen?: () => void;
}

function formatBalance(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence);
}

export function PotRow({ pot, category, onSetAside, onOpen }: PotRowProps) {
  const percent = goalPercent(pot.balance, pot.goalAmount);
  const activity = thisMonthSummary(pot);
  const name = categoryLabel(category);

  const details = (
    <Stack gap={4}>
      <Group gap="xs" wrap="wrap">
        <Text fw={500}>{name}</Text>
        {pot.autoAmountNow > 0 && <Badge size="xs" variant="light">Auto {formatPence(pot.autoAmountNow)}/mo</Badge>}
        {pot.balance < 0 && <Badge size="xs" variant="light" color="danger">Below zero</Badge>}
      </Group>
      <Text fw={700} size="lg" c={pot.balance < 0 ? 'danger' : undefined}>{formatBalance(pot.balance)}</Text>
      {pot.goalAmount !== null && (
        <>
          <Progress value={percent ?? 0} aria-label={`${category.name} goal progress`} />
          <Text size="xs" c="dimmed">{formatPence(Math.max(0, pot.balance))} of {formatPence(pot.goalAmount)}</Text>
        </>
      )}
      {activity && <Text size="xs" c="dimmed">{activity}</Text>}
    </Stack>
  );

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        {onOpen
          ? <UnstyledButton onClick={onOpen} style={{ flex: 1, minWidth: 0 }} aria-label={`Open ${category.name} history`}>{details}</UnstyledButton>
          : <div style={{ flex: 1, minWidth: 0 }}>{details}</div>}
        <Button size="compact-sm" variant="light" onClick={onSetAside} aria-label={`Set aside to ${category.name}`}>
          Set aside
        </Button>
      </Group>
    </Card>
  );
}
```

Create `app/routes/pots.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { PotRow } from '~/components/pots/PotRow';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { bucketKeyFor, groupItems } from '~/lib/categoryGroups';
import { currentYearMonth } from '~/lib/months';
import { useCategories, usePots } from '~/lib/queries';
import type { Category, PotSummary } from '~/lib/types';

function PotsContent() {
  const asOf = currentYearMonth();
  const categories = useCategories();
  const pots = usePots(asOf);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  if (categories.error || pots.error) {
    return (
      <Alert color="danger" title="Could not load pots">
        <Button onClick={() => { categories.refetch(); pots.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || pots.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const categoryById = new Map((categories.data ?? []).map(c => [c.categoryId, c]));
  const rows = (pots.data ?? [])
    .map(pot => ({ pot, category: categoryById.get(pot.categoryId) }))
    .filter((row): row is { pot: PotSummary; category: Category } => row.category !== undefined);

  return (
    <Stack>
      <Title order={3}>Pots</Title>
      {rows.length === 0 && (
        <Text c="dimmed">No pots yet. Add a category with the Pot type on the Categories page.</Text>
      )}
      {groupItems(rows, row => bucketKeyFor(row.category)).map(bucket => (
        <div key={bucket.key}>
          <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
          {bucket.items.map(({ pot, category }) => (
            <PotRow
              key={pot.categoryId}
              pot={pot}
              category={category}
              onSetAside={() => setAddingTo(pot.categoryId)}
            />
          ))}
        </div>
      ))}
      <TransactionSheet
        opened={addingTo !== null}
        onClose={() => setAddingTo(null)}
        yearMonth={asOf}
        preset={addingTo ? { type: 'SET_ASIDE', categoryId: addingTo } : null}
      />
    </Stack>
  );
}

export default function Pots() {
  return (
    <DefaultLayout>
      <PotsContent />
    </DefaultLayout>
  );
}
```

`app/components/transactions/TransactionSheet.tsx`: add `preset?: { type: TransactionType; categoryId: string } | null;` to `TransactionSheetProps`, destructure it, and in the reset effect add a branch between `template` and the default:

```tsx
    } else if (preset) {
      setAmount('');
      setType(preset.type);
      setCategoryId(preset.categoryId);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('user');
    } else {
```

and add `preset` to that effect's dependency array.

`app/components/layout/DefaultLayout.tsx`: import `IconPigMoney` from `@tabler/icons-react` and insert `{ to: '/pots', label: 'Pots', Icon: IconPigMoney },` into `NAV_ITEMS` between Targets and Categories. If the installed `@tabler/icons-react` does not export `IconPigMoney` (typecheck will say so), use `IconPiggyBank` instead; no other change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean. Note the Pots page has no history view yet; rows are not clickable until Task 7.

- [ ] **Step 5: Commit**

```bash
git add app/lib/pots.ts app/lib/__tests__/pots.test.ts app/components/pots app/routes/pots.tsx app/routes/__tests__/pots.test.tsx app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/DefaultLayout.test.tsx app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -m "feat: add the Pots page and Set aside shortcut"
```

---

### Task 7: Pot history sheet, trend line and settings

**Files:**
- Create: `app/components/pots/PotTrend.tsx`, `app/components/pots/PotHistorySheet.tsx`, `app/components/pots/__tests__/PotTrend.test.tsx`, `app/components/pots/__tests__/PotHistorySheet.test.tsx`
- Modify: `app/routes/pots.tsx`, `app/routes/__tests__/pots.test.tsx`

**Interfaces:**
- Consumes: `PotSummary`, `PotMonth`, `useSavePot` (Task 5), `ResponsiveSheet`, `parsePounds`, `formatPence`, `formatPencePlain`, `formatMonthLabel`, `currentYearMonth`, `categoryLabel`.
- Produces: `trendPoints(values: number[], width?: number, height?: number): string`; `PotTrend({ values })`; `PotHistorySheet({ pot, category, onClose })` (renders nothing visible when `pot` is null); `parseOptionalPounds(text: string): { ok: true; pence: number | null } | { ok: false; message: string }` exported from `PotHistorySheet.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `app/components/pots/__tests__/PotTrend.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PotTrend, trendPoints } from '../PotTrend';

describe('trendPoints', () => {
  it('is empty with fewer than two values', () => {
    expect(trendPoints([])).toBe('');
    expect(trendPoints([5])).toBe('');
  });

  it('scales values into the box, top for the highest', () => {
    expect(trendPoints([0, 10])).toBe('0.0,32.0 100.0,0.0');
  });

  it('draws a flat line along the bottom when all values are equal', () => {
    expect(trendPoints([5, 5, 5])).toBe('0.0,32.0 50.0,32.0 100.0,32.0');
  });

  it('handles negative values', () => {
    expect(trendPoints([-10, 0])).toBe('0.0,32.0 100.0,0.0');
  });
});

describe('PotTrend', () => {
  it('renders an image role with a polyline for two or more values', () => {
    const { container, getByRole } = render(<PotTrend values={[1, 2, 3]} />);
    expect(getByRole('img', { name: 'Balance trend' })).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('renders nothing for fewer than two values', () => {
    const { container } = render(<PotTrend values={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
```

Create `app/components/pots/__tests__/PotHistorySheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, PotSummary } from '~/lib/types';
import { currentYearMonth } from '~/lib/months';

const save = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('~/lib/queries', () => ({
  useSavePot: () => ({ mutate: save.mutate, isPending: false }),
}));
vi.mock('~/components/layout/ResponsiveSheet', () => ({
  ResponsiveSheet: ({ opened, title, children }: { opened: boolean; title: string; children: React.ReactNode }) =>
    (opened ? <div role="dialog" aria-label={title}>{children}</div> : null),
}));

import { PotHistorySheet, parseOptionalPounds } from '../PotHistorySheet';

const category: Category = {
  categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '',
};

function makePot(overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 7500,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 2500 },
    months: [
      { yearMonth: '2026-07', opening: 0, setAside: 8000, autoAdded: 2000, takeOut: 0, spent: 0, closing: 10000 },
      { yearMonth: '2026-08', opening: 10000, setAside: 0, autoAdded: 0, takeOut: 0, spent: 2500, closing: 7500 },
    ],
    ...overrides,
  };
}

function renderSheet(pot: PotSummary | null) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <PotHistorySheet pot={pot} category={category} onClose={onClose} />
    </MantineProvider>,
  );
  return onClose;
}

beforeEach(() => { save.mutate.mockReset(); });

describe('parseOptionalPounds', () => {
  it('treats blank as null', () => {
    expect(parseOptionalPounds('  ')).toEqual({ ok: true, pence: null });
  });

  it('parses pounds to pence', () => {
    expect(parseOptionalPounds('50.25')).toEqual({ ok: true, pence: 5025 });
  });

  it('rejects invalid and non-positive input', () => {
    expect(parseOptionalPounds('abc').ok).toBe(false);
    expect(parseOptionalPounds('0').ok).toBe(false);
    expect(parseOptionalPounds('-5').ok).toBe(false);
  });
});

describe('PotHistorySheet', () => {
  it('renders nothing when there is no pot', () => {
    renderSheet(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the balance and the months newest first', () => {
    renderSheet(makePot());
    const dialog = screen.getByRole('dialog', { name: '✈️ Holidays' });
    expect(within(dialog).getByText('Balance').nextElementSibling).toHaveTextContent('£75.00');
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('August 2026')).toBeInTheDocument();
    expect(within(rows[1]).getByText('July 2026')).toBeInTheDocument();
  });

  it('marks auto-added amounts in the set aside column', () => {
    renderSheet(makePot());
    expect(screen.getByText('£100.00 (£20.00 auto)')).toBeInTheDocument();
  });

  it('shows a message instead of the table when there is no history', () => {
    renderSheet(makePot({ months: [], balance: 0 }));
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('disables auto-contribute until a monthly amount is entered', async () => {
    const user = userEvent.setup();
    renderSheet(makePot());
    const toggle = screen.getByRole('switch', { name: 'Auto-contribute' });
    expect(toggle).toBeDisabled();
    await user.type(screen.getByLabelText('Monthly amount'), '50');
    expect(toggle).toBeEnabled();
  });

  it('saves the settings for the current month', async () => {
    const user = userEvent.setup();
    const onClose = renderSheet(makePot());
    await user.type(screen.getByLabelText('Monthly amount'), '50');
    await user.type(screen.getByLabelText('Goal'), '3000');
    await user.click(screen.getByRole('switch', { name: 'Auto-contribute' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(save.mutate).toHaveBeenCalledWith(
      {
        categoryId: 'cat-holidays',
        input: { monthlyAmount: 5000, goalAmount: 300000, autoContribute: true, month: currentYearMonth() },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    save.mutate.mock.calls[0][1].onSuccess();
    expect(onClose).toHaveBeenCalled();
  });

  it('starts from the pot\'s current settings', () => {
    renderSheet(makePot({ monthlyAmount: 5000, goalAmount: 300000, autoAmountNow: 5000 }));
    expect(screen.getByLabelText('Monthly amount')).toHaveValue('50.00');
    expect(screen.getByLabelText('Goal')).toHaveValue('3000.00');
    expect(screen.getByRole('switch', { name: 'Auto-contribute' })).toBeChecked();
  });

  it('turns auto-contribute off when the monthly amount is cleared', async () => {
    const user = userEvent.setup();
    renderSheet(makePot({ monthlyAmount: 5000, autoAmountNow: 5000 }));
    await user.clear(screen.getByLabelText('Monthly amount'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mutate.mock.calls[0][0].input).toMatchObject({ monthlyAmount: null, autoContribute: false });
  });

  it('shows an error and does not save for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet(makePot());
    await user.type(screen.getByLabelText('Monthly amount'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

`app/routes/__tests__/pots.test.tsx`: add a hoisted mock `vi.mock('~/components/pots/PotHistorySheet', ...)` rendering `<div>History: {pot?.categoryId}</div>` when `pot` is non-null, add `useSavePot: () => ({ mutate: vi.fn(), isPending: false })` to the `~/lib/queries` mock, and add:

```tsx
  it('opens the history sheet for the tapped pot', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Holidays history' }));
    expect(screen.getByText('History: cat-holidays')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run app/components/pots app/routes/__tests__/pots.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/components/pots/PotTrend.tsx`:

```tsx
const WIDTH = 100;
const HEIGHT = 32;

export function trendPoints(values: number[], width: number = WIDTH, height: number = HEIGHT): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function PotTrend({ values }: { values: number[] }) {
  const points = trendPoints(values);
  if (points === '') return null;
  return (
    <svg
      role="img"
      aria-label="Balance trend"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 48, display: 'block' }}
    >
      <polyline points={points} fill="none" stroke="var(--mantine-color-primary-6)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

Create `app/components/pots/PotHistorySheet.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, Group, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence, formatPencePlain, parsePounds } from '~/lib/money';
import { currentYearMonth, formatMonthLabel } from '~/lib/months';
import { useSavePot } from '~/lib/queries';
import type { Category, PotSummary } from '~/lib/types';
import { PotTrend } from './PotTrend';

export function parseOptionalPounds(
  text: string,
): { ok: true; pence: number | null } | { ok: false; message: string } {
  if (text.trim() === '') return { ok: true, pence: null };
  const parsed = parsePounds(text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.pence <= 0) return { ok: false, message: 'Enter an amount greater than zero' };
  return { ok: true, pence: parsed.pence };
}

function formatBalance(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence);
}

function setAsideCell(setAside: number, autoAdded: number): string {
  const total = formatPence(setAside + autoAdded);
  return autoAdded > 0 ? `${total} (${formatPence(autoAdded)} auto)` : total;
}

function PotSettingsForm({ pot, onClose }: { pot: PotSummary; onClose: () => void }) {
  const save = useSavePot();
  const [monthly, setMonthly] = useState(pot.monthlyAmount !== null ? formatPencePlain(pot.monthlyAmount) : '');
  const [goal, setGoal] = useState(pot.goalAmount !== null ? formatPencePlain(pot.goalAmount) : '');
  const [auto, setAuto] = useState(pot.autoAmountNow > 0);
  const [error, setError] = useState<string | null>(null);

  const parsedMonthly = parseOptionalPounds(monthly);
  const hasMonthly = parsedMonthly.ok && parsedMonthly.pence !== null;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const monthlyResult = parseOptionalPounds(monthly);
    const goalResult = parseOptionalPounds(goal);
    if (!monthlyResult.ok) { setError(monthlyResult.message); return; }
    if (!goalResult.ok) { setError(goalResult.message); return; }
    setError(null);
    save.mutate(
      {
        categoryId: pot.categoryId,
        input: {
          monthlyAmount: monthlyResult.pence,
          goalAmount: goalResult.pence,
          autoContribute: auto && monthlyResult.pence !== null,
          month: currentYearMonth(),
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <Text fw={600}>Settings</Text>
        <TextInput label="Monthly amount" placeholder="0.00" inputMode="decimal" value={monthly}
          onChange={e => setMonthly(e.currentTarget.value)} />
        <TextInput label="Goal" placeholder="0.00" inputMode="decimal" value={goal}
          onChange={e => setGoal(e.currentTarget.value)} />
        <Switch
          label="Auto-contribute"
          description={hasMonthly ? 'Adds the monthly amount every month, from this month.' : 'Set a monthly amount first.'}
          checked={auto && hasMonthly}
          disabled={!hasMonthly}
          onChange={e => setAuto(e.currentTarget.checked)}
        />
        {error && <Alert color="danger" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>Save</Button>
        </Group>
      </Stack>
    </form>
  );
}

export interface PotHistorySheetProps {
  pot: PotSummary | null;
  category: Category | undefined;
  onClose: () => void;
}

export function PotHistorySheet({ pot, category, onClose }: PotHistorySheetProps) {
  const title = category ? categoryLabel(category) : 'Pot';
  const months = pot ? [...pot.months].reverse() : [];

  return (
    <ResponsiveSheet opened={pot !== null} onClose={onClose} title={title}>
      {pot && (
        <Stack gap="md">
          <div>
            <Text size="xs" c="dimmed">Balance</Text>
            <Text fw={700} size="xl" c={pot.balance < 0 ? 'danger' : undefined}>{formatBalance(pot.balance)}</Text>
          </div>
          <PotTrend values={pot.months.map(m => m.closing)} />
          {months.length === 0 ? (
            <Text c="dimmed" size="sm">No activity yet.</Text>
          ) : (
            <Table.ScrollContainer minWidth={420}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Month</Table.Th>
                    <Table.Th>Opening</Table.Th>
                    <Table.Th>Set aside</Table.Th>
                    <Table.Th>Taken out</Table.Th>
                    <Table.Th>Spent</Table.Th>
                    <Table.Th>Closing</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {months.map(m => (
                    <Table.Tr key={m.yearMonth}>
                      <Table.Td>{formatMonthLabel(m.yearMonth)}</Table.Td>
                      <Table.Td>{formatBalance(m.opening)}</Table.Td>
                      <Table.Td>{setAsideCell(m.setAside, m.autoAdded)}</Table.Td>
                      <Table.Td>{formatPence(m.takeOut)}</Table.Td>
                      <Table.Td>{formatPence(m.spent)}</Table.Td>
                      <Table.Td>{formatBalance(m.closing)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <PotSettingsForm key={pot.categoryId} pot={pot} onClose={onClose} />
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
```

`app/routes/pots.tsx`: import `PotHistorySheet`; add `const [openId, setOpenId] = useState<string | null>(null);`; pass `onOpen={() => setOpenId(pot.categoryId)}` to `PotRow`; and render, after the `TransactionSheet`:

```tsx
      <PotHistorySheet
        pot={rows.find(row => row.pot.categoryId === openId)?.pot ?? null}
        category={rows.find(row => row.pot.categoryId === openId)?.category}
        onClose={() => setOpenId(null)}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean. If `getByRole('switch')` does not resolve in the installed Mantine version, query the Switch's underlying `input[type="checkbox"]` by label instead and keep the same assertions.

- [ ] **Step 5: Commit**

```bash
git add app/components/pots app/routes/pots.tsx app/routes/__tests__/pots.test.tsx
git commit -m "feat: add pot history sheet with trend and settings"
```

---

### Task 8: Home Pots section

**Files:**
- Create: `app/components/pots/HomePots.tsx`, `app/components/pots/__tests__/HomePots.test.tsx`
- Modify: `app/routes/_index.tsx`, `app/routes/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: `usePots`, `useCategories` (already used by Home), `goalPercent`, `categoryLabel`, `formatPence`, `PotSummary`.
- Produces: `HomePots({ pots, categories })`, rendering a "Pots" section for pots with a balance, goal or monthly amount, plus a "See all pots" link to `/pots`; renders nothing when no pot qualifies.

- [ ] **Step 1: Write the failing tests**

Create `app/components/pots/__tests__/HomePots.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { HomePots } from '../HomePots';
import type { Category, PotSummary } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'a', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '' },
  { categoryId: 'b', name: 'Gifts', type: 'POT', group: 'SINKING_FUNDS', icon: '🎁', isDefault: true, createdAt: '' },
  { categoryId: 'c', name: 'Insurance', type: 'POT', group: 'SINKING_FUNDS', icon: '📄', isDefault: true, createdAt: '' },
];

function pot(categoryId: string, overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId, monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function renderPots(pots: PotSummary[]) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <HomePots pots={pots} categories={categories} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('HomePots', () => {
  it('lists pots that have a balance, a goal or a monthly amount', () => {
    renderPots([
      pot('a', { balance: 25000 }),
      pot('b', { goalAmount: 10000 }),
      pot('c'),
    ]);
    expect(screen.getByText('✈️ Holidays')).toBeInTheDocument();
    expect(screen.getByText('🎁 Gifts')).toBeInTheDocument();
    expect(screen.queryByText('📄 Insurance')).not.toBeInTheDocument();
  });

  it('shows the balance and goal progress', () => {
    renderPots([pot('a', { balance: 80000, goalAmount: 300000 })]);
    expect(screen.getByText('£800.00')).toBeInTheDocument();
    expect(screen.getByText('£800.00 of £3,000.00')).toBeInTheDocument();
  });

  it('shows a negative balance with a minus sign', () => {
    renderPots([pot('a', { balance: -2500 })]);
    expect(screen.getByText('−£25.00')).toBeInTheDocument();
  });

  it('links to the Pots page', () => {
    renderPots([pot('a', { balance: 100 })]);
    expect(screen.getByRole('link', { name: 'See all pots' })).toHaveAttribute('href', '/pots');
  });

  it('renders nothing when no pot qualifies', () => {
    renderPots([pot('c')]);
    expect(screen.queryByText('Pots')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See all pots' })).not.toBeInTheDocument();
  });
});
```

`app/routes/__tests__/index.test.tsx`: add `pots: [] as unknown[]` to the hoisted `data` object, `usePots: () => ({ data: data.pots, isLoading: false, error: null }),` to the `~/lib/queries` mock, reset `data.pots = []` in the existing `beforeEach`, and add:

```tsx
  it('shows a Pots section with balances and a link to the Pots page', () => {
    data.categories = [
      { categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '' },
    ];
    data.pots = [{
      categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 12000,
      thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [],
    }];
    renderHome();
    expect(screen.getByRole('heading', { name: 'Pots' })).toBeInTheDocument();
    expect(screen.getByText('£120.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all pots' })).toHaveAttribute('href', '/pots');
  });

  it('does not show a Pots section when there are no pots', () => {
    renderHome();
    expect(screen.queryByRole('heading', { name: 'Pots' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run app/components/pots/__tests__/HomePots.test.tsx app/routes/__tests__/index.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/components/pots/HomePots.tsx`:

```tsx
import { Link } from 'react-router';
import { Anchor, Group, Progress, Stack, Text, Title } from '@mantine/core';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence } from '~/lib/money';
import { goalPercent } from '~/lib/pots';
import type { Category, PotSummary } from '~/lib/types';

function formatBalance(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence);
}

function isShown(pot: PotSummary): boolean {
  return pot.balance !== 0 || pot.goalAmount !== null || pot.monthlyAmount !== null;
}

export function HomePots({ pots, categories }: { pots: PotSummary[]; categories: Category[] }) {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const rows = pots
    .filter(isShown)
    .map(pot => ({ pot, category: categoryById.get(pot.categoryId) }))
    .filter((row): row is { pot: PotSummary; category: Category } => row.category !== undefined);
  if (rows.length === 0) return null;

  return (
    <div>
      <Title order={5} mb="xs">Pots</Title>
      {rows.map(({ pot, category }) => {
        const percent = goalPercent(pot.balance, pot.goalAmount);
        return (
          <Stack key={pot.categoryId} gap={4} mb="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={500}>{categoryLabel(category)}</Text>
              <Text fw={600} c={pot.balance < 0 ? 'danger' : undefined}>{formatBalance(pot.balance)}</Text>
            </Group>
            {pot.goalAmount !== null && (
              <>
                <Progress value={percent ?? 0} aria-label={`${category.name} goal progress`} />
                <Text size="xs" c="dimmed">{formatPence(Math.max(0, pot.balance))} of {formatPence(pot.goalAmount)}</Text>
              </>
            )}
          </Stack>
        );
      })}
      <Anchor component={Link} to="/pots" size="sm">See all pots</Anchor>
    </div>
  );
}
```

`app/routes/_index.tsx`: import `HomePots` from `~/components/pots/HomePots` and `usePots` from `~/lib/queries`; inside `HomeContent` add `const pots = usePots(yearMonth);`; render, after the "Spending vs target" block and before the income row:

```tsx
      {pots.error ? (
        <Text size="sm" c="dimmed">Could not load pots.</Text>
      ) : (
        <HomePots pots={pots.data ?? []} categories={categories.data ?? []} />
      )}
```

Pots must not gate Home's loading/error state (do not add `pots` to `isLoading` or `error`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/pots/HomePots.tsx app/components/pots/__tests__/HomePots.test.tsx app/routes/_index.tsx app/routes/__tests__/index.test.tsx
git commit -m "feat: show a Pots section on Home"
```

---

### Task 9: Roadmap

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Update the roadmap**

In `docs/ROADMAP.md`:
- Change the F2 table row to `| F2 | Savings and sinking-fund pots | Implemented on `feat/savings-pots` (PR pending). Spec: `superpowers/specs/2026-09-25-savings-pots-design.md`, plan: `superpowers/plans/2026-09-25-savings-pots.md` |`.
- After the F1 section, add `## F2: Savings and sinking-fund pots` with the same Built / Decisions / Follow-ups structure:
  - **Built:** pot categories (Sinking Funds and Saving & Investment) with a carried-over balance; Spend, Set aside and Take out entry types replacing Invest in/out; optional monthly and goal amounts per pot; derived auto-contribute; `GET /api/pots` and `PUT /api/pots/{categoryId}`; a Pots page with a history sheet and trend line; a Pots section on Home. No infra, IAM or dependency changes.
  - **Decisions:** pots are a category type (`POT`) and the old investment types are removed with no migration; the balance is derived on demand from the full history, so nothing stored can drift; auto-contribute is a list of `{ from, amount }` entries, not scheduled writes; entries dated after the month being viewed are excluded; negative balances are allowed and flagged; a custom pot with no group defaults to Sinking Funds; Home's Pots section follows its month selector.
  - **Follow-ups:** a quick-add syntax for Set aside; a stored monthly summary if `GET /api/pots` gets slow; the transaction API checking category type against entry type; pots spanning several categories; deleting a custom category leaves its pot settings orphaned; net worth and account balances (I).
- Leave the other sections unchanged.

- [ ] **Step 2: Verify**

Run: `yarn test && yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: record savings pots in the roadmap"
```

## Verification after all tasks (controller, not a task)

- `yarn test`, `yarn typecheck`.
- Real-browser pass with the stubbed headless harness at 390px and 1280px: the five-tab bottom bar, Pots page, history sheet with trend line and settings, Home Pots section, entry sheet types (Spend, Income, Set aside, Take out) and their category offers, a negative-balance pot, the Categories form's Pot type.
- SECURITY.md pre-PR checklist (IO-01 for the new inputs, AUTH-01 on the new routes, API-02 generic errors).
