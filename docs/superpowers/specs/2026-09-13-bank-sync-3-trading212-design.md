# Bank Sync 3 — Trading 212 Provider Design

**Date:** 2026-09-13
**Status:** Draft — product direction approved, details pending review
**Series:** Bank sync specs 1–4. Depends on spec 1; benefits from spec 2.
**Covers:** Importing Trading 212 dividends and interest into the review inbox
via the Trading 212 Public API
**Defers:** Deposits/withdrawals (handled on the bank side), orders, portfolio
value tracking

## Goal

Dividends and interest earned in Trading 212 are real income that never
passes through a bank account until withdrawn, so they are invisible to the
Enable Banking sync. This spec imports them into the same inbox.

## Context

- Trading 212 does not offer Open Banking account information access; it has
  its own **Public API (beta)**, available for **Invest** and **Stocks ISA**
  accounts only.
- Auth: an API key + secret generated in the Trading 212 app, sent as HTTP
  Basic auth (key as username, secret as password). Keys can be limited to
  read-only permissions and optionally to IP addresses.
- Environments: live `https://live.trading212.com`, demo
  `https://demo.trading212.com`.
- Relevant endpoints (confirmed 2026-09-13 from docs.trading212.com; re-verify
  during implementation as the API is beta):
  - `GET /api/v0/equity/history/dividends` — fields `amount`, `currency`,
    `paidOn`, `reference`, `ticker`, `type`; cursor pagination via
    `nextPagePath`; `limit` ≤ 50; **6 requests / minute**
  - `GET /api/v0/equity/history/transactions` — fields `type`, `amount`,
    `dateTime`, `reference`; cursor pagination via `nextPagePath`; `limit` ≤
    50; **6 requests / minute**. `type` values seen in docs include
    `DEPOSIT`, `WITHDRAW`, `FEE`, `TRANSFER` and an interest type — **the exact
    interest enum value must be confirmed during implementation**; if interest
    is not exposed here, this spec imports dividends only and records the gap.
- Neither endpoint takes a date filter; results are newest-first.

## Product Decisions

**Returns only: dividends and interest.** Deposits and withdrawals already
appear on the bank side (Lloyds) and are categorised there as
`INVESTMENT_IN`/`INVESTMENT_OUT` (automatable with a spec 2 rule), so
importing them here would double-count. Orders are portfolio moves, not budget
events.

### Decisions made during spec writing (review these)

- **One connection per Trading 212 account type.** Invest and Stocks ISA use
  separate API keys, so each is its own connection with a single pseudo
  account (`displayName` "Trading 212 Invest" / "Trading 212 Stocks ISA").
- **Imported as `INCOME`**, `direction: IN`, description
  `"Dividend: {ticker}"` or `"Interest"`.
- **GBP accounts only**, matching spec 1. A key for a non-GBP account is
  rejected at connect time.
- **Amounts rounded to the nearest penny** (half away from zero) using
  decimal-string arithmetic, because dividends can be fractional pennies
  (e.g. `0.4567`). The rounding is shown in the inbox description only if it
  changed the value ("≈").
- **Key storage in Secrets Manager, one secret per connection**, not in
  DynamoDB. Cost ≈ $0.40/month per connected Trading 212 account.
- **No IP restriction recommended.** The worker Lambda has no static egress
  IP; the setup guide tells users to create a **read-only** key instead.

## Assumptions About Spec 1

1. `Connection` is a union discriminated by `provider` with an `auth` field;
   this spec adds `{ provider: 'trading212'; auth: { secretName: string; environment: 'live' | 'demo' } }`.
2. `BankProvider.fetchTransactions(conn, account, window, ctx)` is the only
   provider method `runSync` calls; connect flows are provider-specific worker
   commands.
3. Worker commands are a validated tagged union that can be extended.
4. `deriveTxnKeys` uses `entryReference` when present (Trading 212
   `reference` is used).
5. Consent-expiry handling in `runSync` is Enable Banking-specific and skipped
   for other providers.
6. The dedupe, inbox, confirm and error-classification machinery is
   provider-agnostic.

## Components

| Module | Responsibility |
|---|---|
| `src/sync/providers/trading212.ts` | Basic-auth client, `verifyKey`, paginated fetch of dividends + interest, normalisation, rate-limit pacing |
| `src/sync/amount.ts` (change) | `roundDecimalToPence` alongside `parseAmountToPence` |
| `src/sync/commands.ts` (change) | `connectApiKey`, `disconnect` handles `trading212` |
| `sync-handler.ts` (change) | Register provider |
| `src/api/banks.ts` (change) | `POST /api/banks/trading212` |
| `app/routes/banks.tsx` (change) | "Connect Trading 212" modal |
| `infra/sync-lambda.tf` (change) | Secrets permissions scoped by name prefix |

## Connection Flow

1. User generates a read-only API key + secret in Trading 212 and opens
   "Connect Trading 212" on `/banks`: account type (Invest / Stocks ISA),
   key, secret, start date.
2. `POST /api/banks/trading212` body `{ accountType, apiKey, apiSecret, startDate }`
   — exact key allowlist; `apiKey`/`apiSecret` strings 10–200 chars, no
   whitespace; `startDate` rules as spec 1. The API Lambda forwards to the
   worker `connectApiKey` command and **never logs or stores the body**.
3. Worker verifies the key with one authenticated account-info call (endpoint
   confirmed during implementation), checks the account currency is GBP,
   then creates secret `${app_name}/t212/{connectionId}` and writes the
   connection. Invalid key → 400 "Trading 212 rejected this key"; non-GBP →
   400.
4. Async `syncNow` for the first import, as spec 1.

**Disconnect:** delete the connection and pending items (spec 1 behaviour),
then `DeleteSecret` with `ForceDeleteWithoutRecovery = false` (7-day recovery
window). The setup guide tells users to also revoke the key in Trading 212.

**Key rotation / revoked key:** 401 → `EXPIRED` with a "Replace key" action
that reuses the connect modal and updates the existing secret
(`PutSecretValue`).

## Sync Behaviour

`fetchTransactions(conn, account, window, ctx)`:

1. Load the secret (cached per warm container).
2. For each of dividends and transactions endpoints: request `limit=50`,
   follow `nextPagePath`, stop when the oldest item on a page is older than
   `window.from` or there is no next page. Max 20 pages per endpoint per run.
3. Pace requests at ≥ 10 s apart per endpoint to respect 6 req/min; if the
   next request would exceed `ctx.deadline`, stop and let `runSync` record
   `partial`. Respect `429` via spec 1 `RATE_LIMITED` handling.
4. Normalise: keep dividends and interest-type transactions only;
   `bookingDate` = date part of `paidOn` / `dateTime` in UTC;
   `entryReference` = `reference`; skip non-GBP; skip items before `startDate`.

The spec 1 5-day overlap and dedupe keys make repeated reads safe.

## Security & Infrastructure

- `worker_role` gains `secretsmanager:CreateSecret`, `PutSecretValue`,
  `GetSecretValue`, `DeleteSecret` on
  `arn:aws:secretsmanager:{region}:{account}:secret:${app_name}/t212/*` only
  (INFRA-01). `api_role` gains nothing.
- The key and secret pass through the API Lambda in the request body; request
  bodies are never logged (SEC-06, LOG-04). API Gateway access logs must not
  include bodies (they don't today; asserted in plan review).
- Setup guide: create a **read-only** key; revoke in Trading 212 on
  disconnect.
- The Trading 212 API is beta: all response shapes are checked, and failures
  map to `INVALID_RESPONSE` rather than crashing the run.

## Testing

- **Pure:** `roundDecimalToPence` (`"0.4567"`→46, `"0.005"`→1, `"12"`→1200,
  rejects non-numeric); normaliser keeps only dividend/interest, derives
  UTC dates, description formats.
- **Provider** (stubbed `fetch`, synthetic fixtures): Basic auth header;
  pagination via `nextPagePath` stops at `window.from`; 20-page cap; pacing
  respects deadline; 401 → `EXPIRED`; 429 → `RATE_LIMITED`; shape mismatch →
  `INVALID_RESPONSE`.
- **Commands:** `connectApiKey` rejects invalid key without creating a
  secret; non-GBP rejected; secret name scoped to connection id; disconnect
  deletes secret.
- **API:** body allowlist; request body absent from all log calls (spy on
  logger).
- **Manual:** connect a real read-only Invest key; first sync imports recent
  dividends; re-sync no duplicates; revoke key in Trading 212 → `EXPIRED`
  banner.

## Out of Scope

Deposits/withdrawals, orders, fees, portfolio valuation, non-GBP accounts,
CSV export import, Trading 212 Cash ISA or other account types the API does
not support.
