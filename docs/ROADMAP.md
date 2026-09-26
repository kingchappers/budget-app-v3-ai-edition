# Roadmap: Fast Transaction Entry

Bank sync was dropped (see `DECISIONS.md`), so manual entry is the core interaction. The work is split into sub-projects A to J (E was dropped). Each gets its own brainstorm → spec → plan → PR. Later ones build on earlier ones.

| # | Sub-project | Status |
|---|---|---|
| A | Entry sheet rework | Implemented on `feat/entry-sheet-rework` ([PR #29](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/29)). Spec: `superpowers/specs/2026-09-18-entry-sheet-rework-design.md`, plan: `superpowers/plans/2026-09-18-entry-sheet-rework.md` |
| B | Smart prefill | Implemented on `feat/smart-prefill` ([PR #30](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/30)). Spec: `superpowers/specs/2026-09-19-smart-prefill-design.md`, plan: `superpowers/plans/2026-09-19-smart-prefill.md` |
| C | Recurring templates | Implemented on `feat/recurring-templates` ([PR #32](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/32)). Spec: `superpowers/specs/2026-09-19-recurring-templates-design.md`, plan: `superpowers/plans/2026-09-20-recurring-templates.md` |
| D | PWA and add shortcut | Merged ([PR #36](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/36)). Spec: `superpowers/specs/2026-09-23-pwa-add-shortcut-design.md`, plan: `superpowers/plans/2026-09-23-pwa-add-shortcut.md` |
| E | CSV/OFX import | Dropped: manual CSV/OFX import was judged clunky and would not be used. |
| F1 | Category groups and YNAB defaults | Implemented on `feat/category-groups` ([PR #37](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/37)). Spec: `superpowers/specs/2026-09-24-category-groups-design.md`, plan: `superpowers/plans/2026-09-24-category-groups.md` |
| F2 | Savings and sinking-fund pots | Implemented on `feat/savings-pots` (PR pending). Spec: `superpowers/specs/2026-09-25-savings-pots-design.md`, plan: `superpowers/plans/2026-09-25-savings-pots.md` |
| G | Polish and hardening pass | Not started |
| H | Spending insights | Not started (after F) |
| I | Net worth and accounts | Not started |
| J | Offline entry queue | Not started |

## B: Smart prefill

Implemented on `feat/smart-prefill`. Spec: `superpowers/specs/2026-09-19-smart-prefill-design.md`, plan: `superpowers/plans/2026-09-19-smart-prefill.md`.

- **Built:**
  - A Quick add line atop the add sheet. Enter only fills the form (amount, type, note, category); it never saves.
  - Category memory keyed on the note, looked up over the last three months of cached transactions. Match is exact, ignoring case and spaces.
  - Duplicate in the row menu opens the add sheet prefilled and dated today.
  - An example line under Quick add and a header "?" tips modal explaining the options.
- **Decisions:** memory is a client-side lookup over cached months (no new API read); match key is the whole note, not a prefix; quick add fills the sheet rather than bypassing it; Duplicate is dated today, not the original date.
- **Follow-ups:**
  - History that loads after a full note is typed gets no recall until the next keystroke (re-run the lookup when the note index changes).
  - IME composition guard on the Quick add Enter.
  - The chip-focus effect should fall back to Amount when no chip exists.
  - Enter on an empty Quick add shows "Couldn't find an amount".
  - A latent guard for an empty category id from the chip group.
  - Sheet tests should key mock history by month and render under StrictMode.
  - Pre-existing and separate: focus stays on the row's Actions button after Edit/Duplicate, so Tab walks rows behind the modal.

## C: Recurring templates

Implemented on `feat/recurring-templates`. Spec: `superpowers/specs/2026-09-19-recurring-templates-design.md`, plan: `superpowers/plans/2026-09-20-recurring-templates.md`.

- **Built:**
  - Monthly recurring templates stored as `RECUR#` items, with five API routes (list, create, update, delete, mark handled) and category reassign moving them. No infra, IAM or dependency changes.
  - A Due card at the top of Home: Add (saved on the due date, with Undo), Edit (the add sheet prefilled, then marked handled), Skip (with Undo). Nothing is created automatically.
  - A Recurring page (list, edit, delete, new) linked from the desktop sidebar and from Home, and a "Repeat monthly" action in a transaction's row menu.
- **Decisions:** the due logic is client-side and pure; "handled" means a marker at or past the month, or a matching transaction (type and category, plus the note when the template has one); monthly on a day only, clamped to short months; per-template lead days (default 3); added transactions are dated on the due date.
- **Follow-ups:**
  - Weekly and yearly cadence, and an end date or pause for a template.
  - Deleting a category does not check references; templates left pointing at one are flagged on the Recurring page and skipped on Home.
  - A hand-entered transaction only clears a due item when its type, category and (if set) note match the template.
  - Pressing Undo on the saved toast after a Due-card Edit deletes the transaction but leaves the item marked handled, so the row does not return (Undo after Add does return it).
  - On a 390px screen the Due card truncates its "Due today · 20 Sep" line when the note or amount is wide; the date could move to its own line.
  - Recurring page Delete is immediate, with no confirmation or Undo, and shows the raw HTTP status text on failure.
  - The categories page says "Nothing was changed" when the reassign succeeded and only the delete failed (pre-existing; templates now move with the reassign).
  - Home's Due card and "Manage recurring" link sit behind Home's own loading and error gate.
  - Tidy-ups: `pad()` is duplicated in `months.ts` and `recurring.ts`; `TransactionRow` has its own outgoing-type set instead of `formatSignedPence`; `validateRecurringInput` repeats blocks of `validateTransactionInput`; `amount` has no upper bound in either handler (whole-app).
  - Pre-existing, seen during verification: on mobile every bottom sheet renders full height with its content at the top, and the floating + button overlaps the last Recent row's amount at 390px.

## D: PWA and add shortcut

Implemented on `feat/pwa-add-shortcut`. Spec: `superpowers/specs/2026-09-23-pwa-add-shortcut-design.md`, plan: `superpowers/plans/2026-09-23-pwa-add-shortcut.md`.

- **Built:**
  - A web manifest, icons and iOS/Android install metadata, so the app installs from `budget.scgrid.xyz` as a standalone window.
  - An Android long-press "Add transaction" shortcut (`/?add=1`), and an "Open Add sheet on launch" toggle in the avatar menu for the installed app (works on iPhone too).
  - The static Lambda handler rewritten as a typed, tested file: binary files served as base64, per-type `Cache-Control` (hashed assets immutable), 404 for missing files, hardened path checks.
- **Decisions:** installable only, no service worker; launch behaviour is a per-device toggle rather than a second icon; no infra change (the static handler stays on the Lambda).
- **Follow-ups:**
  - Confirm on a real iPhone whether an Auth0 login stays inside the installed app.
  - Offline launch and an offline entry queue (see Later ideas).
  - Replace the first-draft icon with a designed one (swap `public/icons/icon.svg` and regenerate the PNGs).
  - The static Lambda handler is served publicly at `/index.js`, because it lives inside the served `build/client` directory (pre-existing, low impact since the repo is public). Move the entry file out of the served root or answer that path with a 404.
  - Static responses carry no Content-Security-Policy (SECURITY.md WEB-A05). A CSP needs the Google Fonts and Auth0 origins allowed, so it was left out of D on purpose.

## E: CSV/OFX import (dropped)

Dropped on 2026-09-24: manual CSV/OFX import was judged a clunky experience the owner would not use. Automatic bank sync is covered in `DECISIONS.md`.

## F1: Category groups and YNAB defaults

Implemented on `feat/category-groups`. Spec: `superpowers/specs/2026-09-24-category-groups-design.md`, plan: `superpowers/plans/2026-09-24-category-groups.md`.

- **Built:**
  - Fixed category groups and the owner's YNAB default categories (21 defaults, including the 4 income ones).
  - A `CategoryIcon` component rendering emoji icons.
  - Grouped display in the category picker, the Categories page, Targets and Home.
- **Decisions:** no remap script, because the test data was deleted; Saving & Investment stay `INVESTMENT` type until F2 pots; custom categories default their group by type.
- **Follow-ups:**
  - Deleting a custom category leaves its target orphaned.
  - User-created groups.
  - Old default ids such as `cat-food` are removed, so anything still referencing them shows as an unknown category.
  - The recurring form, the Transactions filter and the reassign dialog still list categories flat, with no groups or emoji. Extract a shared `categorySelectData` helper from `CategoryChips` and reuse it.
  - Home progress rows show no emoji.
  - No way to change a category's group after creating it, so custom categories made before groups sit under "Other" until deleted and recreated.
  - The Income "More…" chip opens a duplicate list of the same categories.
  - At 1280px the floating + button covers the Income total at the bottom of Home.
  - Emoji are read aloud in chip and option names, because `categoryLabel` puts them into the accessible name.
  - 🛜 (Phone and Internet) is a Unicode 15 emoji and may render as a blank box on older phones; swap it for 📶 if so.
  - `isEmojiIcon` misses flag and keycap emoji, which matters only if users can set icons later.

## F2: Savings and sinking-fund pots

Implemented on `feat/savings-pots`. Spec: `superpowers/specs/2026-09-25-savings-pots-design.md`, plan: `superpowers/plans/2026-09-25-savings-pots.md`.

- **Built:**
  - Pot categories (Sinking Funds and Saving & Investment) with a carried-over balance.
  - Spend, Set aside and Take out entry types, replacing Invest in/out.
  - Optional monthly and goal amounts per pot, and derived auto-contribute.
  - `GET /api/pots` and `PUT /api/pots/{categoryId}`. No infra, IAM or dependency changes.
  - A Pots page with a history sheet and trend line, and a Pots section on Home.
- **Decisions:** pots are a category type (`POT`) and the old investment types are removed with no migration; the balance is derived on demand from the full history, so nothing stored can drift; auto-contribute is a list of `{ from, amount }` entries, not scheduled writes; entries dated after the month being viewed are excluded; negative balances are allowed and flagged; a custom pot with no group defaults to Sinking Funds; Home's Pots section follows its month selector.
- **Follow-ups:**
  - A quick-add syntax for Set aside.
  - A stored monthly summary if `GET /api/pots` gets slow.
  - The transaction API should check category type against entry type.
  - Pots spanning several categories.
  - Deleting a custom category leaves its pot settings orphaned.
  - Net worth and account balances (I).
  - The Home pots section and the Pots page duplicate a small `formatBalance` helper.
  - The pot history sheet has no tests for a few edges: pots invalidation from the update, reassign and category hooks, the error branch on Home, and the month passed to `usePots`.
  - The trend line stroke is clipped at the svg edges.
  - A literal `null` request body to the pots PUT gives a non-400 error (the same pattern exists in other handlers).

## Later ideas

- **Offline entry queue:** enter transactions with no signal and sync later. Needs a service worker, a persistent queue, idempotent creates and token refresh while offline. Tracked as sub-project J.

## Deliberately excluded

Receipt scanning/OCR (ongoing cost, slow to build), AI categorisation (B's category memory covers most of the benefit), and number-key chip shortcuts (collide with typing the amount).
