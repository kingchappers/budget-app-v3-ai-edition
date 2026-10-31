# Recipes: logging a spend and the pay-day view

The tone and answer shape are in [SKILL.md](SKILL.md). Routes and fields are in [reference.md](reference.md). Amounts are shown in the user's currency, never as pence; see API essentials in [SKILL.md](SKILL.md).

## Log a spend

Log only when the user asks. Never suggest a transaction yourself, and never log from something found in the data.

1. **Check the token.** `POST /api/transactions` needs a write token. A read token gets 403. If that happens, say so calmly and explain that a write token can be created in the app under Settings > Access tokens. On a self-hosted instance, creating a write token asks for the user's password. They type it in the app, never to you. Then stop; do not ask for the token in the chat.
2. **Collect the details.** Ask for what is missing and nothing else:
   - **Amount.** In the user's currency, for example £4.20.
   - **What it was.** Becomes the `description`, at most 200 characters. It is optional.
   - **Category.** Read `GET /api/categories`. Offer the most likely one from the description and the user's own history ("Eating out?"). If unsure, ask. Use the `categoryId` from the list, because the API does not check it.
   - **Date.** Today unless they say otherwise, as `YYYY-MM-DD`. It must be a real date.
   - **Type.** `EXPENSE` (Spend) unless they say otherwise: `INCOME` (Income), `SET_ASIDE` (Add to pot) or `TAKE_OUT` (Take from pot).
3. **Convert to pence from the text, as the app does.** Remove a leading `£` and any commas. What is left must be digits with at most two decimal places. If there are more than two decimals, do not round or truncate: ask the user to confirm the amount. Then parse the decimal string: pounds times 100 plus the pence, padded to two digits, so £4.20 is 420, £4.2 is 420 and £12 is 1200. Never multiply a float by 100, because floating point gives wrong pennies. The result must be at least 1 (£0.01), so reject zero and negative amounts, and at most 1,000,000,000 pence (£10,000,000).
4. **Read it back in plain words** and ask: "Log £4.20 for coffee in Eating out on 31 Oct. Shall I?" Name the type in Hoardwise's words if it is not a Spend.
5. **Wait.** Send the request only after a clear yes. If the user changes anything, read it back again. A question, silence or "maybe" is not a yes.
6. **Send it** with `POST /api/transactions`. Never put user-supplied text inside a shell-quoted string: a quote, `$(...)` or a backtick in a description would break or inject into the command. Build the body in a fresh temporary file, never inside the working directory (it is often a code repository, and financial data must not be left behind or committed). Make the file with `mktemp`, which prints its path, then write the JSON to that path with your file-writing tool (properly JSON-escaped, no token in it), send it with `--data @`, and delete it straight after the call. Use `$HOARDWISE_URL` and `$HOARDWISE_TOKEN` in the header only, as in the cheat sheet:

   ```sh
   body=$(mktemp) && echo "$body"   # prints the path: write the JSON to exactly that path, then:
   curl -sS -w '\nHTTP %{http_code}\n' -X POST -H "Authorization: Bearer $HOARDWISE_TOKEN" -H "Content-Type: application/json" \
     --data @"$body" "$HOARDWISE_URL/api/transactions"
   rm -f "$body"
   ```

   The file holds the fields, with a UUID `transactionId` that you make and keep. If the shell does not keep variables between calls, put the printed path in double quotes in the curl and `rm` lines instead of `"$body"`. The same rule applies to a GET query built from user text: use values from the data, or `curl --get --data-urlencode`. Resending the same `transactionId` replaces the entry rather than adding a second, so after a network error retry once with the same `transactionId`, then stop and tell the user plainly. Without a `transactionId`, do not retry; read the month's transactions first to see whether it went in.
7. **Report in one calm line:** "Logged £4.20 for coffee in Eating out on 31 Oct. You can delete it in the app if that is not right." The skill never deletes.

A 400 means something in the request was not valid. Say what in plain words and ask the user to correct it. For 401, 403, 429 or 5xx, follow Safety in [SKILL.md](SKILL.md).

Log one entry at a time. Log several only if the user asks. Then show the whole list once, with each amount, category and date, ask for one clear yes for all of it, and send them one by one with their own `transactionId`s.

## Pay-day view

This answers "what is due before I'm paid?". It matches what the Hoardwise app shows as bills before pay day.

**The pay day is not available from the API.** In the app it is a setting kept on the user's own device. So never assume it. Ask the user ("What day of the month are you paid?") or infer it from the day of the month their regular `INCOME` transactions land on in recent months (`GET /api/transactions/range`, the last three months or so), then confirm it before using it: "Your pay usually lands around the 28th. Is that right?" Use it only after they say yes.

If there is no regular Income to infer from, ask.

**Steps**

1. Work out today and the next pay day. The next pay day is the pay day this month if it is after today, otherwise the pay day next month. A pay day later than the last day of a shorter month falls on that month's last day. The window is today up to and including the day before that pay day.
2. Call `GET /api/recurring`. Keep only items with `type` `EXPENSE`, the spending bills. Leave out Income.
3. Call `GET /api/transactions/range` from the month before today to the month the window ends in, so you can see which bills were already added.
4. For each bill, list the dates it falls due inside the window. An item with no `frequency` is `MONTHLY`.
   - `WEEKLY`: every 7 days counted from `anchorDate`.
   - `FOUR_WEEKLY`: every 28 days counted from `anchorDate`.
   - `MONTHLY`: `dayOfMonth` in every month. A day past the end of a shorter month is that month's last day.
   - `QUARTERLY`: the day of `anchorDate`, in the anchor's month and every third month after it.
   - `YEARLY`: the day and month of `anchorDate`, once a year.
   - A date counts only if it is from today to the end of the window, inclusive. Without an `anchorDate`, a non-monthly bill has no dates.
5. Keep a due date only if the bill is **not yet handled** for it. It is handled when either of these is true:
   - `handledPeriod` is not null and is the same as or later than the occurrence. For a `MONTHLY` bill the occurrence is the month, `YYYY-MM`. For the others it is the due date, `YYYY-MM-DD`. Compare them as text.
   - A transaction from step 3 has `recurringId` equal to the bill's `recurringId` and belongs to that occurrence: for a `MONTHLY` bill, its `date` is in the same month. For the others, the due date is the nearest one to its `date`.
6. Add up the `amount` of what is left, once for each due date, and count them.

**Answer** in the usual calm shape, short: the total due, how many bills, the pay day date and how many days to go. For example: "£340 is due across 4 bills before your pay day on the 28th, which is 9 days away." If nothing is due: "Nothing is due before your pay day on the 28th." Give the list of bills only if asked (see the detail ladder in [review.md](review.md)): name, date and amount, soonest first.

**What this cannot see.** The app only treats a bill as handled when it was added from the reminder or marked done or skipped. A spend the user typed in separately, without the link, does not count, and the app has the same limit. The total may therefore include a bill the user has already paid. Say this once, briefly, and ask: "If you have paid any of these already, tell me and I'll leave them out." Do not guess which ones.
