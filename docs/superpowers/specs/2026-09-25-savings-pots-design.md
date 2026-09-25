# Savings and sinking-fund pots: design

Sub-project **F2**. It builds on F1 (category groups, `docs/superpowers/specs/2026-09-24-category-groups-design.md`, PR #37), so its branch starts from `feat/category-groups`. Later sub-projects: G polish and hardening, H spending insights, I net worth and accounts, J offline entry queue.

## Intent

The owner wants to see how much they have reserved in each savings or sinking-fund bucket, and how that has changed over time. Money set aside for something (Emergency fund, Holidays, Home maintenance) should carry over from month to month, and spending on that thing should draw the reserve down. Bills and Everyday Spending stay as monthly buckets that reset.

## Decisions

| Question | Decision |
|----------|----------|
| Which categories are pots | Categories in the Saving & Investment and Sinking Funds groups. Bills and Everyday Spending are unchanged. |
| Entry types | **Spend** (draws a pot's balance down when made against a pot category), **Set aside** (adds), **Take out** (moves money back to general money). |
| Approach | Pots are a category type: `CategoryType` `INVESTMENT` becomes `POT`, and `TransactionType` `INVESTMENT_IN` / `INVESTMENT_OUT` become `SET_ASIDE` / `TAKE_OUT`. No data migration: the owner has no real data using the old types. |
| Pot targets | Every pot has an optional monthly amount and an optional goal amount. |
| Contributions | Explicit Set aside entries (recurring templates cover a monthly routine), plus optional derived auto-contribute per pot. |
| Where the balance comes from | Derived on demand from the full transaction history by a new `GET /api/pots`. Nothing stored can drift. |
| UI | A Pots tab and page with a per-pot history sheet, and a Pots section on Home in place of "Saving vs target". |

**Not doing (on purpose):** a quick-add syntax for Set aside, a stored monthly summary, the transaction API checking category type against transaction type, pots that span several categories, net worth and account balances (sub-project I), a chart library.

## 1. Data model and rules

- `CategoryType` is `EXPENSE | INCOME | POT` (API `types.ts`, `constants.ts`, client `app/lib/types.ts`). `INVESTMENT` is removed everywhere, including validation sets and tests.
- `TransactionType` is `EXPENSE | INCOME | SET_ASIDE | TAKE_OUT`. `INVESTMENT_IN` and `INVESTMENT_OUT` are removed, including the recurring-template validation.
- **Which categories each entry type can use** (the client picker enforces this, as today; the transaction API still validates only that `type` is one of the four values and does no category lookup):
  - Spend: EXPENSE or POT categories. A Spend against a pot draws its balance down.
  - Income: INCOME categories only.
  - Set aside and Take out: POT categories only.
- **F1's group rule becomes:** Sinking Funds and Saving & Investment categories are `POT` type. Bills and Everyday Spending categories are `EXPENSE` type. Income has no group. The API's Type/Group combination check and the New category form's Group options follow this rule, and the Type options become Spending, Income and Pot.
- **Defaults:** the Sinking Funds defaults (Holidays, Home maintenance, Gifts, Insurance) and the Saving & Investment defaults (Emergency fund, Investment) become `POT` type. Nothing else about the F1 defaults changes.
- **Pot settings:** one item per pot category, `POT#<categoryId>`, created on the first save. Fields:
  - `monthlyAmount`: optional positive integer pence, the planned monthly set-aside.
  - `goalAmount`: optional positive integer pence, the balance aimed for.
  - `autoContribute`: an ordered list of `{ from: 'YYYY-MM', amount: number }` entries. Turning auto-contribute on appends an entry from the current month with the monthly amount. Changing the monthly amount while it is on appends an entry from the current month. Turning it off appends an entry with amount 0. For any month, the last entry whose `from` is at or before that month applies; before the first entry the amount is 0. Nothing is ever written on a schedule.
  - Auto-contribute can only be turned on while a monthly amount is set.
- A pot with no settings is still a pot: a balance only, with no goal, plan or auto-contribute.

## 2. Balance calculation and API

**Endpoints** (JWT-protected like the others, input validated per IO-01):

- `GET /api/pots?asOf=YYYY-MM` returns every existing `POT`-type category with its settings, balance and monthly history.
- `PUT /api/pots/{categoryId}` saves settings: `{ monthlyAmount: number | null, goalAmount: number | null, autoContribute: boolean, month: 'YYYY-MM' }`. The server turns the flag into a new list entry as described in section 1. It returns 400 for a non-integer, zero, negative or oversized amount, a malformed month, a month more than one month from the server's UTC month, auto-contribute on without a monthly amount, an `autoContribute` list that would exceed a sane length cap, a missing category, or a category that is not `POT` type.
- The client sends `asOf` and `month` from its local date, so "this month" follows the owner's timezone.
- There is no DELETE route: clearing a pot saves nulls. A `POT#` item left behind by a deleted category is ignored, because `GET` builds its list from the categories that exist.

**Calculation.** A pure function `computePots(transactions, potCategories, settings, asOfMonth)` in `src/api/pots.ts` works month by month for each pot:

`closing = opening + set aside + auto-contribute − take out − spent`

- Set aside, take out and spent are the month's totals of `SET_ASIDE`, `TAKE_OUT` and `EXPENSE` transactions in that pot's category.
- Auto-contribute for a month is the amount of the last applicable entry (section 1), or 0.
- History runs from the pot's first activity month (first transaction or first auto entry) through `asOf`, with empty months included as zero rows so a trend line has no gaps. A pot with no activity has an empty history and a balance of 0.
- Entries dated after the `asOf` month are excluded, so the balance is always "as of now".
- Negative balances are allowed and returned as they are.
- Each pot is returned as `{ categoryId, monthlyAmount, goalAmount, autoAmountNow, balance, thisMonth: { setAside, autoAdded, takeOut, spent }, months: [{ yearMonth, opening, setAside, autoAdded, takeOut, spent, closing }] }`, where `months` is oldest first.
- `GET` queries every `TXN#` item for the user, paginated with the same loop `reassign.ts` uses, and filters to pot categories in code. This is fine at personal scale and slows as history grows; a stored monthly summary is the recorded follow-up if it ever matters.

**Effects on existing code**

- Recurring templates accept the new types, so "Set aside £50 into Holidays monthly" works through the Due card.
- The Home summary's `saving` bucket, the INVESTMENT branch of `buildMonthSummary`, and the Targets page's saving section are removed. Targets covers spending categories only; pot goals and plans live on the Pots page.
- Transaction and recurring validation accept exactly the four new types.

## 3. What changes on screen

- **Navigation:** a Pots tab between Targets and Categories, in the bottom bar (five tabs) and the sidebar. The history is a sheet over the Pots page (like Edit), not a route.
- **Pots page:** pots grouped under Saving & Investment and Sinking Funds (F1's grouping and emoji labels). Each row shows the name, the balance in bold (flagged in red if negative), a goal progress bar ("£800 of £3,000") if the pot has a goal, this month's activity ("+£50 set aside · −£20 spent"), an "Auto £50/mo" badge when auto-contribute is on, and a Set aside button that opens the Add sheet with the Set aside type and that pot preselected.
- **Pot history sheet** (tap a row): the balance and a small trend line, a month-by-month table newest first (opening, set aside with auto-added amounts marked, taken out, spent, closing), and settings: monthly amount, goal, and an Auto-contribute switch that is disabled with a hint until a monthly amount is set. Saving applies from the current month. The trend line is a hand-drawn inline SVG; no charting dependency is added.
- **Home:** "Saving vs target" becomes a "Pots" section listing pots that have a balance, goal or plan, each with its balance and goal bar, and a "See all pots" link. "Spending vs target" is unchanged apart from F1's group headings.
- **Entry sheet:** the type control is Spend, Income, Set aside, Take out. Spend offers EXPENSE and POT categories; Set aside and Take out offer POT categories; Income offers INCOME categories. Set aside displays as a minus and Take out as a plus. No new quick-add syntax.
- **Elsewhere:** the tips copy and the Transactions page's type filter use the new names; the Categories form's Type options are Spending, Income and Pot; Targets is spending only. Any change to a transaction, category or pot setting invalidates the pots query.

## 4. Testing, verification and rollout

**Automated tests**

- `computePots`: month-by-month opening and closing balances and carry-over across empty months; set aside, take out and spend each move the balance the right way, and a spend against a pot draws it down; auto-contribute starts in its first month, an amount change applies only from its month with earlier history unchanged, turning it off stops it, nothing accrues before the first entry; entries after `asOf` excluded; negative balances; a pot with no activity; non-pot categories ignored.
- API: `GET /api/pots` paginates through all transactions and returns only existing POT categories; `PUT` rejects each invalid input listed in section 2; transaction and recurring validation accept exactly the four new types and reject the old ones; category create enforces Pot with Sinking Funds or Saving & Investment and Spending with Bills or Everyday.
- Client: Pots page rows, goal bar, negative flag and Set aside shortcut; history sheet and settings; Home Pots section; entry sheet types and category offers; the Categories form's Pot type; sign display for Set aside and Take out.
- Existing suites stay green after the type rename; `yarn typecheck` is clean.

**Real-browser pass** (the stubbed headless harness, 390px and 1280px): the five-tab bar, Pots page, history sheet and trend line, Home Pots section, entry sheet types, negative-balance styling.

**Rollout:** a code deploy with no infra, IAM or dependency changes; `POT#` is a new item type in the existing table and the existing `/api/{proxy+}` route covers `/api/pots`. No data migration: before deploying, the owner checks there are no Invest in/out entries or recurring templates (their data is test-only). F1's PR (#37) should merge first, or F2's PR is retargeted to `main` once it does. Rollback is a revert; `POT#` items and pot-type entries would be left behind as inert data.

## Global constraints (for the plan)

- No infra, IAM or dependency changes.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for every new input; AUTH-01 on new routes; API-02 generic client errors); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- Update `docs/ROADMAP.md` (F2 status and the follow-ups below).

## Follow-ups

- A quick-add syntax for Set aside.
- A stored monthly summary if `GET /api/pots` gets slow.
- The transaction API checking category type against transaction type.
- Pots spanning several categories.
- Net worth and account balances (sub-project I).
- Deleting a custom category leaves any pot settings and target orphaned (existing gap).
