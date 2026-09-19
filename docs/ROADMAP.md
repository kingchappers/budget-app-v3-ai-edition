# Roadmap: Fast Transaction Entry

Bank sync was dropped (see `DECISIONS.md`), so manual entry is the core interaction. The work is split into five sub-projects. Each gets its own brainstorm → spec → plan → PR, in this order. Later ones build on earlier ones.

| # | Sub-project | Status |
|---|---|---|
| A | Entry sheet rework | Implemented on `feat/entry-sheet-rework` (PR pending). Spec: `superpowers/specs/2026-09-18-entry-sheet-rework-design.md`, plan: `superpowers/plans/2026-09-18-entry-sheet-rework.md` |
| B | Smart prefill | Not started |
| C | Recurring templates | Not started |
| D | PWA and add shortcut | Not started |
| E | CSV/OFX import | Not started |

## B: Smart prefill (next after A)

Category memory, duplicate from a row, one-line quick add.

- **Builds on A:** chips and the sheet form. Category memory extends `topCategories`/pre-selection; quick add opens or bypasses the sheet.
- **Open questions:**
  - Memory needs history beyond the current month. Does that mean a new API read (for example, last 90 days of description → category), or a client-side lookup over several cached months?
  - Match key: exact description, case-insensitive, or prefix?
  - Quick-add grammar: `coffee 3.50`, `3.50 coffee`, `+2400 salary` for income. What happens when no category matches: open the sheet with what was parsed, or ask?
  - Duplicate: dated today, or keep the original date?
- **Security:** any new API read follows IO-01 validation.

## C: Recurring templates

One-tap "Salary £2,400, usually around the 28th. Add?" on Home, mainly for income, also rent and subscriptions.

- **First step:** brainstorm, as this is the biggest design in the set. It adds a data model, API routes and infra permissions.
- **Open questions:**
  - How recurrence is defined (monthly on a day, weekly) and how short months are handled (31st).
  - Whether a prompt only suggests (recommended, one tap to confirm) or auto-creates.
  - How templates are stored (a new DynamoDB item type alongside transactions).
  - How a template is created: from a saved transaction ("Repeat monthly"), or a dedicated screen.
- **Security:** new routes need JWT validation (AUTH-01), input validation (IO-01) and least-privilege IAM (INFRA-01).

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
