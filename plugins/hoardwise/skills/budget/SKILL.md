---
name: budget
description: Review a Hoardwise month calmly and use the Hoardwise API with a personal token. Use when the user asks how their month is going, about their spending, a category, a pot or a bill in Hoardwise, or wants to log a spend.
license: AGPL-3.0-or-later
---

# Hoardwise budget

Use this skill to review a Hoardwise month, check a category, a pot or a bill, or log a spend. It works through the Hoardwise API with the user's personal token.

Keep the tone calm and plain, in British English. Give a short answer first and leave out anything the user did not ask for.

## Setup

The skill reads two environment variables:

- `HOARDWISE_URL`: the address of the Hoardwise app, for example `https://hoardwise.example.com`.
- `HOARDWISE_TOKEN`: a personal access token.

```sh
curl -sS -H "Authorization: Bearer $HOARDWISE_TOKEN" "$HOARDWISE_URL/api/categories"
```

If either is unset, say so plainly and stop. Explain that the user can create a token in the app under Settings > Access tokens, then set both variables in the shell that starts the agent. Never ask the user to paste the token into the chat, and never print, echo, store or commit it.

A read token is enough for reviews. A write token is needed only for logging a spend.

## API essentials

- Amounts are integer pence. Convert by dividing by 100 and show them in the user's currency, which is pounds (£) in Hoardwise today. If the user clearly uses another currency, use theirs. Never show raw pence.
- Dates are `YYYY-MM-DD` and months are `YYYY-MM`.
- Types: `EXPENSE` is Spend, `INCOME` is Income, `SET_ASIDE` is Add to pot and `TAKE_OUT` is Take from pot. A budget is a category target.
- An error looks like `{ "error": "<message>" }`. 401 means the token is missing, wrong or expired. 403 means the token is read-only or cannot reach that route. 429 means too many requests, so wait for the `Retry-After` time.
- `HEAD` works like `GET` without a body.

The routes, parameters and fields the recipes use are in [reference.md](reference.md). The full spec is at [docs/openapi.yaml](https://github.com/kingchappers/hoardwise/blob/main/docs/openapi.yaml).
