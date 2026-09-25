# Category Groups and YNAB Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give categories an optional group, replace the default categories with the owner's YNAB set, and show groups in the picker, Categories page, Targets page and Home.

**Architecture:** `Category` gains `group?: CategoryGroup`. The API validates it on create and ships new grouped defaults. The client gets a pure grouping helper (`app/lib/categoryGroups.ts`), emoji-aware label and icon helpers, and grouped rendering in five places. No infra, IAM, dependency or data-migration changes (the owner has deleted the test data).

**Tech Stack:** React 19, React Router 8, Mantine 8.3.12, TanStack Query 5, Vitest 4 + Testing Library, AWS Lambda + DynamoDB, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-09-24-category-groups-design.md`

## Global Constraints

- No infra, IAM or dependency changes.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event inside a functional `setState` updater.
- Security controls in `SECURITY.md` apply (IO-01 for `group` validation); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging (`git add <files>`), and end every commit message with these two trailer lines:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY`
- Update `docs/ROADMAP.md` (E dropped; F to J added).
- Groups are the fixed set `BILLS`, `SINKING_FUNDS`, `EVERYDAY`, `SAVING_INVESTMENT`, in that display order. Income categories have no group.
- 27 default categories: 23 grouped (5 Bills, 6 Sinking Funds, 8 Everyday, 4 Saving & Investment) plus the 4 unchanged income defaults. Saving & Investment defaults are `INVESTMENT` type; every other grouped default is `EXPENSE`. No Joint Account default.

## Plan rulings (amend the spec)

- **Icon rendering.** The spec stores emoji in `icon`, but `icon` is a Tabler icon key rendered by `getCategoryIcon` in `TransactionRow`, `DueRecurringCard` and `app/routes/recurring.tsx`. Left alone, emoji would fall back to the generic icon there. Ruling: a new `CategoryIcon` component renders emoji as text and everything else through `getCategoryIcon`; those three call sites use it (Task 3). Consequence if wrong: only cosmetic.
- **Default group by type.** The spec says custom categories default to Everyday Spending. Ruling: an `INVESTMENT`-type custom category defaults to `SAVING_INVESTMENT` (in both API and UI), other non-income types default to `EVERYDAY`. Income stays ungrouped.
- **Unknown group values.** A stored `group` outside the fixed set is treated as ungrouped ("Other") so no category can disappear from the UI.

## Review Focus

1. A stored category whose `group` is missing, or not one of the four values, must still appear (under "Other"), never vanish from lists.
2. `group` sent as `null`, `''`, a number or an unknown string on create returns 400; `group` on an INCOME category returns 400.
3. Emoji with variation selectors or ZWJ sequences (`🗓️`, `🧑‍🌾`, `✈️`) are detected as emoji; Tabler keys like `home`, `tag` and unknown strings are not.
4. The "More…" dropdown with only one bucket (for example Income) renders a flat list, not a single group heading.
5. Changing the Type on the New category form keeps the Group sensible (Investment selects Saving & Investment; Income disables and omits it).

---

### Task 1: API types, validation and new defaults

**Files:**
- Modify: `src/api/types.ts`, `src/api/constants.ts`, `src/api/defaults.ts`, `src/api/categories.ts`
- Create: `src/api/__tests__/defaults.test.ts`
- Modify (tests): `src/api/__tests__/categories.test.ts`, `src/api/__tests__/reassign.test.ts`

**Interfaces:**
- Produces: `CategoryGroup` type and `Category.group?: CategoryGroup` in `src/api/types.ts`; `VALID_CATEGORY_GROUPS: Set<string>` in `src/api/constants.ts`; `DEFAULT_CATEGORIES` (27 items) and `DEFAULT_CATEGORY_IDS` from `src/api/defaults.ts`; `createCategory` accepting `group`.

- [ ] **Step 1: Write the failing defaults test**

Create `src/api/__tests__/defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_IDS } from '../defaults';

const namesIn = (group: string): string[] =>
  DEFAULT_CATEGORIES.filter(c => c.group === group).map(c => c.name);

describe('DEFAULT_CATEGORIES', () => {
  it('has 27 categories with unique ids', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(27);
    expect(DEFAULT_CATEGORY_IDS.size).toBe(27);
  });

  it('lists Bills in order', () => {
    expect(namesIn('BILLS')).toEqual(['Council Tax', 'Mortgage', 'Phone and Internet', 'Subscriptions', 'Utilities']);
  });

  it('lists Sinking Funds in order', () => {
    expect(namesIn('SINKING_FUNDS')).toEqual(['Car maintenance', 'Certifications', 'Holidays', 'Home maintenance', 'Gifts', 'Insurance']);
  });

  it('lists Everyday Spending in order', () => {
    expect(namesIn('EVERYDAY')).toEqual([
      'Charity', 'Conference', 'Going Out & Entertainment', 'Groceries', 'Health', 'Pets', 'Personal Spending', 'Transport',
    ]);
  });

  it('lists Saving & Investment in order', () => {
    expect(namesIn('SAVING_INVESTMENT')).toEqual(['Emergency fund', 'Garden Project', 'Investment', 'Windows']);
  });

  it('makes Saving & Investment categories INVESTMENT type and every other grouped one EXPENSE', () => {
    for (const c of DEFAULT_CATEGORIES.filter(c => c.group)) {
      expect(c.type).toBe(c.group === 'SAVING_INVESTMENT' ? 'INVESTMENT' : 'EXPENSE');
    }
  });

  it('keeps the four income defaults ungrouped and unchanged', () => {
    const income = DEFAULT_CATEGORIES.filter(c => c.type === 'INCOME');
    expect(income.map(c => c.categoryId)).toEqual(['cat-salary', 'cat-freelance', 'cat-rental', 'cat-other-income']);
    expect(income.every(c => c.group === undefined)).toBe(true);
  });

  it('marks every category as a default', () => {
    expect(DEFAULT_CATEGORIES.every(c => c.isDefault)).toBe(true);
  });

  it('does not include Joint Account or the removed investment defaults', () => {
    const names = DEFAULT_CATEGORIES.map(c => c.name);
    for (const removed of ['Joint Account', 'Stocks', 'Crypto', 'Real Estate', 'Other Investments']) {
      expect(names).not.toContain(removed);
    }
  });
});
```

- [ ] **Step 2: Add group tests to `categories.test.ts` and fix stale ids**

Run `sed -i '' 's/cat-housing/cat-mortgage/g' src/api/__tests__/categories.test.ts` and `sed -i '' 's/cat-entertainment/cat-going-out/g' src/api/__tests__/reassign.test.ts`.

In `src/api/__tests__/categories.test.ts`, inside `describe('createCategory')`, replace the final test

```ts
  it('returns 400 for name over 50 chars', async () => {
    const res = await createCategory(
      makeEvent({ name: 'a'.repeat(51), type: 'EXPENSE' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});
```

with

```ts
  it('returns 400 for name over 50 chars', async () => {
    const res = await createCategory(
      makeEvent({ name: 'a'.repeat(51), type: 'EXPENSE' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  it('stores a valid group', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Joint Account', type: 'EXPENSE', group: 'BILLS' }), 'user-1', {});
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).category.group).toBe('BILLS');
    expect(mockSend.mock.calls[0][0].Item.group).toBe('BILLS');
  });

  it('defaults an EXPENSE category to EVERYDAY', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Padel', type: 'EXPENSE' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBe('EVERYDAY');
  });

  it('defaults an INVESTMENT category to SAVING_INVESTMENT', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'ISA', type: 'INVESTMENT' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBe('SAVING_INVESTMENT');
  });

  it.each([null, '', 5, 'NOPE', 'bills'])('returns 400 for invalid group %j', async (group) => {
    const res = await createCategory(makeEvent({ name: 'X', type: 'EXPENSE', group }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when a group is sent for an INCOME category', async () => {
    const res = await createCategory(makeEvent({ name: 'Bonus', type: 'INCOME', group: 'BILLS' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('stores no group for an INCOME category', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(makeEvent({ name: 'Bonus', type: 'INCOME' }), 'user-1', {});
    expect(JSON.parse(res.body).category.group).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run src/api`
Expected: FAIL. The defaults tests fail on length and group, the new create tests fail on `group`, and the `cat-mortgage` / `cat-going-out` cases fail because those ids do not exist yet.

- [ ] **Step 4: Implement types, constants, defaults, validation**

`src/api/types.ts`: after `CategoryType` add

```ts
export type CategoryGroup = 'BILLS' | 'SINKING_FUNDS' | 'EVERYDAY' | 'SAVING_INVESTMENT';
```

and add `group?: CategoryGroup;` to `Category` after `icon: string;`.

`src/api/constants.ts`: after `VALID_CATEGORY_TYPES` add

```ts
export const VALID_CATEGORY_GROUPS = new Set(['BILLS', 'SINKING_FUNDS', 'EVERYDAY', 'SAVING_INVESTMENT']);
```

Replace the whole of `src/api/defaults.ts` with:

```ts
import type { Category, CategoryGroup, CategoryType } from './types';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function def(categoryId: string, name: string, type: CategoryType, icon: string, group?: CategoryGroup): Category {
  const category: Category = { categoryId, name, type, icon, isDefault: true, createdAt: CREATED_AT };
  if (group) category.group = group;
  return category;
}

export const DEFAULT_CATEGORIES: Category[] = [
  // BILLS
  def('cat-council-tax', 'Council Tax', 'EXPENSE', 'tag', 'BILLS'),
  def('cat-mortgage', 'Mortgage', 'EXPENSE', '🏠', 'BILLS'),
  def('cat-phone-internet', 'Phone and Internet', 'EXPENSE', '🛜', 'BILLS'),
  def('cat-subscriptions', 'Subscriptions', 'EXPENSE', '🗓️', 'BILLS'),
  def('cat-utilities', 'Utilities', 'EXPENSE', '⚡', 'BILLS'),
  // SINKING FUNDS
  def('cat-car-maintenance', 'Car maintenance', 'EXPENSE', '🚗', 'SINKING_FUNDS'),
  def('cat-certifications', 'Certifications', 'EXPENSE', '🏆', 'SINKING_FUNDS'),
  def('cat-holidays', 'Holidays', 'EXPENSE', '✈️', 'SINKING_FUNDS'),
  def('cat-home-maintenance', 'Home maintenance', 'EXPENSE', '🛠️', 'SINKING_FUNDS'),
  def('cat-gifts', 'Gifts', 'EXPENSE', '🎁', 'SINKING_FUNDS'),
  def('cat-insurance', 'Insurance', 'EXPENSE', '📄', 'SINKING_FUNDS'),
  // EVERYDAY SPENDING
  def('cat-charity', 'Charity', 'EXPENSE', '💖', 'EVERYDAY'),
  def('cat-conference', 'Conference', 'EXPENSE', '👨‍💼', 'EVERYDAY'),
  def('cat-going-out', 'Going Out & Entertainment', 'EXPENSE', '🎡', 'EVERYDAY'),
  def('cat-groceries', 'Groceries', 'EXPENSE', '🛒', 'EVERYDAY'),
  def('cat-health', 'Health', 'EXPENSE', '🏥', 'EVERYDAY'),
  def('cat-pets', 'Pets', 'EXPENSE', '🐾', 'EVERYDAY'),
  def('cat-personal-spending', 'Personal Spending', 'EXPENSE', '🛍️', 'EVERYDAY'),
  def('cat-transport', 'Transport', 'EXPENSE', '🛞', 'EVERYDAY'),
  // SAVING & INVESTMENT (INVESTMENT type until pots replace it)
  def('cat-emergency-fund', 'Emergency fund', 'INVESTMENT', '😌', 'SAVING_INVESTMENT'),
  def('cat-garden-project', 'Garden Project', 'INVESTMENT', '🧑‍🌾', 'SAVING_INVESTMENT'),
  def('cat-investment', 'Investment', 'INVESTMENT', 'tag', 'SAVING_INVESTMENT'),
  def('cat-windows', 'Windows', 'INVESTMENT', '🪟', 'SAVING_INVESTMENT'),
  // INCOME (ungrouped)
  def('cat-salary', 'Salary', 'INCOME', 'briefcase'),
  def('cat-freelance', 'Freelance/Contract', 'INCOME', 'code'),
  def('cat-rental', 'Rental Income', 'INCOME', 'building'),
  def('cat-other-income', 'Other Income', 'INCOME', 'cash'),
];

export const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.categoryId));
```

In `src/api/categories.ts`: change the import lines to

```ts
import { SECURITY_HEADERS, VALID_CATEGORY_TYPES, VALID_CATEGORY_GROUPS } from './constants';
import type { Category, CategoryGroup, CategoryType, ApiResponse } from './types';
```

add above `createCategory`:

```ts
function defaultGroupFor(type: CategoryType): CategoryGroup | undefined {
  if (type === 'INCOME') return undefined;
  if (type === 'INVESTMENT') return 'SAVING_INVESTMENT';
  return 'EVERYDAY';
}
```

change `const { name, type, icon } = body;` to `const { name, type, icon, group } = body;`, and after the `type` validation block add:

```ts
  if (group !== undefined) {
    if (type === 'INCOME') {
      return err(400, 'group is not allowed for INCOME categories');
    }
    if (typeof group !== 'string' || !VALID_CATEGORY_GROUPS.has(group)) {
      return err(400, 'group must be BILLS, SINKING_FUNDS, EVERYDAY, or SAVING_INVESTMENT');
    }
  }
```

Then build the category with the group:

```ts
  const resolvedGroup = (group as CategoryGroup | undefined) ?? defaultGroupFor(type as CategoryType);
  const categoryId = crypto.randomUUID();
  const category: Category = {
    categoryId,
    name: name.trim(),
    type: type as Category['type'],
    icon: typeof icon === 'string' ? icon.slice(0, 50) : 'default',
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
  if (resolvedGroup) category.group = resolvedGroup;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run src/api` then `yarn typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/api/types.ts src/api/constants.ts src/api/defaults.ts src/api/categories.ts src/api/__tests__/defaults.test.ts src/api/__tests__/categories.test.ts src/api/__tests__/reassign.test.ts
git commit -m "feat: add category groups and YNAB default categories"
```

(Append the two trailer lines from Global Constraints.)

---

### Task 2: Client types and grouping/label helpers

**Files:**
- Modify: `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`, `app/lib/categoryIcons.ts`
- Create: `app/lib/categoryGroups.ts`, `app/lib/__tests__/categoryGroups.test.ts`
- Modify (tests): `app/lib/__tests__/categoryIcons.test.ts`

**Interfaces:**
- Produces (`app/lib/types.ts`): `CategoryGroup`, `Category.group?: CategoryGroup`.
- Produces (`app/lib/categoryGroups.ts`): `BucketKey`, `Bucket<T>`, `BUCKET_LABELS: Record<BucketKey, string>`, `GROUP_OPTIONS: { value: CategoryGroup; label: string }[]`, `groupItems<T>(items: T[], keyOf: (item: T) => BucketKey): Bucket<T>[]`, `bucketKeyFor(category: { group?: string; type: CategoryType }): BucketKey`, `groupCategories(categories: Category[]): Bucket<Category>[]`, `defaultGroupFor(type: CategoryType): CategoryGroup | null`.
- Produces (`app/lib/categoryIcons.ts`): `isEmojiIcon(icon: string): boolean`, `categoryLabel(category: { icon: string; name: string }): string`.
- `api.createCategory` and `useCreateCategory` accept `group?: CategoryGroup`.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/categoryGroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bucketKeyFor, defaultGroupFor, groupCategories, groupItems } from '../categoryGroups';
import type { Category } from '../types';

function cat(categoryId: string, type: Category['type'], group?: string): Category {
  return { categoryId, name: categoryId, type, icon: 'tag', isDefault: false, createdAt: '', group } as Category;
}

describe('groupCategories', () => {
  it('orders buckets Bills, Sinking Funds, Everyday, Saving, Income, Other', () => {
    const buckets = groupCategories([
      cat('inc', 'INCOME'),
      cat('other', 'EXPENSE'),
      cat('save', 'INVESTMENT', 'SAVING_INVESTMENT'),
      cat('day', 'EXPENSE', 'EVERYDAY'),
      cat('sink', 'EXPENSE', 'SINKING_FUNDS'),
      cat('bill', 'EXPENSE', 'BILLS'),
    ]);
    expect(buckets.map(b => b.label)).toEqual([
      'Bills', 'Sinking Funds', 'Everyday Spending', 'Saving & Investment', 'Income', 'Other',
    ]);
  });

  it('omits empty buckets', () => {
    const buckets = groupCategories([cat('bill', 'EXPENSE', 'BILLS')]);
    expect(buckets.map(b => b.key)).toEqual(['BILLS']);
  });

  it('keeps the input order inside a bucket', () => {
    const buckets = groupCategories([cat('b', 'EXPENSE', 'BILLS'), cat('a', 'EXPENSE', 'BILLS')]);
    expect(buckets[0].items.map(c => c.categoryId)).toEqual(['b', 'a']);
  });

  it('puts a category with no group under Other', () => {
    expect(groupCategories([cat('x', 'EXPENSE')])[0].key).toBe('OTHER');
  });

  it('puts a category with an unknown group under Other instead of dropping it', () => {
    const buckets = groupCategories([cat('x', 'EXPENSE', 'MYSTERY')]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe('OTHER');
  });
});

describe('bucketKeyFor', () => {
  it('ignores any group on an INCOME category', () => {
    expect(bucketKeyFor({ type: 'INCOME', group: 'BILLS' })).toBe('INCOME');
  });
});

describe('groupItems', () => {
  it('buckets arbitrary items by a key function', () => {
    const buckets = groupItems([{ n: 1, g: 'EVERYDAY' as const }, { n: 2, g: 'BILLS' as const }], i => i.g);
    expect(buckets.map(b => b.key)).toEqual(['BILLS', 'EVERYDAY']);
  });
});

describe('defaultGroupFor', () => {
  it('returns null for income, Saving & Investment for investment and Everyday otherwise', () => {
    expect(defaultGroupFor('INCOME')).toBeNull();
    expect(defaultGroupFor('INVESTMENT')).toBe('SAVING_INVESTMENT');
    expect(defaultGroupFor('EXPENSE')).toBe('EVERYDAY');
  });
});
```

Append to `app/lib/__tests__/categoryIcons.test.ts` (extend the import to `import { getCategoryIcon, isEmojiIcon, categoryLabel } from '../categoryIcons';`):

```ts
describe('isEmojiIcon', () => {
  it.each(['🏠', '🗓️', '🧑‍🌾', '✈️', '⚡', '🪟'])('detects %s as an emoji', (icon) => {
    expect(isEmojiIcon(icon)).toBe(true);
  });

  it.each(['home', 'tag', '', 'not-a-real-icon'])('does not treat %j as an emoji', (icon) => {
    expect(isEmojiIcon(icon)).toBe(false);
  });
});

describe('categoryLabel', () => {
  it('puts the emoji before the name', () => {
    expect(categoryLabel({ icon: '🛒', name: 'Groceries' })).toBe('🛒 Groceries');
  });

  it('is just the name for a Tabler key', () => {
    expect(categoryLabel({ icon: 'tag', name: 'Padel' })).toBe('Padel');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/categoryGroups.test.ts app/lib/__tests__/categoryIcons.test.ts`
Expected: FAIL (modules and exports missing).

- [ ] **Step 3: Implement**

`app/lib/types.ts`: after `CategoryType` add `export type CategoryGroup = 'BILLS' | 'SINKING_FUNDS' | 'EVERYDAY' | 'SAVING_INVESTMENT';` and add `group?: CategoryGroup;` to `Category` after `icon: string;`.

Create `app/lib/categoryGroups.ts`:

```ts
import type { Category, CategoryGroup, CategoryType } from './types';

export type BucketKey = CategoryGroup | 'INCOME' | 'OTHER';

export interface Bucket<T> {
  key: BucketKey;
  label: string;
  items: T[];
}

export const BUCKET_LABELS: Record<BucketKey, string> = {
  BILLS: 'Bills',
  SINKING_FUNDS: 'Sinking Funds',
  EVERYDAY: 'Everyday Spending',
  SAVING_INVESTMENT: 'Saving & Investment',
  INCOME: 'Income',
  OTHER: 'Other',
};

const BUCKET_ORDER: BucketKey[] = ['BILLS', 'SINKING_FUNDS', 'EVERYDAY', 'SAVING_INVESTMENT', 'INCOME', 'OTHER'];

export const GROUP_OPTIONS: { value: CategoryGroup; label: string }[] = [
  { value: 'BILLS', label: BUCKET_LABELS.BILLS },
  { value: 'SINKING_FUNDS', label: BUCKET_LABELS.SINKING_FUNDS },
  { value: 'EVERYDAY', label: BUCKET_LABELS.EVERYDAY },
  { value: 'SAVING_INVESTMENT', label: BUCKET_LABELS.SAVING_INVESTMENT },
];

const GROUPS = new Set<string>(GROUP_OPTIONS.map(option => option.value));

export function groupItems<T>(items: T[], keyOf: (item: T) => BucketKey): Bucket<T>[] {
  return BUCKET_ORDER
    .map(key => ({ key, label: BUCKET_LABELS[key], items: items.filter(item => keyOf(item) === key) }))
    .filter(bucket => bucket.items.length > 0);
}

export function bucketKeyFor(category: { group?: string; type: CategoryType }): BucketKey {
  if (category.type === 'INCOME') return 'INCOME';
  if (category.group && GROUPS.has(category.group)) return category.group as CategoryGroup;
  return 'OTHER';
}

export function groupCategories(categories: Category[]): Bucket<Category>[] {
  return groupItems(categories, bucketKeyFor);
}

export function defaultGroupFor(type: CategoryType): CategoryGroup | null {
  if (type === 'INCOME') return null;
  if (type === 'INVESTMENT') return 'SAVING_INVESTMENT';
  return 'EVERYDAY';
}
```

`app/lib/categoryIcons.ts`: add `import type { Category } from './types';` and append:

```ts
const EMOJI = /\p{Extended_Pictographic}/u;

export function isEmojiIcon(icon: string): boolean {
  return EMOJI.test(icon);
}

export function categoryLabel(category: Pick<Category, 'icon' | 'name'>): string {
  return isEmojiIcon(category.icon) ? `${category.icon} ${category.name}` : category.name;
}
```

`app/lib/api.ts`: change the `createCategory` input type to `{ name: string; type: Category['type']; icon: string; group?: CategoryGroup }` and import `CategoryGroup` from the types import already used there. `app/lib/queries.ts`: same change to `useCreateCategory`'s `mutationFn` input, importing `CategoryGroup`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app/lib` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/lib/types.ts app/lib/api.ts app/lib/queries.ts app/lib/categoryIcons.ts app/lib/categoryGroups.ts app/lib/__tests__/categoryGroups.test.ts app/lib/__tests__/categoryIcons.test.ts
git commit -m "feat: add category grouping and emoji label helpers"
```

---

### Task 3: Render emoji icons where category icons are shown

**Files:**
- Create: `app/components/categories/CategoryIcon.tsx`, `app/components/categories/__tests__/CategoryIcon.test.tsx`
- Modify: `app/components/transactions/TransactionRow.tsx`, `app/components/recurring/DueRecurringCard.tsx`, `app/routes/recurring.tsx`

**Interfaces:**
- Consumes: `isEmojiIcon`, `getCategoryIcon` from `~/lib/categoryIcons`.
- Produces: `CategoryIcon({ icon: string; size?: number })`.

- [ ] **Step 1: Write the failing test**

Create `app/components/categories/__tests__/CategoryIcon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CategoryIcon } from '../CategoryIcon';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import type { Transaction } from '~/lib/types';

const txn: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 1250, type: 'EXPENSE', categoryId: 'cat-groceries',
  description: 'Tesco', date: '2026-09-24', createdAt: '',
};

describe('CategoryIcon', () => {
  it('renders an emoji icon as text, hidden from assistive tech', () => {
    render(<CategoryIcon icon="🛒" />);
    const emoji = screen.getByText('🛒');
    expect(emoji).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a Tabler key as an svg', () => {
    const { container } = render(<CategoryIcon icon="home" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to an svg for an unknown key', () => {
    const { container } = render(<CategoryIcon icon="nope" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('TransactionRow category icon', () => {
  it('shows the category emoji', () => {
    render(
      <MantineProvider>
        <TransactionRow transaction={txn} categoryName="Groceries" categoryIcon="🛒" />
      </MantineProvider>,
    );
    expect(screen.getByText('🛒')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run app/components/categories`
Expected: FAIL (`CategoryIcon` does not exist).

- [ ] **Step 3: Implement and swap the three call sites**

Create `app/components/categories/CategoryIcon.tsx`:

```tsx
import { getCategoryIcon, isEmojiIcon } from '~/lib/categoryIcons';

export function CategoryIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  if (isEmojiIcon(icon)) {
    return <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>;
  }
  const Icon = getCategoryIcon(icon);
  return <Icon size={size} stroke={1.6} />;
}
```

`TransactionRow.tsx`: replace `import { getCategoryIcon } from '~/lib/categoryIcons';` with `import { CategoryIcon } from '~/components/categories/CategoryIcon';`, delete the line `const Icon = getCategoryIcon(categoryIcon);`, and replace `<Icon size={18} stroke={1.6} />` with `<CategoryIcon icon={categoryIcon} />`.

`DueRecurringCard.tsx`: replace the `getCategoryIcon` import with the `CategoryIcon` import, replace
`const Icon = getCategoryIcon(categories.find(c => c.categoryId === item.recurring.categoryId)?.icon ?? 'tag');`
with
`const iconName = categories.find(c => c.categoryId === item.recurring.categoryId)?.icon ?? 'tag';`
and replace `<Icon size={18} stroke={1.6} />` with `<CategoryIcon icon={iconName} />`.

`app/routes/recurring.tsx`: replace the `getCategoryIcon` import with the `CategoryIcon` import, delete `const Icon = getCategoryIcon(category?.icon ?? 'tag');`, and replace `<Icon size={18} stroke={1.6} />` with `<CategoryIcon icon={category?.icon ?? 'tag'} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app` then `yarn typecheck`
Expected: PASS (existing TransactionRow, DueRecurringCard and recurring route tests still pass), clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/categories/CategoryIcon.tsx app/components/categories/__tests__/CategoryIcon.test.tsx app/components/transactions/TransactionRow.tsx app/components/recurring/DueRecurringCard.tsx app/routes/recurring.tsx
git commit -m "feat: render emoji category icons"
```

---

### Task 4: Grouped category picker and Categories page

**Files:**
- Modify: `app/components/transactions/CategoryChips.tsx`, `app/components/transactions/__tests__/CategoryChips.test.tsx`, `app/routes/categories.tsx`
- Create: `app/routes/__tests__/categories.test.tsx`

**Interfaces:**
- Consumes: `groupCategories`, `GROUP_OPTIONS`, `defaultGroupFor` (`~/lib/categoryGroups`), `categoryLabel` (`~/lib/categoryIcons`), `useCreateCategory` accepting `group`.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/transactions/__tests__/CategoryChips.test.tsx`, inside `describe('CategoryChips')` before its closing `});`:

```tsx
  it('groups the All categories list under group headings', async () => {
    const user = userEvent.setup();
    const bill = { ...cat('cat-mortgage', 'Mortgage'), group: 'BILLS' as const };
    const day = { ...cat('cat-groceries', 'Groceries'), group: 'EVERYDAY' as const };
    renderChips({ chips: [bill], all: [bill, day] });

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));

    expect(await screen.findByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
  });

  it('shows a flat list without headings when every category is in one bucket', async () => {
    const user = userEvent.setup();
    const salary = { ...cat('cat-salary', 'Salary'), type: 'INCOME' as const };
    const bonus = { ...cat('cat-bonus', 'Bonus'), type: 'INCOME' as const };
    renderChips({ chips: [salary], all: [salary, bonus] });

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));

    expect(await screen.findByRole('option', { name: 'Bonus', hidden: true })).toBeInTheDocument();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
  });

  it('prefixes a chip with the category emoji', () => {
    const groceries = { ...cat('cat-groceries', 'Groceries'), icon: '🛒' };
    renderChips({ chips: [groceries], all: [groceries] });
    expect(screen.getByRole('radio', { name: '🛒 Groceries' })).toBeInTheDocument();
  });
```

Create `app/routes/__tests__/categories.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category } from '~/lib/types';

const state = vi.hoisted(() => ({ categories: [] as unknown[], create: vi.fn() }));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateCategory: () => ({ mutate: state.create, isPending: false }),
  useDeleteCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReassignCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import Categories from '../categories';

function cat(categoryId: string, name: string, type: Category['type'], group?: Category['group'], icon = 'tag'): Category {
  return { categoryId, name, type, group, icon, isDefault: true, createdAt: '' };
}

function renderPage() {
  return render(<MantineProvider><Categories /></MantineProvider>);
}

beforeEach(() => {
  state.create.mockReset();
  state.categories = [
    cat('cat-groceries', 'Groceries', 'EXPENSE', 'EVERYDAY', '🛒'),
    cat('cat-mortgage', 'Mortgage', 'EXPENSE', 'BILLS', '🏠'),
    cat('cat-salary', 'Salary', 'INCOME'),
    { ...cat('custom-1', 'Padel', 'EXPENSE'), isDefault: false },
  ];
});

describe('Categories page', () => {
  it('lists sections by group with Income and Other last', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(headings).toEqual(['Bills', 'Everyday Spending', 'Income', 'Other']);
  });

  it('shows the emoji before the category name', () => {
    renderPage();
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
  });

  it('creates a category in the default Everyday Spending group', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('New category'), 'Joint Account');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Joint Account', type: 'EXPENSE', icon: 'tag', group: 'EVERYDAY' });
  });

  it('disables Group and omits it when the type is Income', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type'));
    await user.click(await screen.findByRole('option', { name: 'Income', hidden: true }));
    expect(screen.getByLabelText('Group')).toBeDisabled();

    await user.type(screen.getByLabelText('New category'), 'Bonus');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Bonus', type: 'INCOME', icon: 'tag' });
  });

  it('switches Group to Saving & Investment when the type is Investment', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type'));
    await user.click(await screen.findByRole('option', { name: 'Investment', hidden: true }));
    expect(screen.getByLabelText('Group')).toHaveValue('Saving & Investment');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run app/components/transactions/__tests__/CategoryChips.test.tsx app/routes/__tests__/categories.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`CategoryChips.tsx`: add imports `import { groupCategories } from '~/lib/categoryGroups';` and `import { categoryLabel } from '~/lib/categoryIcons';`. Change the chip label to `{categoryLabel(c)}`. Replace the `data={all.map(...)}` prop with `data={selectData}` and, before the `return`, add:

```tsx
  const toOption = (c: Category): { value: string; label: string } => ({ value: c.categoryId, label: categoryLabel(c) });
  const buckets = groupCategories(all);
  const selectData = buckets.length > 1
    ? buckets.map(b => ({ group: b.label, items: b.items.map(toOption) }))
    : all.map(toOption);
```

(Keep the early returns for loading and error above these lines.)

`app/routes/categories.tsx`: add imports `defaultGroupFor, GROUP_OPTIONS, groupCategories` from `~/lib/categoryGroups`, `categoryLabel` from `~/lib/categoryIcons`, and `CategoryGroup` from `~/lib/types`. Add state `const [group, setGroup] = useState<CategoryGroup>('EVERYDAY');`. Replace the type Select's `onChange` with:

```tsx
onChange={v => {
  const next = v as CategoryType;
  setType(next);
  const nextGroup = defaultGroupFor(next);
  if (nextGroup) setGroup(nextGroup);
}}
```

Add a Group select after the Type select:

```tsx
<Select label="Group" data={GROUP_OPTIONS} value={type === 'INCOME' ? null : group}
  onChange={v => { if (v) setGroup(v as CategoryGroup); }}
  disabled={type === 'INCOME'} allowDeselect={false} />
```

Change the Add button's `onClick` mutate call to:

```tsx
createCategory.mutate(type === 'INCOME'
  ? { name: name.trim(), type, icon: 'tag' }
  : { name: name.trim(), type, icon: 'tag', group });
```

Replace the `{TYPES.map(...)}` section block with a group-driven one:

```tsx
{groupCategories(all).map(bucket => (
  <div key={bucket.key}>
    <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
    {bucket.items.map(c => (
      <Group key={c.categoryId} justify="space-between" py={6}>
        <Group gap="xs">
          <Text>{categoryLabel(c)}</Text>
          {c.isDefault && <Badge size="xs" variant="light">default</Badge>}
        </Group>
        {!c.isDefault && (
          <Button size="compact-xs" variant="subtle" color="danger" onClick={() => setPendingDelete(c)}>
            Delete
          </Button>
        )}
      </Group>
    ))}
  </div>
))}
```

The `TYPES` array stays (used by the Type select). Everything else (reassign dialog, candidates by type) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app` then `yarn typecheck`
Expected: PASS, clean. Fix any Mantine grouped-`Select` quirk by adjusting the test query, not by weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/CategoryChips.tsx app/components/transactions/__tests__/CategoryChips.test.tsx app/routes/categories.tsx app/routes/__tests__/categories.test.tsx
git commit -m "feat: group categories in the picker and Categories page"
```

---

### Task 5: Grouped Targets page and Home dashboard

**Files:**
- Modify: `app/routes/targets.tsx`, `app/routes/_index.tsx`, `app/lib/summary.ts`, `app/lib/__tests__/summary.test.ts`, `app/routes/__tests__/index.test.tsx`
- Create: `app/routes/__tests__/targets.test.tsx`

**Interfaces:**
- Consumes: `groupCategories`, `groupItems`, `bucketKeyFor` (`~/lib/categoryGroups`), `categoryLabel`.
- Produces: `CategoryProgress.group?: CategoryGroup`.

- [ ] **Step 1: Write the failing tests**

Append to `app/lib/__tests__/summary.test.ts` (use the file's existing imports and helper style; if `buildMonthSummary` and a category factory exist there, reuse them, otherwise this self-contained test is enough):

```ts
describe('buildMonthSummary groups', () => {
  it('carries the category group onto its progress row', () => {
    const summary = buildMonthSummary({
      transactions: [],
      categories: [{ categoryId: 'c1', name: 'Mortgage', type: 'EXPENSE', icon: 'tag', isDefault: true, createdAt: '', group: 'BILLS' }],
      targets: [{ categoryId: 'c1', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' }],
      yearMonth: '2026-09',
    });
    expect(summary.spending[0].group).toBe('BILLS');
  });
});
```

Create `app/routes/__tests__/targets.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { Category } from '~/lib/types';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const categories: Category[] = [
  { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: '🛒', isDefault: true, createdAt: '' },
  { categoryId: 'm', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: '🏠', isDefault: true, createdAt: '' },
  { categoryId: 'w', name: 'Windows', type: 'INVESTMENT', group: 'SAVING_INVESTMENT', icon: '🪟', isDefault: true, createdAt: '' },
  { categoryId: 's', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
];

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useSetTarget: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTarget: () => ({ mutate: vi.fn() }),
}));

import Targets from '../targets';

describe('Targets page', () => {
  it('has one section per group in order and no Income section', () => {
    render(<MantineProvider><Targets /></MantineProvider>);
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(headings).toEqual(['Bills', 'Everyday Spending', 'Saving & Investment']);
  });

  it('shows the emoji before the category name', () => {
    render(<MantineProvider><Targets /></MantineProvider>);
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
  });
});
```

Replace the module-level mock in `app/routes/__tests__/index.test.tsx` so data is controllable, and add a test. Change the mock block to:

```tsx
const data = vi.hoisted(() => ({ categories: [] as unknown[], targets: [] as unknown[] }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: data.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: data.targets, isLoading: false, error: null, refetch: vi.fn() }),
  useTransactions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
```

and inside `describe('Home')` add:

```tsx
  it('shows group sub-headings inside the spending section, in group order', () => {
    data.categories = [
      { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: 'tag', isDefault: true, createdAt: '' },
      { categoryId: 'm', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: 'tag', isDefault: true, createdAt: '' },
    ];
    data.targets = [
      { categoryId: 'g', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' },
      { categoryId: 'm', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' },
    ];
    renderHome();
    const bills = screen.getByText('Bills');
    const everyday = screen.getByText('Everyday Spending');
    expect(bills.compareDocumentPosition(everyday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

(Reset `data.categories = []; data.targets = [];` in a `beforeEach` you add to the file, importing `beforeEach` from vitest.)

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run app/lib/__tests__/summary.test.ts app/routes/__tests__`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/lib/summary.ts`: import `CategoryGroup` from `./types`; add `group?: CategoryGroup;` to `CategoryProgress`; in `toProgress`'s returned object add `group: category.group,`.

`app/routes/targets.tsx`: import `groupCategories` and `categoryLabel`; change the row heading `<Text fw={500}>{category.name}</Text>` to `{categoryLabel(category)}` (keep `aria-label={`Target for ${category.name}`}` on the input). In `TargetsContent`, delete the `expense` and `investment` constants and the two hard-coded sections, and render:

```tsx
{groupCategories(eligible).map(bucket => (
  <div key={bucket.key}>
    <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
    {bucket.items.map(c => {
      const t = targetFor(c.categoryId);
      return <TargetRow key={c.categoryId} category={c}
        amountPence={t?.targetAmount ?? null} period={t?.period ?? 'MONTHLY'} />;
    })}
  </div>
))}
```

`app/routes/_index.tsx`: import `groupItems, bucketKeyFor` from `~/lib/categoryGroups`; add a small local component above `HomeContent`:

```tsx
function GroupedProgress({ items }: { items: CategoryProgress[] }) {
  return (
    <>
      {groupItems(items, p => bucketKeyFor({ group: p.group, type: 'EXPENSE' })).map(bucket => (
        <div key={bucket.key}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>{bucket.label}</Text>
          {bucket.items.map(p => <CategoryProgressRow key={p.categoryId} progress={p} />)}
        </div>
      ))}
    </>
  );
}
```

(import `type { CategoryProgress } from '~/lib/summary'`) and replace the two `summary.spending.map(...)` and `summary.saving.map(...)` lines with `<GroupedProgress items={summary.spending} />` and `<GroupedProgress items={summary.saving} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: full suite PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/routes/targets.tsx app/routes/_index.tsx app/lib/summary.ts app/lib/__tests__/summary.test.ts app/routes/__tests__/index.test.tsx app/routes/__tests__/targets.test.tsx
git commit -m "feat: show category groups on Targets and Home"
```

---

### Task 6: Roadmap and docs

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Update the roadmap**

In `docs/ROADMAP.md`:
- Row D: change status to `Merged ([PR #36](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/36)). Spec: ..., plan: ...` (keep the existing spec and plan paths).
- Row E: change to `Dropped: manual CSV/OFX import was judged clunky and would not be used.`
- Add rows after E:
  - `| F1 | Category groups and YNAB defaults | Implemented on `feat/category-groups`. Spec: `superpowers/specs/2026-09-24-category-groups-design.md`, plan: `superpowers/plans/2026-09-24-category-groups.md` |`
  - `| F2 | Savings and sinking-fund pots | Not started: carried-over balance, Set aside / Take out, goal and monthly targets, optional auto-contribute |`
  - `| G | Polish and hardening pass | Not started |`
  - `| H | Spending insights | Not started (after F) |`
  - `| I | Net worth and accounts | Not started |`
  - `| J | Offline entry queue | Not started |`
- Replace the whole `## E: CSV/OFX import` section with a short `## E: CSV/OFX import (dropped)` section: one paragraph stating it was dropped on 2026-09-24 because manual import was judged a clunky experience the owner would not use, and that automatic bank sync is covered in `DECISIONS.md`.
- Under `## Later ideas`, replace the offline entry queue bullet's last sentence so it reads `Tracked as sub-project J.`
- Add a `## F1: Category groups and YNAB defaults` section: what was built (fixed groups, 27 defaults, `CategoryIcon`, grouped picker/Categories/Targets/Home), decisions (no remap script because the test data was deleted; Saving & Investment stay `INVESTMENT` type until F2 pots; custom categories default group by type), and follow-ups (deleting a custom category leaves its target orphaned; user-created groups; old default ids such as `cat-food` are removed, so anything still referencing them shows as an unknown category).

- [ ] **Step 2: Verify**

Run: `yarn test && yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: record category groups and drop CSV import from the roadmap"
```

## Verification after all tasks (controller, not a task)

- `yarn test`, `yarn typecheck`.
- Real-browser pass with the stubbed headless harness at 390px and 1280px: grouped dropdown, emoji chips, Categories page sections and Group select, Targets sections, Home sub-headings, and emoji in transaction rows.
- SECURITY.md pre-PR checklist (IO-01 for `group`).
