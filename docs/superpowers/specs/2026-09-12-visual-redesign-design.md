# Budget App — Visual Redesign & Theming Design

**Date:** 2026-09-12
**Status:** Approved for planning
**Covers:** App-wide color system, light/dark toggle, navigation consolidation,
transaction list density, accessibility pass
**Defers:** New features (no new screens, no API changes)

## Goal

The app works end-to-end but looks like a Mantine starter template: a flat
two-color `virtualColor` theme, no manual light/dark toggle, two navigation
surfaces doing overlapping jobs, and a transaction list that is just plain
rows with no way to narrow down a busy month. This redesign makes the app look
intentional, keeps it usable as transaction volume grows, and meets WCAG AA —
without touching the API or data model.

## Product Decisions

**Scope is the whole app**, not a subset of screens, so no screen is left
looking like the old theme mid-migration.

**Palette direction: calm & trustworthy.** A deep indigo/teal primary, a warm
amber for at-risk/warning states, red for over-budget/destructive actions,
green for income/under-budget, and a cool neutral gray scale for backgrounds,
borders and body text. This reads as a considered "fintech-serious" feel
rather than the current flat teal.

**List density is solved with search + filters, not collapsing.** A search box
(matches description and category name) plus category/type filter dropdowns
above the transaction list, backed by tightened row spacing and a category
icon per row. Collapsible date groups were considered and rejected: they hide
information by default, whereas search/filters let the user narrow down
without ever losing the ability to see everything.

**Navigation is consolidated to one surface.** The current bottom tab bar
(Home/Transactions/Targets) and the separate burger-triggered sidebar
(Home/Categories/Test) are replaced by a single navigation list — Home,
Transactions, Targets, Categories — rendered as bottom tabs on mobile and a
sidebar on desktop. The `/test` route (a leftover API debug harness, not a
user feature) is dropped from navigation; the route itself is left alone,
out of scope for this redesign.

## Scope

**In scope**

| Area | Change |
| --- | --- |
| `app/root.tsx` | Replace flat `virtualColor` theme with a generated semantic color system |
| `app/components/layout/DefaultLayout.tsx` | Single consolidated nav (sidebar + bottom tabs from one source), header theme toggle |
| `app/components/transactions/TransactionRow.tsx` | Category icon, tightened spacing |
| `app/routes/transactions.tsx` | Search input + category/type filter dropdowns, client-side filtering |
| `app/components/budget/CategoryProgressRow.tsx`, `MonthHeader.tsx` | Restyle to new tokens; no structural change |
| All other components | Restyle to new tokens as a pass, no structural change |

**Out of scope**

New features, new screens, API/data model changes, collapsible date groups,
virtualized/paginated lists (current volumes don't need it — search/filters
solve the stated problem), removing or fixing the `/test` route itself.

## Architecture

### Color system

Replace the two flat 10-times-repeated hex arrays in `app/root.tsx` with
Mantine's `createTheme` using real generated 10-shade color scales:

| Token | Role | Base |
| --- | --- | --- |
| `primary` | Buttons, links, active nav, progress bars under target | Deep indigo/teal |
| `danger` | Over-budget, delete actions | Red |
| `warning` | Approaching target | Amber |
| `success` | Income, under-budget | Green |
| `gray` (Mantine default, tuned) | Backgrounds, borders, dimmed text | Cool neutral |

Each scale is generated from a single base hex (via Mantine's
`generateColors`/manual 10-step ramp, not the current copy-pasted flat array),
so light/dark mode and hover/active states resolve to different, correct
shades automatically. `primaryColor: 'primary'` and `autoContrast: true` are
set on the theme so text-on-color resolves without hardcoded per-component
color props.

`virtualColor` usage for `menu`/`text` is removed — Mantine's default
`var(--mantine-color-body)` and semantic color roles replace the bespoke
tokens once the real scales exist, removing a layer of indirection that added
no value over Mantine's built-ins.

### Dark/light toggle

No new state management: `useMantineColorScheme()` (already a transitive
dependency via `@mantine/core`) exposes `colorScheme` and `setColorScheme`,
and Mantine persists the choice to `localStorage` itself. A sun/moon
`ActionIcon` replaces the plain "Menu" text in `AppShell.Header`, cycling
light → dark → light. `defaultColorScheme="auto"` in `root.tsx` (already set)
stays as the initial value before a user makes an explicit choice.

### Navigation

`DefaultLayout.tsx` currently defines `TABS` (3 items, bottom tabs) and a
separate hardcoded `AppShell.Navbar` (3 different items, desktop sidebar) —
two lists that already drift from each other. These become one `NAV_ITEMS`
array of 4 entries (Home, Transactions, Targets, Categories), consumed by
both `BottomTabs` (mobile, `hiddenFrom="sm"`) and `AppShell.Navbar`
(desktop, `visibleFrom="sm"`). The mobile burger/`desktopOpened` collapse
toggle is removed along with it — mobile now navigates entirely through
`BottomTabs`, matching how the FAB already works.

### Transaction list filtering

Pure function in `app/lib/transactions.ts` (new file, mirroring the
`money.ts`/`summary.ts` pattern):

```ts
filterTransactions(
  transactions: Transaction[],
  categories: Category[],
  { query, categoryId, type }: TransactionFilter,
): Transaction[]
```

Matches `query` case-insensitively against `description` and the resolved
category name; `categoryId`/`type` are exact-match narrowing, both optional.
`transactions.tsx` holds `TransactionFilter` in local state, derives the
filtered list with `useMemo`, and the existing date-grouping logic runs on
the filtered result rather than the raw list. No API changes — this is
entirely client-side over data already being fetched for the month.

### Category icons

`Category.icon` already stores a Tabler icon name (`'home'`,
`'shopping-cart'`, etc. — see `src/api/defaults.ts`). A new
`app/lib/categoryIcons.ts` maps these kebab-case names to their
`@tabler/icons-react` PascalCase components (e.g. `'shopping-cart'` →
`IconShoppingCart`), with a fallback icon for any unmapped/custom-category
icon string. `TransactionRow` renders the icon in a small colored circle to
the left of the description, replacing pure-text rows.

## Error Handling

- **Unknown/unmapped icon name** — falls back to a generic icon
  (`IconCategory`) rather than rendering nothing or throwing; custom
  categories created via the API always have *some* icon string, but it may
  not match a known Tabler name.
- **Empty filter results** — "No transactions match your search" empty state,
  distinct from the existing "Nothing logged this month yet" empty state, so
  a user doesn't think their data disappeared.
- **Color contrast is enforced at design time, not runtime** — no dynamic
  contrast-checking code; the generated scales are chosen and manually
  verified against AA before implementation, per the Accessibility section.

## Accessibility

Target: WCAG AA.

- Every text/background pairing introduced by the new palette (in both color
  modes) meets 4.5:1 for body text and 3:1 for large text/icons — checked
  against the actual generated shades before they're committed to the theme,
  not assumed from the base hex.
- Status is never color-only: the existing `⚠` prefix pattern in
  `CategoryProgressRow` for over-budget is kept and extended to new
  warning/danger states (icon + color, not color alone).
- All icon-only interactive elements keep or gain `aria-label`s: theme
  toggle, filter dropdowns, search clear button, nav items.
- Focus states get an explicit visible style — Mantine's default focus ring
  is too subtle against the new palette in some states.

## Testing

| Layer | Approach |
| --- | --- |
| `app/lib/transactions.ts` (`filterTransactions`) | Unit tests, pure function, no DOM — follows the `money.ts`/`summary.ts` pattern |
| `app/lib/categoryIcons.ts` | Unit test for the fallback path (unknown icon name) |
| Theme, layout, component restyling | No automated test — verified by running the app in a browser at mobile and desktop widths, in both light and dark mode, per the project's UI-testing requirement |

Not covered: visual regression testing, full component coverage. This is a
styling and light-logic change; the two new pure modules carry the only
behavior worth asserting in code.

## Prerequisites

None — this builds on the existing app, no pending PRs required.
