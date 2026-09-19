# Smart Prefill — Design

**Date:** 2026-09-19
**Status:** Draft, awaiting review
**Sub-project:** B of the fast transaction entry effort (see `docs/ROADMAP.md`). Builds on A (`2026-09-18-entry-sheet-rework-design.md`, PR #29), so this work is branched from `feat/entry-sheet-rework`.

## Background

Sub-project A made the add sheet fast for the amount → chip → save path. Two things remain slow: typing the same notes and re-picking the same categories ("Starbucks" is always Coffee), and repeating a regular purchase. B adds category memory keyed on the note, a one-line quick add, and duplicate-from-row. It is frontend-only.

The same branch also carries an unrelated bug fix made at the user's request: typing in the Transactions search box crashed the page (`e.currentTarget` read inside a functional `setFilter` updater, which React runs during render under StrictMode). Fixed in `554adb3` with a StrictMode regression test (`app/routes/__tests__/transactions.test.tsx`). It is independent of the design below.

## Decisions (agreed with the user)

| Question | Decision |
|---|---|
| What does memory key on? | The **note text** only. Amount alone never guesses. |
| Where does history come from? | **Client-side**: the current month plus the two previous months, via the existing per-month endpoint. No API change. |
| How do notes match? | **Exact, ignoring case and extra spaces.** Most recent match wins. No prefix or fuzzy matching. |
| Where does quick add live? | A field **atop the existing add sheet**. |
| What does Enter do on the quick-add line? | **Only fills the form.** Never saves. |
| What does the grammar cover? | Amount first or last; `+` prefix means income. No date keyword. |
| What does Duplicate do? | Opens the **add sheet prefilled, dated today**. |
| How does Duplicate reach the sheet? | **Route-local**: the Transactions route keeps a `duplicating` state and passes a `template` prop to its own sheet instance (next to `editing`). No shared context. |

## Goals

1. A remembered note recalls its category without a chip tap.
2. One typed line (`coffee 3.50`) fills amount, note, type and category.
3. A regular purchase can be repeated from its row.
4. Nothing is ever saved from a guess: the user always confirms.

## Non-goals

A `yesterday`/`today` keyword; prefix or fuzzy matching; amount-based suggestions; any server change, endpoint or data model; auto-saving; investments through quick add; Duplicate anywhere but the Transactions page; a shared add-sheet context; moving validation errors off the Amount field (a good follow-up, since quick add gets its own inline error).

## Design

### 1. Pure units

**`app/lib/quickAdd.ts`** — `parseQuickAdd(line: string)` returns `{ ok: true; amount: number; note: string; type: 'EXPENSE' | 'INCOME' }` or `{ ok: false; message: string }`.

- Split the trimmed line on whitespace into tokens.
- **Amount token:** the **last** token if it is a valid amount, otherwise the **first**. If neither parses, the result is an error. If a candidate is malformed (for example three decimal places), the error is the money parser's own message.
- **Money parsing** reuses `parsePounds`, so `£1,200.50` and `3` work. A `+` immediately before the amount (`+2400`, or `+£2400`) is stripped before parsing and means **Income**. A `+` separated by a space (`+ 2400`) is not a marker. Without the marker the type is **Spend**.
- **Note:** the remaining tokens joined by single spaces. It may be empty (`3.50` alone). A note over 200 characters is rejected ("Note is too long").
- Examples: `coffee 3.50` → 350, "coffee", Spend. `3.50 coffee` → same. `+2400 salary` → 240000, "salary", Income. `2 coffee 3.50` → 350, note "2 coffee". `coffee` → error "Couldn't find an amount".

**`app/lib/noteMemory.ts`**
- `normaliseNote(note: string): string` — trim, lowercase, collapse runs of whitespace.
- `buildNoteIndex(transactions: Transaction[]): NoteIndex` — groups transactions by normalised note (skipping empty notes), each group ordered **most recent first** (by `date` descending, ties by `createdAt` descending).
- `categoryForNote(index: NoteIndex, note: string, type: TransactionType, categories: Category[]): string | null` — returns the `categoryId` of the most recent match whose category's type equals `categoryTypeFor(type)` **and that still exists in `categories`**. If none qualifies it returns `null`. An empty or blank note never matches.

**`app/hooks/useNoteHistory.ts`** — `useNoteHistory(opened: boolean): NoteIndex`. It calls `useTransactions(month, opened)` for `currentYearMonth()` and its two predecessors (`shiftMonth(-1)`, `shiftMonth(-2)`), and memoises `buildNoteIndex` over the concatenated data. The current-month call shares its query key with the sheet's chip-ranking call, so it is one request. It is **not** frozen: new entries feed the index immediately so add-another sessions learn as they go.

### 2. Sheet integration (`TransactionSheet.tsx`)

**Quick-add field (add mode only, hidden when editing).** A "Quick add" text input above Amount, placeholder `coffee 3.50`.

- **Amount stays autofocused** (A's behaviour is unchanged: numeric keypad on phones). Quick add is the first tab stop above it.
- **Enter** is intercepted (`preventDefault`) so the surrounding form does not submit. It parses the line.
  - **Success:** the fill **replaces** Amount (formatted as pounds), Type (per the line: `+` → Income, otherwise Spend, even if another type was selected), Note (opening the note field when non-empty), and Category (the recalled category with source `memory`, or none). It **keeps the date and date choice**. The quick-add line is cleared and any error is cleared.
  - **Focus after a successful fill:** if a category was recalled, focus goes to **Save & add another** (so a second Enter saves); otherwise to the **category chips** (Enter on a focused chip already submits, verified for A).
  - **Failure:** an inline error under the field shows the parser's message; the text stays; the error clears on the next keystroke. Nothing else changes.
- The field has a visible label, and its error is associated with it for screen readers.

**Category source.** The sheet tracks `categorySource: 'none' | 'memory' | 'user'` alongside `categoryId`.
- **Note typing** (the note field): recompute `categoryForNote` for the current note and type.
  - Found and source is not `user` → set the category, source `memory`.
  - Not found and source is `memory` → clear the category, source `none`.
  - Source `user` → never touched.
- **A chip click or a More… pick** sets source `user`.
- **Type change** clears the category (source `none`) as today, then re-runs the lookup for the new type.
- **Reset** (opening the sheet, or Save & add another) sets source `none` with no category.
- **Edit mode has no memory:** no lookup runs, so editing a note never rewrites an existing transaction's category.
- **Hint:** while the source is `memory`, a dimmed line under the chips reads "Suggested from your earlier '<note>'" (using the note as typed). It disappears when the user picks a category or the category clears.

**Duplicate (`template` prop).** `TransactionSheet` gains `template?: Transaction | null`. When the sheet opens in add mode with a template, it prefills amount, type, category (source `user`), and note (opening the note field when non-empty), sets the date to **today**, and leaves the title as "Add transaction". `editing` takes precedence if both are given (the route never sets both).

**`TransactionRow`** gains `onDuplicate?: (t: Transaction) => void` and a Duplicate item in its menu (with a copy icon), rendered only when the handler is provided. **`app/routes/transactions.tsx`** holds `duplicating: Transaction | null`; its sheet gets `template={duplicating}`, `opened={editing !== null || duplicating !== null}`, and an `onClose` that clears both.

## Files touched

| File | Change |
|---|---|
| `app/lib/quickAdd.ts` (+ test) | New: `parseQuickAdd` |
| `app/lib/noteMemory.ts` (+ test) | New: normalise, index, lookup |
| `app/hooks/useNoteHistory.ts` (+ test) | New: history hook |
| `app/components/transactions/TransactionSheet.tsx` (+ test) | Quick-add field, `categorySource`, memory pre-selection and hint, `template` prop, focus after fill |
| `app/components/transactions/CategoryChips.tsx` | Only if needed: a small ref or prop so the sheet can focus the chip group |
| `app/components/transactions/TransactionRow.tsx` | `onDuplicate` prop and menu item |
| `app/routes/transactions.tsx` (+ test) | `duplicating` state and sheet wiring; the search fix (`554adb3`) is already here |
| `docs/ROADMAP.md` | Status row for B |

No API, infra, auth or `SECURITY.md` control changes: matching, parsing and history all run in the browser over data the API already returns. The note is rendered as plain React text in the hint (never HTML). Existing server-side validation still applies to whatever is finally saved.

## Testing

- **`parseQuickAdd`:** either order; `+` for income (also with `£`); `£`, commas, whole numbers; amount only (empty note); note with extra spaces; `2 coffee 3.50`; no amount; three decimal places (money parser message); `+ 2400` (separated `+` is not a marker); note over 200 characters; blank input.
- **`noteMemory`:** normalisation (case, spaces); most recent wins (date, then `createdAt`); type mismatch skips to an older matching-type entry or returns null; deleted category skipped; empty note; empty history.
- **`useNoteHistory`:** requests exactly the three months; disabled while closed; index reflects new data.
- **Sheet:** Enter on the quick-add line fills the form and makes **no create call**; the form does not submit; the line clears; parse errors show and clear on typing; focus goes to Save & add another when recalled and to the chips otherwise; `+` sets Income and looks up an income category; the note field selects a category only on a full match; a user-picked category survives note edits; a `memory` category clears when the note stops matching; type change re-runs the lookup; edit mode never recalls; the hint appears and disappears; the template prefills with today's date and a `user` source.
- **Route:** Duplicate opens the sheet prefilled (extends `app/routes/__tests__/transactions.test.tsx`). **Row:** the menu item calls `onDuplicate`.
- **Browser:** a real-browser pass with the stubbed headless harness (Auth0 and `/api/*` stubbed): the quick-add line never POSTs, a recalled category selects, focus lands as designed, Duplicate opens prefilled, and the search box no longer crashes.
- `yarn typecheck` and `yarn test` must pass.

## Build order

Atomic, test-first commits on `feat/smart-prefill` (after the search fix `554adb3`):

1. `parseQuickAdd`
2. `noteMemory`
3. `useNoteHistory`
4. Duplicate: row menu, route wiring, sheet `template`
5. Memory pre-selection from the note field
6. The quick-add field and post-fill focus
7. Browser verification and docs

## Branching

`feat/smart-prefill` is branched from `feat/entry-sheet-rework` because B builds on A's sheet and A's PR (#29) is not merged. B's PR should target `feat/entry-sheet-rework` (stacked) or be retargeted to `main` once A merges.
