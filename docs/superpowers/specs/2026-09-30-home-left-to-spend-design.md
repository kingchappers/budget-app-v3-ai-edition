# Home answers "how much is left?": design

PR-06 of the neurodivergent UX audit programme (wave 1). It fixes findings CL1, CL7, CL8, PC9 and ES5. Branch `nd/06-home-left-to-spend`, from `main`.

## Intent

Home should answer one question first, in one plain sentence: how much is left to spend this month. Spending without a target should be visible, the rows on Home should lead somewhere useful, labels should follow the month being viewed, and the "Set a target" card should be information the user can put away, not a standing instruction.

## Decisions

| Question | Decision |
|----------|----------|
| What "left to spend" means | The sum of monthly-normalised expense targets (`budgetedTotal`) minus what was spent in those targeted categories (`spentInBudgeted`). Spending in categories without a target is not subtracted: it has its own "Other spending (no target)" row. The value may be negative. |
| Headline, current month | `£412.00 left to spend this month · 18 days to go`. Negative: `£40.00 over so far. Nothing needs doing today.` (no days count). |
| Headline, past months | `£412.00 left at the end of August` or `£40.00 over in August`. |
| Headline, future months | `£412.00 left to spend in October` or `£40.00 over in October`, no days count. |
| No expense targets | No headline sentence; only `Spent this month £X`. |
| Per-day figure | Never shown. |
| Category rows | Lead with `£67.60 left` or `£12.00 over`; `£182.40 spent of £250.00` is secondary text. The progress bar and existing props stay; the warning glyph and red text go (no alarm, no red for ordinary data). The bar's colour is left for the wave 2 restyle. Each row is a link to `/transactions?month=YYYY-MM&category=<id>`. |
| Unbudgeted spending | `Spent this month £X` is always shown. When there are targets and some spending has none, an `Other spending (no target) £Y` row links to `/transactions?month=YYYY-MM&spending=untargeted`. |
| Recent rows | Tapping a row opens the Edit sheet; the row menu (Edit, Duplicate, Repeat monthly, Delete, Discard) is the same as on Transactions. The editing flow is extracted into a shared hook so both pages use one implementation. |
| Month-aware labels | "this month" for the current month, "in August" for another month of the current year, "in August 2025" otherwise. Used in Home's income, spent and empty-state lines and in the Transactions count line. |
| Target card | "Targets are optional. Set one to see what's left in a category." with **Set targets** and **Just tracking for now**. Dismissal is stored in `localStorage` under `budget.targetsCardDismissed`, read and written inside try/catch. |

### Decisions made without the user

- Left to spend counts targeted categories only (above). Subtracting untargeted spending too would make the number move for reasons the targets can't explain.
- Days to go include today: on the last day of the month it reads `1 day to go`.
- Amounts use the app's existing `formatPence` (`£412.00`), not whole pounds, so every figure on Home looks the same.
- Future months get a headline without days to go.
- The "Other spending" row is hidden when it would be £0.00, and when there are no targets (then all spending is "other" and the Spent line already says it).
- Unbudgeted spending in the Transactions filter uses its own query parameter (`spending=untargeted`) and a matching option at the top of the category filter, "Other spending (no target)", rather than a magic category id.
- Transactions reads `month` and `category`/`spending` only when it first opens; changing month afterwards does not rewrite the URL (the wave 2 shared-month PR owns that). Invalid values are ignored.
- Tapping a Recent row opens Edit wherever `TransactionRow` has an `onEdit` handler, so Transactions rows gain the same behaviour. Pending (offline) rows are not tappable, matching the menu, which hides Edit for them.
- The Transactions count line also gets singular/plural right ("1 transaction").
- No `app/lib/preferences.ts` exists on `main`, so the card's storage helper lives with the card.

**Not doing:** colour tokens and row restyling (wave 2), a shared month across pages (wave 2), any API or infrastructure change.

## Testing

- `summary.ts`: `budgetedTotal` with monthly and weekly targets, `spentInBudgeted`, `spentTotal`, `spentUnbudgeted`, negative `leftToSpend`, a month with no targets, pot-category targets ignored.
- The headline sentence: current positive, current negative, past positive, past negative, future, singular day, no targets.
- Month phrases: this month, same year, other year.
- Home: the headline and spent line, no-target case, category link URL, Other spending link URL, Recent row opens Edit, card dismissal hides it and it stays hidden after a remount, month-aware labels after switching month.
- Transactions: `month` and `category` query params initialise the month and filter; `spending=untargeted` shows only untargeted expenses; invalid params are ignored; count line follows the month.
