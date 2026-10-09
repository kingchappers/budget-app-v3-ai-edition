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
| F2 | Savings and sinking-fund pots | Merged ([PR #38](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/38)). Spec: `superpowers/specs/2026-09-25-savings-pots-design.md`, plan: `superpowers/plans/2026-09-25-savings-pots.md` |
| G | Polish and hardening | Merged ([PR #39](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/39)). Spec: `superpowers/specs/2026-09-26-polish-hardening-design.md`, plan: `superpowers/plans/2026-09-26-polish-hardening.md` |
| H | Spending insights | Merged ([PR #40](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/40)). Spec: `superpowers/specs/2026-09-27-spending-insights-design.md`, plan: `superpowers/plans/2026-09-27-spending-insights.md` |
| I | Net worth and accounts | Merged ([PR #41](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/41)). Spec: `superpowers/specs/2026-09-27-net-worth-accounts-design.md`, plan: `superpowers/plans/2026-09-27-net-worth-accounts.md` |
| J | Offline entry queue | Implemented on `feat/offline-queue` ([PR #43](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/43)). Spec: `superpowers/specs/2026-09-27-offline-entry-queue-design.md`, plan: `superpowers/plans/2026-09-27-offline-entry-queue.md` |

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
  - Offline launch (an offline entry queue, once the app is already open, is covered by J).
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
  - Missing tests for a few edges: pots invalidation from the update, reassign and category hooks, the Home error branch, the month passed to `usePots`, and the balance-above-goal text.
  - The trend line stroke is clipped at the svg edges.
  - A literal `null` request body to the pots PUT gives a non-400 error (the same pattern exists in other handlers).
  - Any F1 targets already set on categories that are now pots (Holidays, Gifts and so on) are no longer shown or editable, because Targets covers spending categories only; clear them before deploying.
  - The pots settings PUT is a read-modify-write with no conditional put, so two tabs saving at once could lose an auto-contribute entry (acceptable for one user).
  - The Home Pots section appears after the rest of Home has loaded, causing a small layout shift; a skeleton would fix it.
  - On the Pots page the floating + button covers the Set aside button of a row that scrolls under it (the same fixed-button overlap as elsewhere in the app); scrolling to the end clears it.
  - On a 390px screen the history sheet's month table scrolls sideways (the Closing column is off screen) with no hint, and the sheet is taller than the screen so the settings need scrolling. The trend line's end points are half-clipped at the edge of its box.
  - The client's local month and the server's UTC month can differ for about an hour around midnight on the 1st, so Home's "next month" could hit the API's month bound for that hour.

## G: Polish and hardening

Implemented on `feat/polish-hardening`. Spec: `superpowers/specs/2026-09-26-polish-hardening-design.md`, plan: `superpowers/plans/2026-09-26-polish-hardening.md`.

- **Built:** category recall when note history loads late; mobile bottom sheets sized to their content; a £10,000,000 amount cap on the API and client; the static handler no longer serves `/index.js` and sends a report-only Content-Security-Policy built from the page's inline script hashes and the Auth0 tenant from `csp.json`; Undo after a Due-card Edit restores the item; a confirmation dialog before deleting a recurring item.
- **Decisions:** the CSP ships report-only with the header name as one constant; the Auth0 domain is read from `VITE_AUTH0_DOMAIN` at build time; delete confirms instead of offering Undo; the floating + button overlap was not changed because `AppShell.Main` already has bottom padding.
- **Follow-ups:**
  - Switch the CSP to enforcing once the browser console is quiet after a deploy.
  - Grouped selects in the recurring form, the Transactions filter and the reassign dialog; group editing; Home emoji (logged under F1).
  - The bottom-sheet test (`sizes the bottom drawer to its content instead of filling the screen`) passed in jsdom even before the fix, because jsdom returns CSS's initial value (`height: auto`) for an element with no inline height rather than reproducing the full-height bug; a real-browser pass (Task 7) is what actually verified this one.
  - Task 7's real-browser pass found no CSP violations, in either report-only or enforcing mode, and confirmed both the Add sheet and a pot's history sheet size to content at 390px (each hit the 90dvh cap because their content is genuinely that tall, which is the designed behaviour, not the pre-fix bug).

## H: Spending insights

Implemented on `feat/spending-insights`. Spec: `superpowers/specs/2026-09-27-spending-insights-design.md`, plan: `superpowers/plans/2026-09-27-spending-insights.md`.

- **Built:** a `/insights` page with a paged, comparable span (This month / 3 / 6 / 12 months) showing a summary row, spending by group with a drill-down, a monthly trend, biggest movers, target adherence, and pot balances over time; a new `GET /api/transactions/range` endpoint; a "More" bottom tab replacing the direct Categories tab, opening a sheet for Categories, Recurring and Insights; `@mantine/charts`/`recharts` added as pinned dependencies.
- **Decisions:** the range endpoint returns raw transactions and every total is computed client-side in `app/lib/insights.ts`; paging moves by the whole span length so the current and previous periods are always adjacent; the page is never shown for a month later than the current one.
- **Follow-ups:**
  - A free date range instead of fixed-length paging.
  - A stored monthly summary if the range read (shared with pots) gets slow.
  - Drill-down past a group into a single transaction.
  - Exporting the page.
  - **Fixed post-review:** Task 7's real-browser pass found that the Later arrow's guard (`canGoNewer`) only checked whether the anchor was before the current month, not whether the anchor plus the *current* span length would land in the future — paging Earlier, widening the span, then paging Later could push the anchor months into the future and lock the page into a permanent error state. The final whole-branch review also found: the summary row's change indicator coloured every increase green regardless of whether that direction was good for the figure, and divided by a negative previous value in a way that could invert the sign of a genuine improvement; pot trend charts had no name label and drew a pot's entire history instead of clipping to the chosen span; and spend on a removed or ungrouped category vanished from "Spending by group" instead of appearing under Other, so the group bars didn't add up to the "Spent" total. All four are fixed, with tests pinning each one.
## I: Net worth and accounts

Implemented on `feat/net-worth-accounts`. Spec: `superpowers/specs/2026-09-27-net-worth-accounts-design.md`, plan: `superpowers/plans/2026-09-27-net-worth-accounts.md`.

- **Built:** an accounts API (`GET/POST /api/accounts`, `PUT/DELETE /api/accounts/{accountId}`, `POST /api/accounts/{accountId}/balances`) storing dated balance entries per account; an Accounts page (More sheet) listing assets and liabilities with totals, per-account history and a trend chart, and hand-entered balance updates; a Net worth section on the Insights page.
- **Decisions:** balances are manually entered, dated points, never auto-fetched (see `docs/DECISIONS.md`'s bank-sync entry); every account is a fixed Asset or Liability, with a small fixed type list per kind; a liability is entered as a positive amount owed and subtracted when computing net worth; net worth is a stock figure on its own section, not folded into the flow-based summary row.
- **Follow-ups:**
  - Attaching accounts to transactions so balances are derived rather than entered.
  - Multi-currency.
  - A finer breakdown than the asset/liability split.
  - Reminders to update a stale account.
  - `openAccount`/`updatingAccount` on the Accounts page hold stale data once `accounts` refetches after a mutation (the object reference from the list at open time); acceptable since the sheet closes on a successful update, but worth fixing properly later.
  - **Fixed post-review:** the net worth change figure measured from the end of the span's first month instead of before it, so "This month" always read +£0.00 regardless of what happened; the update-balance form didn't reset between accounts, so updating one account's balance could leave that amount sitting in the form when a different account's sheet was opened next; the API returned raw DynamoDB items (leaking `PK`/`SK`) instead of a clean shape; an out-of-range date such as `2026-02-31` was accepted because `new Date` silently rolls it over instead of rejecting it; and a £0 or negative balance was rejected everywhere, so paying off a credit card or closing an account left its last non-zero balance stuck in net worth forever — a new `parseBalance` (client) and a relaxed `isValidPence` (server) now allow `pence >= 0` and negative (an overdrawn account), while transaction amounts are unaffected and still require `> 0`. All fixed, with tests pinning each one.

## J: Offline entry queue

Implemented on `feat/offline-queue`. Spec: `superpowers/specs/2026-09-27-offline-entry-queue-design.md`, plan: `superpowers/plans/2026-09-27-offline-entry-queue.md`.

- **Built:**
  - Client-generated transaction ids from the start, replacing the old temp-id swap.
  - An IndexedDB-backed offline queue for new-transaction creates, with a reentrancy-guarded flush.
  - Automatic sync on `online`, tab focus and app launch, plus a manual "Sync now" button.
  - A pending badge on queued rows and an offline-queue banner in the UI.
- **Fixed post-review (a real redesign, not point fixes):**
  - **Critical:** TanStack Query's default `networkMode: 'online'` paused a mutation while the browser reported itself offline instead of letting it fail, so the rejection handler that queues an entry never ran — a create attempted with no signal was silently lost the moment the app closed. `useCreateTransaction` now sets `networkMode: 'always'`.
  - Pending rows were one-off inserts into the transaction query cache, which any later refetch (a second create, a focus refetch, an invalidation) silently wiped while the banner still claimed they were waiting. Replaced with a live overlay: `useTransactions` merges a reactive pending-entries map onto the server's rows on every read, so a pending row survives any refetch instead of depending on a cache write nothing else knows about.
  - A permanently-failing entry (its category deleted, say) could never leave the queue — added a "Discard" action on a pending row.
  - Edit and Delete worked on a pending row, which would resurrect a discarded entry or silently revert an edit on the next sync — both are hidden while pending; only Discard is offered.
  - Undo's real window was milliseconds for a queued entry, because the Saved toast was hidden the instant the request rejected. It now stays open (relabelled "Saved offline") through the queue transition, giving Undo the same window as an ordinary save.
  - The queue wasn't scoped per user: on a shared device, a second account signing in could flush the first account's unsent entries into its own. Every entry now carries the Auth0 sub that queued it; flush and hydration only ever touch entries for the current user, and signing out clears the reactive pending state (never the durable IndexedDB queue, which stays correctly tagged for whoever signs back in).
  - A genuine race let an already-undone entry still reach the server if a flush ran between its enqueue and its discard; closed by checking "already undone" before ever enqueueing, rather than enqueueing and immediately discarding again.
- **Fixed in a follow-up scoped re-review of the redesign above:**
  - `onSettled` was awaiting the month's refetch even on the failure path, which (since TanStack awaits `onSettled` before a rejected `mutateAsync` settles) delayed reaching `useSaveWithUndo`'s decision to queue an entry by a full failed-fetch-plus-retry cycle — reopening a narrower version of the original Critical's silent-loss window on a flaky-but-technically-online connection. Now only the success path awaits its invalidation; the failure path fires it without waiting.
  - `flushQueue` sent a stale snapshot: Discard or Undo on an entry the flush hadn't reached yet had no effect, since the server's create is an unconditional upsert. A `wasDiscarded` in-memory check (populated by `discardQueuedEntry`) is consulted right before each send.
  - Every ordinary *online* save also spent a moment in the pending map, which briefly showed the banner, the pending badge and a Discard-only menu on a completely normal save. Pending entries now carry `queued: boolean`; only a durably-queued (actually offline) entry counts toward any of the three.
  - `hydrateOnce` replaced the whole pending map instead of merging onto it, and had no error handling; both fixed.
- **Follow-ups:**
  - Queuing edits and deletes made offline, with a conflict-resolution story for data that changed server-side in the meantime.
  - A full offline app shell (service worker, cold-launch support) if that ever becomes worth the cost.
  - The "Sync now" button test only proves a flush happens, not that the click itself caused one (the automatic launch flush already would have) — worth strengthening later.
  - Task 8's browser-verification pass (Playwright, offline simulation) could not be completed in this environment — no headless Auth0 login stub exists in this repo yet — so the queue/banner/sync flow, including this fix wave, is unverified in a real browser. Remains outstanding, and is the check that would have caught the Critical finding above in the first place.

## Self-hosting

Runs the app as a single container alongside the AWS deployment, so people can host their own copy (SQLite on a volume, built-in login). Sub-projects have names rather than letters from here on. Each gets its own brainstorm → spec → plan → PR.

| Sub-project | What it delivers | Status |
|---|---|---|
| Storage Interface | A backend-neutral `Store` interface with DynamoDB and SQLite implementations, a shared contract suite, every handler migrated, and per-user export/import. No user-visible change. | Merged (PR #85); the contract suite passes against DynamoDB Local in CI. Spec: `superpowers/specs/2026-10-06-storage-interface-design.md`, plan: `superpowers/plans/2026-10-06-storage-interface.md` |
| Portable Auth | An auth-provider abstraction in the API and frontend, runtime config instead of build-time `VITE_AUTH0_*`, Auth0 kept, and a built-in single-account login (first-run setup, signed sessions, CLI password reset). | Not started |
| Container Image | One Node server for the API and static files, an in-process push scheduler, a multi-arch Dockerfile, GHCR publishing, a compose example, a healthcheck, and docs for HTTPS, upgrades and backups. Needs both of the above. | Not started |

Later, separate from the three above: Demo Mode (a public try-it instance with fake data) and Generic OIDC login.

## Deliberately excluded

Receipt scanning/OCR (ongoing cost, slow to build), AI categorisation (B's category memory covers most of the benefit), and number-key chip shortcuts (collide with typing the amount).
