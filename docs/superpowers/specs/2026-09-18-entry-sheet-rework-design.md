# Entry Sheet Rework — Design

**Date:** 2026-09-18
**Status:** Draft, awaiting review
**Sub-project:** A of a five-part "fast transaction entry" effort (see [Roadmap](#roadmap))

## Background

Bank sync was dropped (see `docs/DECISIONS.md`), so transactions are entered by hand. Entry speed is now the product's core interaction. Today, logging a coffee takes: tap the floating button, type the amount, open a category dropdown and pick one, tap Save, then wait for the API round-trip before the sheet closes.

Current pain points in `TransactionSheet.tsx` and `DefaultLayout.tsx`:

- The category is a dropdown that starts empty every time and is reset when the type changes.
- The sheet closes after every save, so batch entry means repeated open/close cycles.
- `handleSave` awaits the network (`mutateAsync`) before closing, so Lambda cold starts show as a visible pause.
- No keyboard path: no Enter-to-save, no shortcut to open the sheet, and a bottom drawer on desktop.

## Goals

1. Reduce a typical entry (amount + category) to the fewest possible interactions.
2. Make saving feel instant regardless of API latency.
3. Make batch entry (several transactions in a row) fast.
4. Make a keyboard-only flow work on desktop.

## Non-goals

Deferred to other sub-projects or explicitly excluded: category memory and other prefill, duplicate-from-row, one-line quick add (B); recurring templates (C); PWA install and add shortcut (D); CSV/OFX import (E); optimistic edit or delete; an offline queue; number-key chip shortcuts; any API or infrastructure change.

## Design

### 1. Sheet layout

```
 Add transaction                          ✕
 Amount   £ [ 0.00 ]                  autofocused, decimal keypad
 [ Spend | Income | Invest in | Invest out ]
 Category
 (Groceries) (Dining) (Transport) (Coffee) (Bills) (More…)
 [ Today ] [ Yesterday ] [ Other… ]   + Add note
 [ Cancel ]        [ Save & add another ] [ Save ]
```

- Amount stays first and autofocused. The type control sits directly under it because it determines which categories are shown.
- **Category chips:** the top 5 categories of the selected type, ranked by transaction count in the current month, padded with default category order when history is thin (for example early in the month). "More…" reveals the existing searchable `Select`. A category chosen through More is shown as a selected chip so the choice stays visible. Changing the type re-derives the chips and clears the selection (existing behaviour).
- **Date:** Today is preselected; Yesterday is one tap; "Other…" reveals the existing `DateInput`. The note is behind "+ Add note" when adding. When editing, note and date are already expanded and no controls are hidden.
- **Buttons (add mode):** "Save & add another" keeps the sheet open, clears the amount, note and category, and keeps type and date. The category is cleared deliberately so a repeat entry cannot be silently mis-filed; picking it again is one chip tap. "Save" closes the sheet. **Edit mode** has a single Save.
- **Validation** is unchanged: same amount, category and date rules with inline errors.

The chip ranking is a pure function `topCategories(transactions, categories, type, n)` in `app/lib/transactions.ts`. It is fed by `useTransactions(currentYearMonth())` called inside the sheet, using data the app already fetches. Sub-project B may later extend the history window.

### 2. Optimistic save and Undo

The API derives `yearMonth = date.slice(0, 7)` and generates `transactionId` and `createdAt` server-side (`src/api/transactions.ts:98-109`), so the client can compute the cache key but cannot know the real ID up front.

**`useCreateTransaction` (`app/lib/queries.ts`)**, standard React Query optimistic flow. It no longer needs a `yearMonth` parameter.

- `onMutate`: cancel in-flight fetches for the target month, snapshot the cache, then append a temporary row (`transactionId: "temp-<uuid>"`, client timestamp). The target month is `input.date.slice(0, 7)`, so backdated entries land in the correct month.
- `onError`: restore the snapshot, so the row disappears.
- `onSettled`: invalidate that month's query (existing behaviour), which replaces the temp row with the real one.
- The Home summary and Transactions list read the same query key and update immediately.

**`TransactionSheet` behaviour (add mode)**

- Save calls `create.mutateAsync(input)`, holds the promise, and closes or resets the sheet immediately (Save vs Save & add another). It does not await the network.
- A toast appears immediately: "Saved £4.80 · Coffee [Undo]". **Undo chains on the held promise**: `promise.then(t => remove({ transactionId: t.transactionId, yearMonth: t.yearMonth }))`. It works even if the server has not responded yet, and it is a no-op if the create failed. There is no disabled state and no delayed toast.
- On failure the row rolls back and an error toast reads "Couldn't save £4.80 · Coffee [Retry]". Retry re-fires the same captured input directly, because the sheet may already have been reset for the next entry.
- **Edit mode stays awaited** with the inline error, as today. An optimistic edit would need a different Undo (restore old values) and adds little value.

**`useDeleteTransaction`** changes to take `{ transactionId, yearMonth }` as mutation variables instead of binding `yearMonth` at hook creation, so Undo can delete from whichever month the entry landed in. The existing caller in `app/routes/transactions.tsx` is updated. `useUpdateTransaction(yearMonth)` is unchanged.

**Toast plumbing:** add `@mantine/notifications`, import its styles, and mount `<Notifications />` in `app/root.tsx`. Position it bottom-centre with an offset above the bottom tab bar and floating button (`bottom: 84`, 56px tall) and a z-index above the button's 101. Auto-dismiss after about 5 seconds. The note is rendered as plain React text.

### 3. Desktop experience

- **Modal on wide screens:** at the `sm` breakpoint and above (the same one `AppShell` uses), the sheet renders as a centred `Modal` about 440px wide. Below that it stays a bottom `Drawer`. The form body is one shared component used by both wrappers. The wrapper is chosen with `useMediaQuery` from `@mantine/hooks` (already installed).
- **Global shortcut:** `N` opens the add sheet from anywhere, using `useHotkeys` in `DefaultLayout`. It ignores keystrokes while focus is in an input, textarea or select by default, and calls `preventDefault` so the character is not typed into the amount field. The floating button's tooltip reads "Add transaction (N)".
- **Keyboard-only flow:**
  - The form is a real `<form>`. Enter runs Save & add another when adding and Save when editing.
  - Chips are a single-select `Chip.Group` (radio semantics): Tab lands on the group once, arrow keys move between chips. The type control behaves the same way.
  - After Save & add another, focus returns to the amount field, because autofocus only fires on open.
  - Unverified assumption: Enter on a focused radio submits the form in all target browsers. This is checked in a real browser during implementation. If it fails, Enter is handled explicitly on the chip group.

## Files touched

| File | Change |
|---|---|
| `app/lib/transactions.ts` | New pure `topCategories(...)`, unit tested |
| `app/lib/queries.ts` | Optimistic `useCreateTransaction`; `useDeleteTransaction` takes `{ transactionId, yearMonth }` |
| `app/routes/transactions.tsx` | Update the one existing delete caller |
| `app/components/transactions/CategoryChips.tsx` | New: chip group plus "More…" reveal |
| `app/components/transactions/TransactionSheet.tsx` | Reordered form, date quick-pick, two buttons, Modal/Drawer switch, Undo/Retry toasts |
| `app/components/layout/DefaultLayout.tsx` | `N` hotkey and tooltip |
| `app/root.tsx`, `package.json` | `@mantine/notifications` provider and styles |

No API, infrastructure or `SECURITY.md` control changes. Validation stays server-side (IO-01) and unchanged; the toast renders user text through React, not as HTML.

## Testing

- `topCategories`: ranking by count, filtering by type, padding with default order, tie-breaking, empty history.
- `useCreateTransaction`: temp row appears in the date's month (including a backdated entry), rollback on error, invalidation on settle.
- `useDeleteTransaction`: deletes from the supplied month and invalidates it.
- `TransactionSheet`:
  - Save closes before the create resolves.
  - Save & add another keeps the sheet open, clears the amount, note and category, and keeps type and date.
  - Undo deletes the created row, including when clicked before the server responds.
  - Retry re-fires the captured input after a failure.
  - Edit mode still awaits and shows inline errors.
- Existing tests: the "submits a valid transaction" case picks the category through the `Choose` dropdown and moves to clicking a chip. The other three tests should pass unchanged.
- jsdom must stub `matchMedia` for `useMediaQuery`; confirm the test setup does.
- Manual browser check: keyboard-only flow, Enter on a radio, toast position above the tab bar and floating button, dark mode.
- `yarn typecheck` and `yarn test` must pass.

## Build order

Each step is one atomic, test-first commit on `feat/entry-sheet-rework`:

1. `topCategories` and its tests.
2. Notifications dependency and provider.
3. Optimistic create, the delete signature change, and hook tests.
4. Sheet rework: chips, date quick-pick, two buttons, Undo and Retry toasts.
5. Responsive Modal/Drawer, `N` shortcut and focus handling.
6. Full verification, including the browser check.

## Roadmap

| # | Sub-project | Covers |
|---|---|---|
| **A** | **Entry sheet rework (this spec)** | Chips, save & add another, optimistic save with Undo, desktop shortcuts and modal |
| B | Smart prefill | Category memory, duplicate from row, one-line quick add |
| C | Recurring templates | One-tap recurring income and expenses on Home |
| D | PWA and add shortcut | Installable app with a shortcut straight into entry |
| E | CSV/OFX import | Bulk import from bank statement exports |
