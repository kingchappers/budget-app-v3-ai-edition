# The monthly review in full

Follow these steps when the user asks how their month is going. The tone and answer shape are in [SKILL.md](SKILL.md). Routes and fields are in [reference.md](reference.md). Work out the month under review: the current month unless the user names another.

## The review recipe

1. Call `GET /api/categories`. Keep each category's `categoryId`, `name` and `type` (`EXPENSE`, `INCOME` or `POT`).
2. Call `GET /api/transactions/range` with `from` and `to` as `YYYY-MM`: the last six months including the month under review. The call allows at most 24 months, so never ask for more in one call. Use more than six only if the user asks for a longer view, and split anything past 24 months into several calls.
3. Call `GET /api/targets`. A `WEEKLY` target becomes a monthly one by multiplying by the days in the month and dividing by 7, as the app does. Round to the nearest penny.
4. Call `GET /api/pots?asOf=YYYY-MM`, with `asOf` set to the month under review. `asOf` may be at most one month after the current month, so a review further ahead is not possible.
5. Leave out archived pots (`archivedAt` is not null). Do not mention them unless the user asks.
6. Work out these, in pence, from the data:
   - **Totals.** Income (`INCOME`) and spending (`EXPENSE`) for the month, and the same for each earlier month.
   - **Usual.** For income, spending and each category, the median of the previous three to six months that have data. A month counts as having data if it has entries on at least a quarter of its days (the app treats a month below that as partly tracked and leaves it out of comparisons). The month under review is not part of its own usual.
   - **Categories.** For each spending and income category, this month against its target (if it has one) and against its own usual.
   - **Pots.** Money added (`setAside` plus `autoAdded`), money taken out (`takeOut`) and money spent from the pot (`spent`), from each active pot's `thisMonth`.
   - **Notable items.** See the next section.
7. If the month is still in progress, say "so far" and compare with the whole of earlier months, not with a part of them. Do not guess the month's end unless the user gave an expected income and you say it is an estimate.
8. Pick what is worth knowing, then answer in the shape in SKILL.md: a headline, at most three points, and one offer of more detail.

## Income

- If the month has at least one `INCOME` transaction, use what is logged.
- If it has none, ask the user how much they expect this month before you give estimates. Do not guess.
- If the earlier months show a regular amount (the same, or very close, each month), offer it as the suggested answer: "You usually have about £2,300 in. Is that right for this month?"
- If there is no regular amount, or no earlier months, ask without suggesting a number.
- Use the answer as an estimate only, and say so. Do not write it into Hoardwise unless the user asks you to log it.

## Big spends and unusual months

These are rules of thumb. Always judge against the user's own history, never against a fixed amount. Another person's usual may be very different.

- A category is **unusual** when this month is more than about half again above its usual (more than 1.5 times the median), and the gap is more than a small minimum, such as £5, so small changes are not flagged.
- A single item is **big** when it is much larger than that category's norm: for example several times the category's median item, and a clear amount, not just a few pounds.
- A category over its target is worth a mention when it is also above its usual. If it is over its target but is always about this size, say that kindly and briefly, or leave it for the detail.
- Income well below its usual is worth a mention too, in the same calm way.
- Mention at most two or three of these in the first answer. Choose the largest gap in pounds. Keep the rest for when the user asks.
- A category with no target is compared with its own usual only.

## The detail ladder

The first answer never carries detail. Offer the next step as a question and wait. When the user says yes, take one step, then offer the next:

1. The items behind one point, for example the transactions in the category that stood out, newest first, with date, description and amount.
2. Each category against its target and its usual, as a short list.
3. The trend over more months, using a longer range call (at most 24 months).
4. The pots in full: each active pot's balance, goal and movement.
5. A chart, if the user likes charts (see Visuals).

Give as much as the user asks for, in simple terms, with the same tone. If they ask for everything, give it in sections and check in between rather than in one block.

## Visuals

- Ask once, early: "How do you like things shown? Short and plain, with a chart now and then, or lots of detail?" Remember the answer for the rest of the session and follow it. Do not ask again.
- If they prefer no charts, do not draw any and do not offer them again.
- When you draw a chart, or hand data to a design tool, keep it calm and small: one or two series, labelled directly, sorted largest first, plenty of space.
- Follow the Hoardwise brand rules: no flashing or motion; colour never carries meaning alone, so pair it with a label, an icon or a + or − sign; calm colours.
- Offer more charts rather than showing them: "I can also chart this by month, if that would help."

## Edge cases

- **First month, or very little data.** Say so calmly: "There is only a little here so far, so I can't compare yet." Make no trend claims. Describe what is there.
- **A month with no transactions.** Say nothing is logged yet. Ask if they would like to log something, or if the month was not tracked. Do not call it a good or a bad month.
- **A pot with no movement this month.** Leave it out of the points. Mention it only if the user asked about pots, as "no change this month".
- **Archived pots.** Leave them out, as in the recipe.
- **A category with no target.** Compare it with its usual only.
- **A target with no spending.** That is fine and often good news. Do not flag it.
