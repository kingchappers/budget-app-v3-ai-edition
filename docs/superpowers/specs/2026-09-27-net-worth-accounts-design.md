# Net worth and accounts: design

Sub-project **I**. It builds on F1 (category groups), F2 (pots), G (polish and hardening, PR #39, merged) and H (spending insights, PR #40, in progress), so its branch, `feat/net-worth-accounts`, starts from `feat/spending-insights`. It should be rebased or retargeted once H merges. Later sub-project: J offline entry queue.

## Intent

Track what the owner actually holds — real bank, investment and savings accounts, and any debts — separately from the budget's categories and pots, and show net worth over time on the Insights page. Automatic balance fetching from a bank or broker is not realistic for a self-hosted hobby project (see `docs/DECISIONS.md`'s 2026-09-18 entry on bank sync): every balance is entered by hand, whenever the owner checks it.

## Decisions

| Question | Decision |
|----------|----------|
| Relationship to existing data | Accounts are new and separate from categories, transactions and pots. Pots track money earmarked inside the budget; accounts track money actually held. |
| Balance history | Dated entries, not monthly snapshots: `{date, pence}`, added whenever the owner updates an account, as often or rarely as they like. |
| Assets and liabilities | Every account is `ASSET` or `LIABILITY`. A liability's balance is entered as a positive "amount owed"; net worth subtracts it. |
| Account types | A small fixed list, not user-defined groups: `CASH`, `SAVINGS`, `INVESTMENT` for an asset; `CREDIT_CARD`, `LOAN` for a liability. |
| Storage | Balance history is a small list embedded on the account item (the same pattern F2 uses for a pot's auto-contribute list), not a separate item per entry — the expected volume (occasional manual updates) never approaches needing pagination. |
| Same-date updates | Appending an entry for a date that already has one replaces it, rather than creating a duplicate point. Any other date is inserted in date order. The same rule F2 already uses for a pot's auto-contribute list. |
| Navigation | A fourth item, Accounts, in the More sheet H introduces, after Categories, Recurring and Insights. |
| Net worth's home | A new section on the Insights page (H), separate from the existing summary row: net worth is a stock figure (what you have right now), while the summary row is entirely flow figures (income, spend, saved, net) for the chosen period. Mixing them would blur two different ideas. |
| Charts | Reuse `@mantine/charts` (introduced by H), not a fourth chart technology. |

**Not doing (on purpose):** automatic balance fetching from any bank or broker; multi-currency (everything is £, like the rest of the app); attaching accounts to transactions (spec option 3 from the brainstorm — a bigger change than this sub-project needs); a "liquid vs illiquid" breakdown beyond the asset/liability split and per-type icons.

## 1. Data model and API

**Account item**, one per account: `{ accountId, name, kind: 'ASSET' | 'LIABILITY', type: AccountType, balances: BalanceEntry[], createdAt }`, where `AccountType` is `'CASH' | 'SAVINGS' | 'INVESTMENT'` for an asset or `'CREDIT_CARD' | 'LOAN'` for a liability, and `BalanceEntry` is `{ date: string; pence: number }` (`date` is `YYYY-MM-DD`, `pence` a positive integer capped at `MAX_AMOUNT_PENCE`). `balances` is capped at 500 entries.

**Endpoints**, all behind the existing JWT check and scoped to the caller's partition, like every other route:

- `GET /api/accounts` → `{ accounts: Account[] }`, every account with its full balance history. No date range or pagination: the dataset is small by construction.
- `POST /api/accounts` → body `{ name, kind, type }` → `201 { account }`. Validates `type` matches `kind` (IO-01: reject `CREDIT_CARD` on an `ASSET`, `CASH` on a `LIABILITY`, and so on). `balances` starts empty.
- `PUT /api/accounts/{accountId}` → body `{ name, type }` → `{ account }`. Renames and/or changes `type` (within the same `kind` — `kind` itself cannot change after creation; deleting and recreating is the path if it needs to).
- `POST /api/accounts/{accountId}/balances` → body `{ date, pence }` → `{ account }`. Validates `date` format and that it is not more than one day ahead of the server's date (the same one-sided leniency F2 gives `month` inputs, to tolerate client/server clock drift), and `pence` as a positive integer at most `MAX_AMOUNT_PENCE`. Applies the replace-same-date-or-insert-in-order rule from the Decisions table. Returns 400 if the entry would push `balances` over 500.
- `DELETE /api/accounts/{accountId}` → `204`, removes the account and its history.

**Balance and net worth logic**, pure functions in `src/api` (server) mirrored in `app/lib` (client), following F2's `autoAmountFor` pattern exactly:

- `balanceAsOf(entries: BalanceEntry[], date: string): number` — the `pence` of the last entry at or before `date`, or 0 if none.
- `netWorthAsOf(accounts: Account[], date: string): number` — sum of every `ASSET`'s `balanceAsOf` minus the sum of every `LIABILITY`'s `balanceAsOf`.

## 2. What changes on screen

**Accounts page** (`/accounts`), the fourth More-sheet item.

- A totals line at the top: total assets, total liabilities, net worth, all as of today.
- Two sections, Assets and Liabilities (omitted if empty), each listing its accounts: an icon for the type, the name, and the current balance.
- Each row has an **Update** button opening a small form (date, defaulting to today; amount) that posts one new balance entry — deliberately smaller than the transaction entry sheet, since this isn't a transaction.
- Tapping the row (not Update) opens a history sheet: a `@mantine/charts` line chart of the balance over time, and a table of every entry, newest first.
- A "New account" form (name, Asset/Liability, then a type select scoped to that choice).
- Deleting an account opens a confirmation dialog first, the same pattern G added for recurring templates.
- No month picker on this page: an account's shown balance is always as of today. Only the history sheet is a timeline.

**Insights page** (H): a new "Net worth" section after Pots.

- Current net worth, and its change since the start of the chosen span (an up/down figure, the same style as the summary row's percentage changes).
- A line chart of net worth at the end of each month in the span, from a new `useAccounts()` hook (fetched once, independent of the span) and `netWorthAsOf` evaluated at each month's end.

**Navigation**: `MoreSheet`'s `MORE_ITEMS` gains `{ to: '/accounts', label: 'Accounts', Icon: IconWallet }` after Insights.

## 3. Testing, verification and rollout

**Automated tests**

- API: create validates `type` against `kind` and rejects a `kind` change on update; the balances endpoint validates date format, the one-day-ahead leniency, the amount cap, the 500-entry cap, the replace-same-date rule, and insertion in date order for a backdated entry; every request scoped to the caller, never another user's accounts.
- Pure functions: `balanceAsOf`/`netWorthAsOf` — no entries (zero), a date before the first entry (zero), the replace-same-date rule, and a month where an account has no update yet that month (its last known balance carries forward).
- Components: the Accounts page's grouping and totals, the Update form, the history sheet and its chart, the new-account form, and the delete confirmation dialog.
- Insights: the Net worth section renders its figure, its change, and its trend line, using the chart-container-size stub H's plan already adds to `vitest.setup.ts` — no new test infrastructure needed.
- Existing suites stay green; `yarn typecheck` is clean.

**Verification the executing agent runs:** the stubbed headless-browser pass at 390px and 1280px (the recipe recorded from F1/F2/G/H): the Accounts page (grouping, Update form, history sheet with a real chart, create and delete), the More sheet's fourth item, and the Net worth section on Insights.

**Rollout:** a code deploy with no infra, IAM or dependency change (`@mantine/charts` already lands with H). Rollback is a revert.

## Global constraints (for the plan)

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for every new input); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- Money values are always integer pence internally; `MAX_AMOUNT_PENCE` (from G) is the shared cap for every balance entry.
- This plan depends on H's `MoreSheet`/`MORE_ITEMS`, `@mantine/charts` dependency, and the Insights page's span/period machinery already existing on the branch it starts from.
- Update `docs/ROADMAP.md`: add I's status and follow-ups (and mark H merged, once it has, as a small housekeeping edit if I's PR lands after H's).

## Follow-ups

- Attaching accounts to transactions so balances are derived rather than entered (a bigger change, deliberately deferred).
- Multi-currency.
- A "liquid vs illiquid" or per-type breakdown beyond the asset/liability split.
- Reminders to update an account that hasn't been touched in a while.
