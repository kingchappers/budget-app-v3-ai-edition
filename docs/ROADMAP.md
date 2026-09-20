# Roadmap: Fast Transaction Entry

Bank sync was dropped (see `DECISIONS.md`), so manual entry is the core interaction. The work is split into five sub-projects. Each gets its own brainstorm → spec → plan → PR, in this order. Later ones build on earlier ones.

| # | Sub-project | Status |
|---|---|---|
| A | Entry sheet rework | Implemented on `feat/entry-sheet-rework` ([PR #29](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/29)). Spec: `superpowers/specs/2026-09-18-entry-sheet-rework-design.md`, plan: `superpowers/plans/2026-09-18-entry-sheet-rework.md` |
| B | Smart prefill | Implemented on `feat/smart-prefill` ([PR #30](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/30)). Spec: `superpowers/specs/2026-09-19-smart-prefill-design.md`, plan: `superpowers/plans/2026-09-19-smart-prefill.md` |
| C | Recurring templates | Implemented on `feat/recurring-templates` (PR pending). Spec: `superpowers/specs/2026-09-19-recurring-templates-design.md`, plan: `superpowers/plans/2026-09-20-recurring-templates.md` |
| D | PWA and add shortcut | Not started |
| E | CSV/OFX import | Not started |

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

## D: PWA and add shortcut

Installable app with a shortcut that opens straight into the entry sheet.

- **Builds on A:** the sheet is opened by a query param or route, for example `/?add=1`.
- **Open questions:**
  - Service worker scope and caching, given the static Lambda behind API Gateway.
  - Auth0 refresh-token behaviour in an installed PWA (the app uses localStorage plus rotating refresh tokens).
  - Platform support: iOS may not support manifest app shortcuts, so verify before promising it. A home-screen icon that opens `/?add=1` is the fallback.

## E: CSV/OFX import

Bulk import from bank statement exports. `DECISIONS.md` already names this as the reasonable middle ground for the lack of bank sync.

- **Builds on B:** category memory can pre-categorise imported rows.
- **Open questions:**
  - CSV first, OFX later? Column mapping UI versus fixed presets for common UK banks.
  - Duplicate detection (for example date + amount + description) so re-importing an overlapping statement is safe.
  - Sign conventions and how they map to the four transaction types.
  - Payload limits: parse client-side and post in batches rather than uploading a file to the API.
  - A preview-and-confirm step before anything is written.
- **Security:** batch endpoint needs strict validation and size limits (IO-01).

## Deliberately excluded

Receipt scanning/OCR (ongoing cost, slow to build), AI categorisation (B's category memory covers most of the benefit), and number-key chip shortcuts (collide with typing the amount).
