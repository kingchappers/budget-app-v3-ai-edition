# Category groups and YNAB defaults: design

Sub-project **F1**. F2 (savings and sinking-fund pots) builds on this and gets its own spec. Later sub-projects: G polish and hardening, H spending insights, I net worth and accounts, J offline entry queue.

## Intent

The default categories should match the owner's YNAB budget, arranged in the same groups. Custom categories must be able to join a group. The existing test data is disposable, so there is no migration.

## Decisions

| Question | Decision |
|----------|----------|
| Groups | A fixed set, not user-created: Bills, Sinking Funds, Everyday Spending, Saving & Investment. Income categories have no group. |
| Custom categories | Pick a group on create, defaulting to Everyday Spending. A category with no group shows under "Other". |
| Existing data | The owner deleted the two test transactions and has no targets or recurring templates. No remap script. |
| Saving & Investment | Emergency fund, Garden Project, Investment and Windows are `INVESTMENT`-type for now, so Invest in/out keeps working. F2 replaces the type with pots. |
| Old investment defaults | Stocks, Crypto, Real Estate and Other Investments are removed. |
| Joint Account | Not a default. The owner adds it as a custom category. |
| Income | The four income defaults are unchanged. |

**Not doing:** pot behaviour (F2), user-created groups, moving a target when a custom category is deleted (existing gap, logged as a follow-up).

## 1. Data model and defaults

- `Category` (API `types.ts`, client `app/lib/types.ts`) gains `group?: CategoryGroup`, where `CategoryGroup = 'BILLS' | 'SINKING_FUNDS' | 'EVERYDAY' | 'SAVING_INVESTMENT'`. Display order is that order: Bills, Sinking Funds, Everyday Spending, Saving & Investment.
- `createCategory` accepts an optional `group`. A value outside the set returns 400 (IO-01). When absent the category is stored as `EVERYDAY`. `group` is rejected for `INCOME` categories (400), which stay ungrouped.
- `src/api/defaults.ts` is replaced with 23 grouped defaults plus the four unchanged income defaults (27 in all). Emoji from YNAB are stored in `icon`.

| Group | Category (id) | Icon |
|-------|---------------|------|
| BILLS | Council Tax (`cat-council-tax`) | tag |
| BILLS | Mortgage (`cat-mortgage`) | 🏠 |
| BILLS | Phone and Internet (`cat-phone-internet`) | 🛜 |
| BILLS | Subscriptions (`cat-subscriptions`) | 🗓️ |
| BILLS | Utilities (`cat-utilities`) | ⚡ |
| SINKING_FUNDS | Car maintenance (`cat-car-maintenance`) | 🚗 |
| SINKING_FUNDS | Certifications (`cat-certifications`) | 🏆 |
| SINKING_FUNDS | Holidays (`cat-holidays`) | ✈️ |
| SINKING_FUNDS | Home maintenance (`cat-home-maintenance`) | 🛠️ |
| SINKING_FUNDS | Gifts (`cat-gifts`) | 🎁 |
| SINKING_FUNDS | Insurance (`cat-insurance`) | 📄 |
| EVERYDAY | Charity (`cat-charity`) | 💖 |
| EVERYDAY | Conference (`cat-conference`) | 👨‍💼 |
| EVERYDAY | Going Out & Entertainment (`cat-going-out`) | 🎡 |
| EVERYDAY | Groceries (`cat-groceries`) | 🛒 |
| EVERYDAY | Health (`cat-health`) | 🏥 |
| EVERYDAY | Pets (`cat-pets`) | 🐾 |
| EVERYDAY | Personal Spending (`cat-personal-spending`) | 🛍️ |
| EVERYDAY | Transport (`cat-transport`) | 🛞 |
| SAVING_INVESTMENT | Emergency fund (`cat-emergency-fund`) | 😌 |
| SAVING_INVESTMENT | Garden Project (`cat-garden-project`) | 🧑‍🌾 |
| SAVING_INVESTMENT | Investment (`cat-investment`) | tag |
| SAVING_INVESTMENT | Windows (`cat-windows`) | 🪟 |

Bills, Sinking Funds and Everyday Spending categories are `EXPENSE`. Saving & Investment categories are `INVESTMENT`. Income defaults keep their current ids and icons (`cat-salary`, `cat-freelance`, `cat-rental`, `cat-other-income`).

Removed default ids: `cat-housing`, `cat-food`, `cat-entertainment`, `cat-clothing`, `cat-personal-care`, `cat-education`, `cat-dining`, `cat-travel`, `cat-stocks`, `cat-crypto`, `cat-real-estate`, `cat-other-investments`. Anything still referencing them shows as an unknown category; this is noted in the PR body.

## 2. What changes on screen

- **Grouping helper:** `app/lib/categoryGroups.ts` exports `CATEGORY_GROUP_LABELS`, the ordered group list, and `groupCategories(categories)` returning `{ group, label, categories }[]` in fixed order with "Other" last and empty groups omitted. Pure and tested.
- **Category picker:** the most-used chips are unchanged. The "More…" dropdown uses Mantine `Select` grouped data (group labels from the helper; Income last). The transaction type still filters by category type first.
- **Emoji:** the icon is shown before the name in chips, the dropdown, the Categories page and Targets. An icon of `tag` (custom or plain) renders nothing extra.
- **Categories page:** sections by group instead of by type; Income keeps its own section; ungrouped custom categories go under "Other". The New category form gains a Group select (disabled for Income). Delete and reassign work as before; reassign candidates stay limited to the same type.
- **Targets page:** the "Spending" and "Saving" sections become group sections in the same order.
- **Home:** group sub-headings inside the existing spending and saving sections. Progress calculation is unchanged.

## 3. Testing, verification and rollout

**Automated tests**

- API: create validates `group` (four values accepted, others 400, absent defaults to `EVERYDAY`, present on income 400). Defaults are consistent: 27 categories, unique ids, every non-income category has a group, the four Saving & Investment categories are `INVESTMENT`, all others in a group are `EXPENSE`, no Joint Account.
- Client: `groupCategories` ordering, empty-group omission, "Other" last, income handling.
- Components: grouped dropdown, Categories page sections and the Group select, Targets sections, Home sub-headings.
- Existing suites (497 tests at last run) stay green; typecheck clean.

**Real-browser pass** (the stubbed headless harness, 390px and 1280px): grouped dropdown, Categories page, Targets, Home headings and emoji rendering.

**Rollout:** a code deploy with no infra, IAM or dependency changes. The owner has already deleted the two test transactions; there are no targets or recurring templates to clear. After deploy, set targets again on the new categories. Rollback is a revert, but old default ids would not return to existing data (there is none).

## Global constraints (for the plan)

- No infra, IAM or dependency changes.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event inside a functional `setState` updater.
- Security controls in `SECURITY.md` apply (IO-01 for `group` validation); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, repo commit trailers.
- Update `docs/ROADMAP.md` (E dropped; F1 and later sub-projects added).

## Follow-ups

- Deleting a custom category leaves its target orphaned (existing gap).
- User-created groups.
- F2 converts Saving & Investment and Sinking Funds into pots.

## Amendment, 2026-09-25

The owner removed six personal categories from the defaults: Garden Project, Certifications, Windows, Conference, Pets and Car maintenance. The defaults are now 21 in all: 17 grouped (5 Bills, 4 Sinking Funds, 6 Everyday, 2 Saving & Investment: Emergency fund and Investment) plus the 4 income defaults. The table in section 1 lists the original 27; read it without those six rows. The owner adds personal categories as custom ones.
