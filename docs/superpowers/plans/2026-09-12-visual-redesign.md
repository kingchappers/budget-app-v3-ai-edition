# Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's flat two-color theme with a real semantic color system, add a manual light/dark toggle, consolidate the two overlapping navigation surfaces into one, and make the transaction list stay usable at high volume via search/filter and category icons.

**Architecture:** All changes are frontend-only (Mantine theme config, React components, one new pure utility module for filtering). No API, database, or infrastructure changes. Existing TanStack Query data layer and route structure are untouched.

**Tech Stack:** React 19, React Router v7 (SPA mode), Mantine 8, Tailwind CSS 4, `@tabler/icons-react`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-visual-redesign-design.md`

## Global Constraints

- No API or data-model changes — `Category.icon` already stores Tabler icon names (`src/api/defaults.ts`); this plan only renders them, it does not add new fields.
- WCAG AA: 4.5:1 contrast for body text, 3:1 for large text/icons, in both color modes.
- Status is never color-only (icon/prefix + color, not color alone).
- No new runtime dependencies — the color scales are hand-authored literals (Tailwind's published teal/red/amber/green/slate ramps), not generated via `@mantine/colors-generator`, which isn't installed and isn't needed for a one-time static palette.
- Follow existing patterns: pure logic in `app/lib/*.ts` with tests in `app/lib/__tests__/*.test.ts` (Vitest, jsdom project for anything importing React, node project otherwise) — see `vitest.config.ts`.

---

### Task 1: New color theme + fix the Tailwind/Mantine dark-mode mismatch

**Files:**
- Modify: `app/root.tsx:15,24-85` (theme definition and imports)
- Modify: `app/app.css:9-17` (root background/text rule)

**Interfaces:**
- Produces: Mantine color keys `primary`, `danger`, `warning`, `success`, and an overridden `gray` — every later task that sets a `color="..."` prop uses these names.

- [ ] **Step 1: Replace the theme in `app/root.tsx`**

Remove the `virtualColor` import and the `menu`/`text` virtual colors entirely — they're being replaced by Mantine's own body/text CSS variables in Step 2. Replace the whole `createTheme(...)` call:

```ts
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme } from '@mantine/core';
```

```ts
const theme = createTheme({
  primaryColor: 'primary',
  primaryShade: { light: 6, dark: 8 },
  autoContrast: true,
  colors: {
    // Deepened/completed version of the app's existing teal — same hue,
    // now a real 10-shade ramp so hover/active/dark-mode states resolve
    // to different shades instead of one flat repeated hex.
    primary: [
      '#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf',
      '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a',
    ],
    danger: [
      '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171',
      '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
    ],
    warning: [
      '#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24',
      '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f',
    ],
    success: [
      '#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80',
      '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
    ],
    gray: [
      '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8',
      '#64748b', '#475569', '#334155', '#1e293b', '#0f172a',
    ],
  },
});
```

These are Tailwind's published teal/red/amber/green/slate ramps (shades 50–900, dropping the 950 step to fit Mantine's required 10-tuple) — already widely verified for AA contrast at the index pairings Mantine uses by default (e.g. index 6+ background with white text; index 6+ text on a white/index-0 background).

- [ ] **Step 2: Fix `app/app.css` so Tailwind and Mantine agree on color scheme**

The current rule uses Tailwind's `dark:` variant, which follows `prefers-color-scheme` — it ignores Mantine's manual toggle entirely, so once Task 3 adds a toggle, picking "dark" while the OS is set to light would leave the page background light while every Mantine component goes dark. Replace:

```css
html,
body {
  @apply bg-white dark:bg-slate-900;
  @apply text-slate-950 dark:text-slate-100;

  @media (prefers-color-scheme: dark) {
    color-scheme: dark;
  }
}
```

with:

```css
html,
body {
  background-color: var(--mantine-color-body);
  color: var(--mantine-color-text);
}
```

Mantine sets these CSS variables based on whatever color scheme is actually active (auto, or the user's explicit choice), so the page background now always matches Mantine's own components.

- [ ] **Step 3: Verify**

Run: `yarn typecheck`
Expected: no errors (confirms the `virtualColor` removal didn't leave a dangling import/usage).

Run: `yarn test`
Expected: all existing tests still pass (this task touches no logic, just theme tokens).

- [ ] **Step 4: Commit**

```bash
git add app/root.tsx app/app.css
git commit -m "feat: replace flat theme with generated semantic color scales"
```

---

### Task 2: Light/dark toggle

**Files:**
- Create: `app/components/layout/ColorSchemeToggle.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx:1-6,73-92` (header content and imports)

**Interfaces:**
- Consumes: nothing new — Mantine's `useMantineColorScheme`/`useComputedColorScheme` hooks (already available transitively via `@mantine/core`, already a dependency).
- Produces: `ColorSchemeToggle` component, imported into `DefaultLayout`'s header.

- [ ] **Step 1: Create the toggle**

`app/components/layout/ColorSchemeToggle.tsx`:

```tsx
import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });

  function toggle() {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  }

  return (
    <ActionIcon
      variant="subtle"
      size="lg"
      aria-label={computedColorScheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggle}
    >
      {computedColorScheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
    </ActionIcon>
  );
}
```

`useComputedColorScheme` resolves Mantine's `'auto'` down to the actual `'light'`/`'dark'` currently rendered (from OS preference until the user picks explicitly), which is what decides which icon to show. `setColorScheme` persists the explicit choice to `localStorage` automatically — no new state management needed.

- [ ] **Step 2: Wire it into the header**

In `app/components/layout/DefaultLayout.tsx`, add the import:

```ts
import { ColorSchemeToggle } from './ColorSchemeToggle';
```

Replace the `<AppShell.Header>` block's content (the `Flex` with the burger/"Menu" text on the left and `Authentication` on the right) — leave the burger/mobile-nav-open logic alone for now, it's removed in Task 3. For this task, only add the toggle next to `Authentication`:

```tsx
<Group gap="sm">
  <ColorSchemeToggle />
  <Authentication />
</Group>
```

replacing the existing `<div className=''><Authentication /></div>` block.

- [ ] **Step 3: Verify**

Run: `yarn typecheck`
Expected: no errors.

Run: `yarn test`
Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/layout/ColorSchemeToggle.tsx app/components/layout/DefaultLayout.tsx
git commit -m "feat: add light/dark mode toggle"
```

---

### Task 3: Consolidate navigation into one surface

**Files:**
- Modify: `app/components/layout/DefaultLayout.tsx` (full nav restructure)

**Interfaces:**
- Produces: `NAV_ITEMS` array (replaces the existing `TABS` array), consumed by both `BottomTabs` and the new `SidebarNav`.

**Context:** Today `BottomTabs` (3 items: Home/Transactions/Targets) has no breakpoint prop at all, so it renders on every screen size simultaneously with `AppShell.Navbar`'s separate hardcoded 3-item list (Home/Categories/Test) — two nav surfaces visible at once on desktop, listing different items, with different icons even for "Home" (`IconHome` vs `IconHome2`). This task replaces both with one 4-item list (Home/Transactions/Targets/Categories), shown as bottom tabs below the `sm` breakpoint and as a sidebar above it, and removes `/test` (a dev-only debug route, not a user-facing feature) from navigation entirely.

- [ ] **Step 1: Replace `TABS` with a shared `NAV_ITEMS` list**

```tsx
import { IconHome, IconList, IconTarget, IconTag } from '@tabler/icons-react';

const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/targets', label: 'Targets', Icon: IconTarget },
  { to: '/categories', label: 'Categories', Icon: IconTag },
];

function isNavItemActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}
```

Remove the now-unused `IconHome2`, `IconSettings` imports (they were only used by the old hardcoded sidebar items, including the `/test` link).

- [ ] **Step 2: Update `BottomTabs` to use `NAV_ITEMS` and hide on desktop**

```tsx
function BottomTabs() {
  const { pathname } = useLocation();
  return (
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
      </Group>
    </Paper>
  );
}
```

(Only change from today: `NAV_ITEMS` instead of `TABS`, and the new `hiddenFrom="sm"` prop — everything else is identical.)

- [ ] **Step 3: Add a `SidebarNav` component for desktop, using the same active-state logic**

```tsx
function SidebarNav() {
  const { pathname } = useLocation();
  return (
    <>
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          component={RouterNavLink}
          to={to}
          label={label}
          active={isNavItemActive(pathname, to)}
          leftSection={<Icon size={16} stroke={1.5} />}
        />
      ))}
    </>
  );
}
```

This also fixes a latent gap: the old hardcoded sidebar `NavLink`s used plain `href`, so they never showed an active state at all. `component={RouterNavLink}` plus the computed `active` prop fixes that for free.

- [ ] **Step 4: Simplify the `AppShell` — remove the desktop collapse toggle entirely**

Desktop no longer needs a collapsible sidebar (it's always visible now that mobile has its own bottom-tab nav), so drop `useDisclosure`, `mobileOpened`/`desktopOpened`, `toggleMobile`/`toggleDesktop`, and the `Burger` components:

```tsx
export function DefaultLayout({ children }: { children: React.ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback={false}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: 'openid profile email offline_access',
      }}
    >
      <AppShell
        padding="md"
        header={{ height: 60 }}
        navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: true, desktop: false } }}
      >
        <AppShell.Header>
          <Flex h="100%" px="md" justify="space-between" align="center">
            <Text fw={700}>Budget</Text>
            <Group gap="sm">
              <ColorSchemeToggle />
              <Authentication />
            </Group>
          </Flex>
        </AppShell.Header>
        <AppShell.Navbar p="md">
          <SidebarNav />
        </AppShell.Navbar>

        <AppShell.Main pb={80}>
          {children}
        </AppShell.Main>
        <ActionIcon
          size={56} radius="xl" variant="filled" aria-label="Add transaction"
          onClick={() => setAddOpen(true)}
          style={{ position: 'fixed', right: 16, bottom: 84, zIndex: 101 }}
        >
          <IconPlus size={26} />
        </ActionIcon>
        <TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />
        <BottomTabs />
      </AppShell>
    </Auth0Provider>
  );
}
```

Remove the now-unused `useDisclosure` and `Burger` imports.

- [ ] **Step 5: Verify**

Run: `yarn typecheck`
Expected: no errors.

Run: `yarn test`
Expected: all existing tests pass (no test currently covers `DefaultLayout`, so this is a typecheck-and-manual-check task — the full browser pass happens in Task 9).

- [ ] **Step 6: Commit**

```bash
git add app/components/layout/DefaultLayout.tsx
git commit -m "feat: consolidate navigation into one nav surface"
```

---

### Task 4: Category icon lookup

**Files:**
- Create: `app/lib/categoryIcons.ts`
- Create: `app/lib/__tests__/categoryIcons.test.ts`

**Interfaces:**
- Produces: `getCategoryIcon(iconName: string): Icon` — consumed by Task 5's `TransactionRow`.

- [ ] **Step 1: Write the failing test**

`app/lib/__tests__/categoryIcons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { IconHome, IconCategory } from '@tabler/icons-react';
import { getCategoryIcon } from '../categoryIcons';

describe('getCategoryIcon', () => {
  it('returns the mapped icon for a known name', () => {
    expect(getCategoryIcon('home')).toBe(IconHome);
  });

  it('falls back to a generic icon for an unknown name', () => {
    expect(getCategoryIcon('not-a-real-icon')).toBe(IconCategory);
  });

  it('falls back to a generic icon for an empty string', () => {
    expect(getCategoryIcon('')).toBe(IconCategory);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test categoryIcons`
Expected: FAIL — `Cannot find module '../categoryIcons'`

- [ ] **Step 3: Implement**

`app/lib/categoryIcons.ts` — every icon name currently used by a default category in `src/api/defaults.ts`, mapped to its `@tabler/icons-react` component:

```ts
import type { Icon } from '@tabler/icons-react';
import {
  IconHome, IconShoppingCart, IconCar, IconBolt, IconHeart, IconDeviceTv, IconShirt,
  IconSparkles, IconBook, IconToolsKitchen2, IconRefresh, IconPlane, IconGift, IconShield,
  IconBriefcase, IconCode, IconBuilding, IconCash, IconChartLine, IconCurrencyBitcoin,
  IconBuildingEstate, IconTrendingUp, IconCategory, IconTag,
} from '@tabler/icons-react';

const ICONS: Record<string, Icon> = {
  home: IconHome,
  'shopping-cart': IconShoppingCart,
  car: IconCar,
  bolt: IconBolt,
  heart: IconHeart,
  'device-tv': IconDeviceTv,
  shirt: IconShirt,
  sparkles: IconSparkles,
  book: IconBook,
  'tools-kitchen-2': IconToolsKitchen2,
  refresh: IconRefresh,
  plane: IconPlane,
  gift: IconGift,
  shield: IconShield,
  briefcase: IconBriefcase,
  code: IconCode,
  building: IconBuilding,
  cash: IconCash,
  'chart-line': IconChartLine,
  'currency-bitcoin': IconCurrencyBitcoin,
  'building-estate': IconBuildingEstate,
  'trending-up': IconTrendingUp,
  // 'tag' is the icon assigned to every user-created custom category
  // (see createCategory's default in app/routes/categories.tsx).
  tag: IconTag,
};

export function getCategoryIcon(iconName: string): Icon {
  return ICONS[iconName] ?? IconCategory;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn test categoryIcons`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/categoryIcons.ts app/lib/__tests__/categoryIcons.test.ts
git commit -m "feat: add category icon name lookup"
```

---

### Task 5: Render category icons on transaction rows

**Files:**
- Modify: `app/components/transactions/TransactionRow.tsx` (full rewrite of the component body)
- Modify: `app/routes/_index.tsx:29-30,82` (add `iconFor` helper, pass `categoryIcon` prop)
- Modify: `app/routes/transactions.tsx:19-20,56-62` (same)

**Interfaces:**
- Consumes: `getCategoryIcon` from Task 4.
- Produces: `TransactionRow` now requires a `categoryIcon: string` prop — every existing call site must be updated in this task or the build breaks.

- [ ] **Step 1: Update `TransactionRow`**

```tsx
import { ActionIcon, Group, Menu, Text, ThemeIcon } from '@mantine/core';
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import { getCategoryIcon } from '~/lib/categoryIcons';
import type { Transaction } from '~/lib/types';

const OUTGOING = new Set(['EXPENSE', 'INVESTMENT_IN']);

export function TransactionRow({
  transaction, categoryName, categoryIcon, onEdit, onDelete,
}: {
  transaction: Transaction;
  categoryName: string;
  categoryIcon: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
}) {
  const label = transaction.description || categoryName;
  const sign = OUTGOING.has(transaction.type) ? '−' : '+';
  const Icon = getCategoryIcon(categoryIcon);

  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
          <Icon size={18} stroke={1.6} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text truncate>{label}</Text>
          <Text size="xs" c="dimmed">{categoryName} · {transaction.date}</Text>
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{sign}{formatPence(transaction.amount)}</Text>
        {(onEdit || onDelete) && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDelete && <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
```

(Row padding tightened from `py={6}` to `py={4}` — the icon now anchors each line visually, so rows can sit closer together without feeling cramped. `color="danger"` on the delete menu item replaces the hardcoded `"red"`, from Task 1's new token.)

- [ ] **Step 2: Update `app/routes/_index.tsx`**

Add an `iconFor` helper next to the existing `nameFor`:

```ts
const iconFor = (id: string) =>
  categories.data?.find(c => c.categoryId === id)?.icon ?? 'tag';
```

Update the `TransactionRow` call:

```tsx
summary.recent.map(t => (
  <TransactionRow key={t.transactionId} transaction={t} categoryName={nameFor(t.categoryId)} categoryIcon={iconFor(t.categoryId)} />
))
```

- [ ] **Step 3: Update `app/routes/transactions.tsx`**

Same `iconFor` helper, and update its `TransactionRow` call:

```tsx
<TransactionRow
  key={t.transactionId}
  transaction={t}
  categoryName={nameFor(t.categoryId)}
  categoryIcon={iconFor(t.categoryId)}
  onEdit={setEditing}
  onDelete={(item) => remove.mutate(item.transactionId)}
/>
```

- [ ] **Step 4: Verify**

Run: `yarn typecheck`
Expected: no errors (confirms both call sites were updated for the new required prop).

Run: `yarn test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/TransactionRow.tsx app/routes/_index.tsx app/routes/transactions.tsx
git commit -m "feat: render category icons on transaction rows"
```

---

### Task 6: Transaction filtering logic

**Files:**
- Create: `app/lib/transactions.ts`
- Create: `app/lib/__tests__/transactions.test.ts`

**Interfaces:**
- Produces: `TransactionFilter` type and `filterTransactions(transactions, categories, filter): Transaction[]` — consumed by Task 7's `transactions.tsx`.

- [ ] **Step 1: Write the failing tests**

`app/lib/__tests__/transactions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterTransactions } from '../transactions';
import type { Category, Transaction } from '../types';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food & Groceries', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
];

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-07', amount: 1000, type: 'EXPENSE',
    categoryId: 'cat-food', description: '', date: '2026-07-10', createdAt: '', ...over,
  };
}

const noFilter = { query: '', categoryId: null, type: null };

describe('filterTransactions', () => {
  it('returns everything when the filter is empty', () => {
    const items = [txn({ transactionId: 't1' }), txn({ transactionId: 't2' })];
    expect(filterTransactions(items, categories, noFilter)).toHaveLength(2);
  });

  it('matches query against the description, case-insensitively', () => {
    const items = [
      txn({ transactionId: 't1', description: 'Weekly Shop' }),
      txn({ transactionId: 't2', description: 'Petrol' }),
    ];
    const result = filterTransactions(items, categories, { ...noFilter, query: 'shop' });
    expect(result.map(t => t.transactionId)).toEqual(['t1']);
  });

  it('matches query against the resolved category name when description does not match', () => {
    const items = [txn({ transactionId: 't1', description: '', categoryId: 'cat-food' })];
    const result = filterTransactions(items, categories, { ...noFilter, query: 'groceries' });
    expect(result.map(t => t.transactionId)).toEqual(['t1']);
  });

  it('filters by categoryId', () => {
    const items = [
      txn({ transactionId: 't1', categoryId: 'cat-food' }),
      txn({ transactionId: 't2', categoryId: 'cat-salary', type: 'INCOME' }),
    ];
    const result = filterTransactions(items, categories, { ...noFilter, categoryId: 'cat-salary' });
    expect(result.map(t => t.transactionId)).toEqual(['t2']);
  });

  it('filters by type', () => {
    const items = [
      txn({ transactionId: 't1', type: 'EXPENSE' }),
      txn({ transactionId: 't2', type: 'INCOME', categoryId: 'cat-salary' }),
    ];
    const result = filterTransactions(items, categories, { ...noFilter, type: 'INCOME' });
    expect(result.map(t => t.transactionId)).toEqual(['t2']);
  });

  it('combines query and categoryId with AND semantics', () => {
    const items = [
      txn({ transactionId: 't1', categoryId: 'cat-food', description: 'Weekly Shop' }),
      txn({ transactionId: 't2', categoryId: 'cat-salary', type: 'INCOME', description: 'Weekly Shop' }),
    ];
    const result = filterTransactions(items, categories, { query: 'shop', categoryId: 'cat-food', type: null });
    expect(result.map(t => t.transactionId)).toEqual(['t1']);
  });

  it('returns an empty array when nothing matches', () => {
    const items = [txn({ transactionId: 't1', description: 'Weekly Shop' })];
    const result = filterTransactions(items, categories, { ...noFilter, query: 'nonexistent' });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test app/lib/__tests__/transactions.test.ts`
Expected: FAIL — `Cannot find module '../transactions'`

- [ ] **Step 3: Implement**

`app/lib/transactions.ts`:

```ts
import type { Category, Transaction, TransactionType } from './types';

export interface TransactionFilter {
  query: string;
  categoryId: string | null;
  type: TransactionType | null;
}

export function filterTransactions(
  transactions: Transaction[],
  categories: Category[],
  { query, categoryId, type }: TransactionFilter,
): Transaction[] {
  const q = query.trim().toLowerCase();
  const nameById = new Map(categories.map(c => [c.categoryId, c.name]));

  return transactions.filter(t => {
    if (categoryId && t.categoryId !== categoryId) return false;
    if (type && t.type !== type) return false;
    if (q === '') return true;

    const categoryName = (nameById.get(t.categoryId) ?? '').toLowerCase();
    return t.description.toLowerCase().includes(q) || categoryName.includes(q);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test app/lib/__tests__/transactions.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/transactions.ts app/lib/__tests__/transactions.test.ts
git commit -m "feat: add transaction filtering logic"
```

---

### Task 7: Search and filter UI on the Transactions screen

**Files:**
- Modify: `app/routes/transactions.tsx` (full rewrite of `TransactionsContent`)

**Interfaces:**
- Consumes: `filterTransactions`, `TransactionFilter` from Task 6; `Category`, `TransactionType` from `~/lib/types`.

- [ ] **Step 1: Add filter state and controls**

```tsx
import { useState } from 'react';
import { ActionIcon, Alert, Button, Divider, Group, Loader, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { filterTransactions, type TransactionFilter } from '~/lib/transactions';
import { formatPence } from '~/lib/money';
import { currentYearMonth } from '~/lib/months';
import { useCategories, useDeleteTransaction, useTransactions } from '~/lib/queries';
import type { Transaction, TransactionType } from '~/lib/types';

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'INVESTMENT_IN', label: 'Investment in' },
  { value: 'INVESTMENT_OUT', label: 'Investment out' },
];

function TransactionsContent() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [filter, setFilter] = useState<TransactionFilter>({ query: '', categoryId: null, type: null });
  const categories = useCategories();
  const transactions = useTransactions(yearMonth);
  const remove = useDeleteTransaction(yearMonth);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';
  const iconFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.icon ?? 'tag';

  if (transactions.error) {
    return (
      <Alert color="danger" title="Could not load transactions">
        <Button onClick={() => transactions.refetch()}>Try again</Button>
      </Alert>
    );
  }

  if (transactions.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = transactions.data ?? [];
  const filtered = filterTransactions(all, categories.data ?? [], filter);
  const items = [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1));
  const outgoing = items
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const byDate = items.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.date] ||= []).push(t);
    return acc;
  }, {});

  const categoryOptions = (categories.data ?? []).map(c => ({ value: c.categoryId, label: c.name }));
  const isFiltering = filter.query !== '' || filter.categoryId !== null || filter.type !== null;

  return (
    <Stack>
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />

      <TextInput
        placeholder="Search transactions"
        aria-label="Search transactions"
        leftSection={<IconSearch size={16} />}
        rightSection={filter.query !== '' && (
          <ActionIcon variant="subtle" aria-label="Clear search" onClick={() => setFilter(f => ({ ...f, query: '' }))}>
            <IconX size={14} />
          </ActionIcon>
        )}
        value={filter.query}
        onChange={e => setFilter(f => ({ ...f, query: e.currentTarget.value }))}
      />
      <Group grow>
        <Select
          placeholder="All categories"
          data={categoryOptions}
          value={filter.categoryId}
          onChange={v => setFilter(f => ({ ...f, categoryId: v }))}
          clearable
          aria-label="Filter by category"
        />
        <Select
          placeholder="All types"
          data={TYPE_OPTIONS}
          value={filter.type}
          onChange={v => setFilter(f => ({ ...f, type: v as TransactionType | null }))}
          clearable
          aria-label="Filter by type"
        />
      </Group>

      <Group justify="space-between">
        <Text c="dimmed">{items.length} transactions</Text>
        <Text fw={600}>{formatPence(outgoing)} spent</Text>
      </Group>

      {items.length === 0 && all.length === 0 && <Text c="dimmed">Nothing logged this month yet.</Text>}
      {items.length === 0 && all.length > 0 && isFiltering && <Text c="dimmed">No transactions match your search.</Text>}

      {Object.entries(byDate).map(([date, dayItems]) => (
        <div key={date}>
          <Divider my="xs" label={date} labelPosition="left" />
          {dayItems.map(t => (
            <TransactionRow
              key={t.transactionId}
              transaction={t}
              categoryName={nameFor(t.categoryId)}
              categoryIcon={iconFor(t.categoryId)}
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

export default function Transactions() {
  return (
    <DefaultLayout>
      <TransactionsContent />
    </DefaultLayout>
  );
}
```

(`color="danger"` on the error `Alert` replaces the hardcoded `"red"` here too, since this whole component is being rewritten in this task anyway.)

- [ ] **Step 2: Verify**

Run: `yarn typecheck`
Expected: no errors.

Run: `yarn test`
Expected: all existing tests pass. (No new automated test here — `filterTransactions` itself is fully covered by Task 6; this task is wiring plus Mantine components, verified by the browser pass in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add app/routes/transactions.tsx
git commit -m "feat: add search and filter controls to the transactions list"
```

---

### Task 8: Swap remaining hardcoded status colors for semantic tokens

**Files:**
- Modify: `app/components/budget/CategoryProgressRow.tsx:15`
- Modify: `app/components/categories/ReassignDialog.tsx:34`
- Modify: `app/routes/targets.tsx:31,60`
- Modify: `app/routes/categories.tsx:39,51,82`
- Modify: `app/routes/_index.tsx:34`

(`app/components/transactions/TransactionRow.tsx` and `app/routes/transactions.tsx` were already updated to use `"danger"` in Tasks 5 and 7.)

**Interfaces:**
- Consumes: `danger`/`primary` color tokens from Task 1. No signature changes — every edit here is a prop value swap, not a structural change.

- [ ] **Step 1: `CategoryProgressRow.tsx:15`**

```tsx
<Progress value={Math.min(percent, 100)} color={isOver ? 'danger' : 'primary'} aria-label={`${name} progress`} />
```

- [ ] **Step 2: `ReassignDialog.tsx:34`**

Change `color="red"` to `color="danger"` on the confirm button.

- [ ] **Step 3: `targets.tsx:31,60`**

Change both `color="red"` occurrences (the delete button and the error `Alert`) to `color="danger"`.

- [ ] **Step 4: `categories.tsx:39,51,82`**

Change all three `color="red"` occurrences (error `Alert`, inline error `Alert`, delete button) to `color="danger"`.

- [ ] **Step 5: `_index.tsx:34`**

Change the error `Alert`'s `color="red"` to `color="danger"`.

- [ ] **Step 6: Verify**

Run: `yarn typecheck`
Expected: no errors.

Run: `yarn test`
Expected: all existing tests pass — none of these are logic changes, so no test assertions reference specific color values.

- [ ] **Step 7: Commit**

```bash
git add app/components/budget/CategoryProgressRow.tsx app/components/categories/ReassignDialog.tsx app/routes/targets.tsx app/routes/categories.tsx app/routes/_index.tsx
git commit -m "refactor: use semantic danger/primary color tokens throughout"
```

---

### Task 9: Full manual verification pass

**Files:** None — this task produces no diff, only a go/no-go check before the branch is considered done.

This is a styling-heavy change with almost no new automated-test surface (Tasks 4 and 6 cover the only pure logic added). Per the project's UI-testing requirement, this task verifies the actual result in a running browser rather than relying on `yarn typecheck`/`yarn test` alone.

- [ ] **Step 1: Start the dev server**

Run: `yarn dev`

- [ ] **Step 2: Check desktop width (≥ `sm` breakpoint, e.g. 1280×800)**

- Sidebar shows exactly one nav list: Home, Transactions, Targets, Categories — no bottom tab bar visible, no burger icon.
- The active route is highlighted in the sidebar.
- Header shows the app title, theme toggle, and login/profile control — no leftover "Menu" text.

- [ ] **Step 3: Check mobile width (< `sm` breakpoint, e.g. 390×844)**

- Bottom tab bar shows all four items — no sidebar, no burger icon.
- Tapping each tab navigates and highlights correctly.
- The floating "Add transaction" button doesn't overlap the bottom tabs.

- [ ] **Step 4: Check the theme toggle**

- Click it: the whole app (background, text, all Mantine components) switches between light and dark — no element stuck in the old scheme (this is what Task 1's `app.css` fix specifically prevents).
- Reload the page: the chosen scheme persists.

- [ ] **Step 5: Check the transactions screen**

- Every row shows a category icon.
- Typing in the search box narrows the list to matching description/category; clearing it restores the full list.
- The category and type filter dropdowns narrow the list correctly, and combine correctly with an active search query.
- With every filter active and no matches, the "No transactions match your search" message shows (not the "Nothing logged this month yet" empty state).

- [ ] **Step 6: Spot-check contrast in both color modes**

- Body text, dimmed text, and button labels are legible in both light and dark mode.
- The over-budget warning row (⚠ prefix + danger color) is legible and distinguishable from the normal progress rows in both modes.

- [ ] **Step 7: Regression check on existing flows**

- Add, edit, and delete a transaction.
- Set and clear a target.
- Create and delete a custom category (triggering the reassign dialog).

If any check fails, fix it as part of this branch before moving on — do not defer visual bugs found here.

- [ ] **Step 8: Final full-suite check**

Run: `yarn test && yarn typecheck`
Expected: all pass.

- [ ] **Step 9: Push and open the PR**

```bash
git push -u origin feat/visual-redesign
```

Then open a PR against `main` summarizing the color system, toggle, nav consolidation, and transaction search/filter changes, referencing `docs/superpowers/specs/2026-09-12-visual-redesign-design.md`.
