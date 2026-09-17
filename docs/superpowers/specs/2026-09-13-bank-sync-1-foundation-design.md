# Bank Sync 1 — Sync Foundation & TrueLayer Design

**Date:** 2026-09-13 (provider rewritten 2026-09-15)
**Status:** Approved for planning
**Series:** Bank sync specs 1–4. This spec is the foundation; specs 2
(auto-categorisation), 3 (Trading 212) and 4 (self-hosted Docker) build on the
interfaces defined here.
**Covers:** Connecting UK bank accounts via TrueLayer, scheduled + manual sync
of settled transactions into a review inbox, confirm/ignore flow, connection
health, the IAM/secrets/infra needed to run it safely
**Defers:** Categorisation rules (spec 2), Trading 212 (spec 3), non-DynamoDB
storage and Docker (spec 4), pending transactions, non-GBP accounts,
bulk inbox actions, per-account selection

## Provider Change Log

This spec originally targeted **Enable Banking**. That provider does not
support UK banks at all — it lost the ability to passport its Finnish
licence into the UK post-Brexit (confirmed by the user, early 2026), not a
Lloyds-specific gap. **Enable Banking is dropped entirely; this spec now
targets TrueLayer**, whose UK account-information product is free at
personal/low volume and does not require the deployer to be a regulated
AISP themselves — TrueLayer holds that regulatory role, and the deployer's
app connects to it as a client. GoCardless Bank Account Data (ex-Nordigen)
remains ruled out (closed to new signups). Direct FCA RAISP self-registration
remains ruled out (cost and compliance burden too high for a single
self-hoster).

Everything in this spec that isn't provider-specific (product decisions, data
model, sync algorithm shape, API surface, inbox/confirm/ignore flow) is
**unchanged** from the Enable Banking version. Tasks 1–5 and 8 of the
implementation plan (pure sync core, `SyncStore`, `runSync` orchestration)
were already built against provider-agnostic interfaces and need no rework.
Tasks 6–7 (provider client) and the provider-touching parts of tasks 9, 10,
12, 14, and 17–20 need rewriting against TrueLayer's actual API — see the
build order doc for the up-to-date task list.

**Unconfirmed items carried into implementation** (same convention as the
original spec's "confirm against sandbox" items — do not guess, verify
during the relevant task and record findings in the spec-update task):

- The exact query parameters TrueLayer appends when redirecting the user's
  browser back to our `return_uri` after the hosted consent page completes.
  Design assumes we re-check connection status by API call rather than trust
  redirect params.
- The exact terminal `status` value `GET /v3/data-connections/{id}` returns
  once a connection is ready to use (only `authorization_required` and
  `authorizing` are confirmed as pending states from the docs).
- Whether `return_uri`'s domain must be pre-allowlisted in the TrueLayer
  console ahead of time (Enable Banking required console redirect-URL
  registration; TrueLayer's `return_uri` is a per-request field, but
  allowlisting requirements are unconfirmed).
- Consent/connection validity duration for `data_access_type: "recurring"`
  v3 connections. No confirmed lifetime exists in the docs reviewed (a
  90-day figure exists for TrueLayer's *older* OAuth model but must not be
  assumed to carry over to v3). Design treats expiry as **reactive-only**:
  detected when an API call returns an EXPIRED-classified error, not shown
  as a proactive countdown.
- Numeric rate-limit thresholds (only error codes are confirmed, not
  requests/second or requests/day figures).
- The sandbox hosted-page host: implementation uses a placeholder value
  (`truelayer-sandbox.com`, inferred from the confirmed api/auth sandbox host
  naming pattern in `src/sync/providers/trueLayer.ts`'s
  `HOSTED_PAGE_HOSTS.sandbox`) that has not itself been directly verified
  against a real sandbox `hosted_page.uri` response. Confirm during the
  Phase 0.3 sandbox walkthrough and correct the constant if wrong — the
  allowlist check (`isAllowedHostedPageUrl`) fails closed (throws
  `INVALID_RESPONSE`) if it's wrong, so this is safely self-detecting rather
  than a silent security gap.

## Goal

Manual entry is the biggest friction in the app. This spec pulls settled
transactions from the user's bank accounts automatically and puts them in a
review inbox, so the budget stays accurate with a few taps instead of typing
every purchase — without the app ever holding bank credentials, and without
the author holding anyone's data.

## Context & Constraints

- **Distribution model is single-tenant self-hosting.** Each deployment
  belongs to one household. The deployer registers their *own* TrueLayer
  console application and connects only their own bank accounts through it.
  The project author never operates an instance or shares aggregator
  credentials. TrueLayer's UK account-information data is free at personal
  volume, keeping aggregator cost at £0 and keeping the deployment under the
  UK GDPR household exemption.
- **TrueLayer Data API v3** is the aggregator. Auth: `POST
  https://auth.truelayer.com/connect/token` (sandbox:
  `https://auth.truelayer-sandbox.com/connect/token`) with
  `grant_type=client_credentials`, `client_id`, `client_secret`,
  `scope=data`, returning a short-lived (default 3600s) app-level bearer
  token — not a per-user token, and not a signed JWT we construct ourselves.
  Data API base confirmed as the same host family as the auth host
  (`api.truelayer.com` / sandbox `api.truelayer-sandbox.com` — confirm exact
  data API base during implementation against the sandbox, since only the
  auth host was directly confirmed from docs fetched).
- **Prerequisite (manual, before implementation):** create a TrueLayer
  console account and a sandbox application to confirm the connection flow,
  bank list, and transaction shapes against real (sandboxed) responses
  before writing provider code against assumed shapes. TrueLayer's hosted
  consent page includes its own bank search UI, so there is no
  Enable-Banking-style "does our target bank appear in a country list" gate
  to check — TrueLayer's UK coverage is not in question, only the exact API
  mechanics are being confirmed.
- **Existing data model:** single DynamoDB table, `PK=USER#{auth0 sub}`,
  `SK=<ENTITY>#…`. Transactions store positive integer pence, a `type`
  (`EXPENSE` | `INCOME` | `INVESTMENT_IN` | `INVESTMENT_OUT`) and a required
  `categoryId`. Existing handlers live in `src/api/` and are unchanged by this
  spec except where stated.

## Product Decisions

**Imported transactions go to a review inbox.** They do not affect budgets,
targets or charts until the user confirms them. Confirming chooses a type and
category; ignoring discards the item permanently. Rejected: importing
straight into the budget as "Uncategorised" (totals wrong until tidied,
silent double-counting), and confidence-based auto-import (depends on spec 2;
revisit there).

**Settled transactions only.** TrueLayer's transaction `status` field is
`"pending"` or `"settled"` (different vocabulary from Enable Banking's
`BOOK`, but the same underlying distinction). Pending transactions often lack
stable identifiers in other providers and can change on settlement; TrueLayer
transactions do carry a stable `id` throughout, but we still only import
`"settled"` items to keep amounts/descriptions final once shown to the user.
A short delay before a transaction appears is acceptable for budgeting.

**Sync runs on a schedule plus a "Sync now" button.** Every 6 hours; manual
sync sends the caller's IP (`Tl-User-IP` header, confirmed supported on
TrueLayer's endpoints) so provider-side rate limiting can distinguish
user-present calls, mirroring the previous PSU-context design intent.

**History starts at a user-chosen start date** set when connecting, defaulting
to today. Users pick the day after their manual records end, so imports never
overlap hand-entered history. No duplicate-of-manual-entry detection in this
spec.

**Default type comes from direction:** money in → `INCOME`, money out →
`EXPENSE`; editable in the inbox (e.g. a Trading 212 deposit becomes
`INVESTMENT_IN`).

**Connection problems surface as an in-app banner** with a Reconnect action.
No email notifications (avoids extra infrastructure for self-hosters). Since
TrueLayer's v3 consent lifetime is unconfirmed, the banner triggers only on
a detected `EXPIRED`/`ERROR` status from actual API failures, not a
proactive "expires in N days" countdown (dropped from the Enable Banking
design, which had a confirmed `maximum_consent_validity` to count down from).

**GBP accounts only.** Non-GBP accounts (TrueLayer confirms `EUR` also
appears) in a session are ignored and shown as unsupported. The app has no
currency handling.

**All GBP accounts in a session are included.** No account picker;
disconnecting removes the whole connection.

**Bank selection happens on TrueLayer's own hosted page**, not in our UI.
`POST /v3/data-connections` can be called with or without a
`provider_selection` filter; the simplest and most maintenance-free option is
to omit it and let TrueLayer's hosted page show its own bank search,
eliminating the need for a `listBanks`-equivalent endpoint, a bank `Select`
component, and any bank-logo/display-name handling in our own UI. This is
a deliberate simplification versus the Enable Banking design's `/banks`
"searchable bank Select" — the "Connect a bank" flow becomes just a start-date
picker and a button.

## Architecture

```
                 ┌──────────────── API Gateway ────────────────┐
 Browser (SPA) ──┤ $default      → static Lambda (static_role) │
   /banks        │ /api/{proxy+} → API Lambda (api_role, JWT)  │
   /banks/callback                    │                        │
   /inbox        └────────────────────┼────────────────────────┘
                                      │ invoke (sync: commands, async: syncNow)
 EventBridge rate(6 hours) ───────► Bank worker Lambda (worker_role)
                                      │         └──► TrueLayer Data API v3
                                      ▼
                     DynamoDB (existing table)   Secrets Manager (TrueLayer client credentials)
```

The **bank worker** is a separate Lambda and the only component that can read
the TrueLayer client secret. The API Lambda reaches it by invoking a small,
validated set of commands; the static Lambda cannot reach it at all.

### Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `src/sync/types.ts` | `BankProvider`, `ProviderTransaction`, `Connection`, `ConnectedAccount`, `InboxItem`, `SyncStatus`, worker command types | — |
| `src/sync/amount.ts` | (unchanged; still used for any future provider needing string-decimal parsing — TrueLayer itself needs no parsing, see below) | — |
| `src/sync/txnKey.ts` | `deriveTxnKeys` — simplified for TrueLayer: every transaction has a real `id`, so the fallback/counter branch used for Enable Banking's nullable `entryReference` is unused for this provider (kept generic in case a future provider needs it) | `node:crypto` |
| `src/sync/window.ts` | `syncWindow` | — |
| `src/sync/errors.ts` | `ProviderError`, `classifyProviderError` | — |
| `src/sync/store.ts` | `SyncStore` interface | types |
| `src/sync/stores/dynamoSyncStore.ts` | DynamoDB implementation of `SyncStore` | `src/api/db.ts` |
| `src/sync/providers/trueLayerClient.ts` | Client-credentials token cache + retrying HTTP client | `fetch` |
| `src/sync/providers/trueLayer.ts` | `createConnection`, connection status polling, `endConnection` (if supported — see Disconnect below), `fetchTransactions` (submit + poll transactions-request), normalisation | `trueLayerClient` |
| `src/sync/runSync.ts` | `runSync(deps)` — the whole sync algorithm, platform-agnostic (unchanged) | interfaces only |
| `src/sync/commands.ts` | Worker command validation + dispatch | types, providers, store |
| `sync-handler.ts` (repo root) | Lambda entry: loads secret, builds deps, routes command or scheduled event | all of the above |
| `src/api/banks.ts` | `/api/banks/*` and `/api/sync*` handlers | Lambda invoke client, db |
| `src/api/inbox.ts` | `/api/inbox*` handlers | db, `validateTransactionInput` |
| `app/routes/banks.tsx`, `app/routes/banks.callback.tsx`, `app/routes/inbox.tsx` | UI (banks.tsx loses the bank-search picker, see Product Decisions) | `useProtectedApi` |

No `jsonwebtoken` dependency is needed for TrueLayer (Enable Banking needed
it to self-sign RS256 JWTs; TrueLayer instead exchanges `client_id` +
`client_secret` for a bearer token over HTTPS). If `jsonwebtoken` becomes
unused anywhere else in the codebase after this rewrite, removing it from
`package.json` is in scope for the task that removes the old Enable Banking
provider files.

### Provider interface

```ts
interface BankProvider {
  id: ProviderId; // 'truelayer' (spec 3 adds 'trading212')
  fetchTransactions(
    conn: Connection,
    account: ConnectedAccount,
    window: { from: string; to: string },
    ctx: { psu?: PsuContext; deadline: number },
  ): Promise<ProviderTransaction[]>;
}

interface ProviderTransaction {
  entryReference: string;       // TrueLayer always provides a stable `id` — never null for this provider
  amountPence: number;          // positive integer, derived from |amount_in_minor|
  direction: 'IN' | 'OUT';      // from the sign of amount_in_minor (negative = OUT)
  bookingDate: string;          // YYYY-MM-DD, derived from `timestamp`
  description: string;          // sanitised, ≤200 chars, from `description` (enrichment.merchant_name as a future improvement, out of scope here)
  currency: string;             // ISO 4217
  fallbackBasis: string;        // still computed for type-compatibility with deriveTxnKeys, but unused in practice since entryReference is never null for this provider
}
```

`entryReference` keeps its original type (`string | null`) at the
`ProviderTransaction` interface level, since `BankProvider` is shared across
future providers (spec 3's Trading 212) that may not guarantee a stable id.
TrueLayer's own normaliser simply never produces `null` there.

Connecting is **not** part of `BankProvider`: TrueLayer's hosted-page consent
and a pasted API key have nothing in common. Each provider exposes its own
connect functions, called from worker commands.

`Connection` is discriminated by `provider`, with provider-specific
credentials in an `auth` field so spec 3 can add a variant without reshaping
the item:

```ts
type Connection = ConnectionBase &
  ({ provider: 'truelayer'; auth: { providerConnectionId: string } }
   /* spec 3 adds: | { provider: 'trading212'; auth: { secretName: string } } */);
```

`providerConnectionId` is TrueLayer's own `id` from `POST
/v3/data-connections`, used as the `Connection-Id` header value on every
subsequent call for that connection. It is named distinctly from our own
`connectionId` (the `BANKCONN#` key) to avoid confusion between "our
connection record" and "TrueLayer's connection record" — they are related
one-to-one but are different identifiers in different systems.

Unlike the Enable Banking design (`auth: { sessionId, consentValidUntil }`),
there is no confirmed expiry timestamp to store, per the Provider Change Log
above — expiry is detected reactively via API errors, not read from a stored
field.

## Data Model

All items live in the existing table under the user's partition unless noted.
Unchanged from the Enable Banking version except where noted.

| Item | PK / SK | Fields | Lifetime |
|---|---|---|---|
| Pending auth | `USER#{sub}` / `BANKAUTH#{state}` | `startDate`, `reconnectConnectionId?`, `expiresAt` (epoch s) — drops `aspspName`/`aspspCountry` since there is no bank-picker step to persist a chosen bank name across the redirect | TTL 15 min |
| Connection | `USER#{sub}` / `BANKCONN#{connectionId}` | `connectionId`, `provider`, `displayName` (derived from `get-user-info`'s `name` field, or a generic "Bank account" if unavailable), `auth` (`{ providerConnectionId }`), `status` (`ACTIVE`\|`EXPIRED`\|`ERROR`), `consecutiveFailures`, `lastError?` (`{ type, at }`), `accounts[]`, `createdAt`, `updatedAt` | Until disconnected |
| Connected account (embedded) | — | `accountUid` (TrueLayer's `connected-accounts` `id`), `displayName`, `last4` (from `account_identifiers[].account_number`/`iban`), `currency`, `startDate`, `lastSyncedAt?` | With connection |
| Inbox item | `USER#{sub}` / `INBOX#{bookingDate}#{txnKey}` | `txnKey`, `amount`, `direction`, `suggestedType`, `description`, `bookingDate`, `connectionId`, `accountUid`, `importedAt`, `suggestion?` (reserved for spec 2) | Deleted on confirm/ignore |
| Seen marker | `USER#{sub}` / `SEEN#{txnKey}` | `outcome` (`PENDING`\|`CONFIRMED`\|`IGNORED`), `firstSeenAt` | Permanent |
| Sync status | `USER#{sub}` / `SYNCSTATUS` | `state` (`IDLE`\|`RUNNING`), `startedAt?`, `finishedAt?`, `lastResult?` (`{ imported, skipped, failedAccounts, partial }`) | Updated in place |
| User registry | `SYSTEM` / `CONNUSER#{sub}` | `createdAt` | Written on first connection; deleted when the user's last connection is removed |

`status: ERROR` is set when `consecutiveFailures ≥ 3` and reset to `ACTIVE` on
the next successful account sync. `consecutiveFailures` increments **at most
once per connection per run**, regardless of how many of the connection's
accounts fail in that run: a run counts as failed for this purpose if *any*
account in it failed. Concretely, a later account's success in the same run
must not reset `consecutiveFailures`/`status`/`lastError` if an earlier
account in that run already failed — the reset reads from the run's
`initial.consecutiveFailures` value rather than a running per-account
mutation, so the outcome is independent of account iteration order. Without
this, a connection with one permanently-broken account alongside otherwise
healthy accounts could never reach `ERROR`, since a healthy account's success
each run would keep resetting the counter.

### Dedupe key

`txnKey = sha256(provider | accountUid | entryReference).hex.slice(0, 32)`.

TrueLayer's `entryReference` is always its transaction `id`, which is
confirmed stable and non-null, so the fallback/counter branch (used for
Enable Banking's nullable `entryReference`) is never exercised for this
provider. `deriveTxnKeys` itself is unchanged — it already handles both
cases — this is purely a statement about which branch TrueLayer's normaliser
takes.

### Transaction additions (backwards compatible)

```ts
source?: 'MANUAL' | 'BANK';   // absent = MANUAL
bankRef?: { connectionId: string; accountUid: string; txnKey: string };
```

Unchanged from the Enable Banking design — this part of the schema is
provider-agnostic.

### Table changes

- `ttl { attribute_name = "expiresAt", enabled = true }`
- `server_side_encryption { enabled = true }` (AWS-managed KMS key)

Unchanged — already applied by the merged Task 5/11.

## Connection Flow

```
/banks            API Lambda                     Bank worker          TrueLayer        Bank
 │ POST /api/banks/connect { startDate }
 │                validate → state = randomUUID
 │                put BANKAUTH#state (TTL 15 min)
 │                invoke createConnection ──────────────────────► POST /v3/data-connections
 │                                                                    { scopes: [info,accounts,balance,transactions],
 │                                                                      data_access_type: "recurring",
 │                                                                      authorization_flow.redirect.return_uri: .../banks/callback,
 │                                                                      user_consent: {...} }
 │◄─────────────── { url, state } (hosted_page.uri, host allowlisted) ◄─┘
 │ window.location = url ──────────────────────────────────────────────────────► SCA + bank picker
 │◄──────────── /banks/callback?<TrueLayer's own redirect params> ◄─────────────────┘
/banks/callback
 │ POST /api/banks/callback { state }        (no `code` — see below)
 │                get BANKAUTH#state under caller's PK → 404 if absent
 │                invoke completeConnection ──────────────────► GET /v3/data-connections/{providerConnectionId}
 │                                                                (poll until status leaves authorization_required/authorizing;
 │                                                                 exact terminal status TBC against sandbox)
 │                worker: put/update BANKCONN#, put SYSTEM/CONNUSER#sub
 │                delete BANKAUTH#state; async invoke syncNow
 │◄─────────────── 201 { connection } → /banks shows "Syncing…"
```

- **No `code` param to exchange.** Since TrueLayer's v3 return-redirect
  params are unconfirmed (Provider Change Log), the callback handler does
  not attempt to read or validate any query params from the redirect beyond
  using it as a trigger to re-check status server-side. This is safer than
  the Enable Banking design's `code`/`state` exchange in one respect (no
  authorization code to protect) but means the worker must actively poll
  TrueLayer rather than trusting a one-shot code.
- **Validation (IO-01/02/07)** on `/connect`: body keys limited to
  `startDate` and optional `connectionId` (UUID, must be an existing
  connection of the caller's) — `aspspName`/`country` are dropped since
  there is no bank-picker step. `startDate` `YYYY-MM-DD`, not in the future,
  not more than 2 years ago. On `/callback`: `state` UUID format (no `code`
  field).
- **`/connect`'s response includes `state`** alongside `url` (extended from
  an initial `{ url }`-only contract, commit `1146b15`): the frontend must
  stash `state` client-side (`sessionStorage`) before `window.location`
  navigates away, since it needs to send `state` back on `/callback` and
  deliberately never reads it from TrueLayer's own (unconfirmed-shape)
  redirect query params. `state` here is the same server-generated value
  already written to `BANKAUTH#state`, just relayed back to the same
  authenticated caller that requested it — not a new value and not sourced
  from an untrusted redirect.
- **`providerConnectionId` stored** on `BANKAUTH#state` immediately after
  `createConnection` returns, so `/callback` knows which TrueLayer
  connection to poll without needing anything from the redirect itself.
- **State binding:** `BANKAUTH#state` is stored under the caller's PK, so a
  callback submitted by another user (or replayed after completion/expiry)
  finds nothing → 404. This is the CSRF defence — unchanged from the Enable
  Banking design.
- **Auth0 collision:** unchanged — `Auth0Provider` gets
  `skipRedirectCallback={window.location.pathname === '/banks/callback'}`.
  Note: since TrueLayer's own redirect params are unconfirmed, if they
  happen to also include `code`/`state` keys this collision guard still
  protects us regardless of what TrueLayer sends, because it keys off the
  pathname, not the query params.
- **Expired Auth0 session on return:** unchanged — the callback page stores
  the pending `state` in `sessionStorage`, triggers login, and resumes on
  return.
- **Bank error/cancel:** TrueLayer's hosted page redirect behaviour on
  cancel is unconfirmed; design assumes the same `return_uri` is used
  regardless of outcome, and the callback's `completeConnection` poll
  distinguishes success from failure/cancellation by the connection's
  actual status (or a timeout if it never leaves the pending states) rather
  than a query-string error code.
- **Reconnect:** `/connect` accepts optional `connectionId`; stored on the
  pending auth item. `completeConnection` updates the existing connection's
  `auth.providerConnectionId`, `status → ACTIVE`, `consecutiveFailures → 0`,
  keeping `startDate` and `lastSyncedAt`. Accounts are matched to existing
  ones by `accountUid` (TrueLayer's `connected-accounts` `id` — confirm
  during implementation whether this id is stable across a user
  reconnecting the same bank, or changes like Enable Banking's did; if it
  changes, the existing `dedupeId`-preservation design in `matchAccounts`
  already handles it via the `last4` + `displayName` fallback match).
- **Disconnect:** whether TrueLayer's v3 API exposes an explicit
  "end/revoke connection" call was not confirmed by the docs fetched for
  this rewrite — confirm during implementation; if none exists, disconnect
  becomes local-only (delete the connection record; the user separately
  revokes access via TrueLayer/their bank if they want to fully revoke
  consent) and this must be called out clearly in the self-hoster
  disconnect UI copy. Regardless, the worker still deletes the connection
  and its **pending** inbox items (and their `SEEN#` markers with outcome
  `PENDING`, so a future reconnect can re-import them rather than silently
  losing unreviewed items). Confirmed transactions and
  `CONFIRMED`/`IGNORED` markers remain.
- **Self-hoster setup:** create a TrueLayer console application (sandbox
  first, then a live/production one) and obtain `client_id`/`client_secret`.
  Confirm during implementation whether `return_uri`'s domain needs
  pre-registration in the console (Provider Change Log) and document
  whichever is true in the setup guide.

## Sync Algorithm

`runSync({ store, providers, now, deadline, userIds, psu? })` — **unchanged**
from the Enable Banking design; this is Task 8, already merged and
provider-agnostic. Only the provider-specific sub-steps differ:

For each user:

1. **Acquire lock:** conditional update `SYNCSTATUS.state = RUNNING,
   startedAt = now` where `state <> RUNNING OR startedAt < now − 10 min`.
   Condition fails → skip user.
2. For each connection with `status` `ACTIVE` or `ERROR`: attempt the sync;
   there is no proactive consent-expiry check to run before calling the
   provider (unlike Enable Banking's `consentValidUntil` check), since no
   confirmed expiry timestamp exists to check against — expiry surfaces only
   as an `EXPIRED`-classified error from an actual API call.
3. For each account (independently):
   1. If `deadline − now() < 60 s` → stop processing, `partial = true`.
   2. Window: `from = max(startDate, date(lastSyncedAt) − 5 days)`,
      `to = today`; first run uses `startDate`.
   3. `provider.fetchTransactions(...)` for TrueLayer:
      - `POST /v3/connected-accounts/{account_id}/transactions/requests`
        with `{ from, to }` → `{ id: requestId, status: "pending" }`.
      - Poll `GET
        /v3/connected-accounts/{account_id}/transactions/requests/{requestId}`
        until `status: "completed"` (bounded by both a max poll count,
        `MAX_STATUS_POLLS = 10`, and `ctx.deadline`: each loop iteration
        checks `ctx.deadline - now() < STATUS_POLL_INTERVAL_MS` before
        sleeping again and throws a `TRANSIENT` `ProviderError` immediately
        once insufficient time remains, rather than sleeping past the
        account's remaining budget and letting `runSync`'s outer
        `MIN_ACCOUNT_BUDGET_MS` check catch it after the fact; treat
        `status: "failed"` as a `TRANSIENT` or `INVALID_RESPONSE`
        `ProviderError` depending on the failure detail, and exhausting
        `MAX_STATUS_POLLS` before `completed` as `TRANSIENT`). The poll
        delay (`sleep`) and clock (`now`) are both injectable options on
        `createTrueLayerProvider`, mirroring `trueLayerClient`'s existing
        injectable `sleep`, so tests don't wait on real timers.
      - Follow `pagination.next_cursor` on the completed result until
        `null`.
   4. Normalise: skip non-GBP; skip `status !== "settled"`; skip
      `bookingDate < startDate` (derived from `timestamp`); amount =
      `Math.abs(amount_in_minor)` (already an integer, no string parsing);
      `direction` from the sign of `amount_in_minor` (negative → `OUT`,
      non-negative → `IN`); description = `description` field, else
      `"Bank transaction"`; strip control chars, collapse whitespace, trim
      to 200 chars; `entryReference` = the transaction's `id` (never null).
   5. `deriveTxnKeys` for the batch (fallback branch unused for this
      provider, see Dedupe key above).
   6. `BatchGet` `SEEN#` keys; for each unseen item a 2-item `TransactWrite`:
      put `SEEN#` (`attribute_not_exists(SK)`, outcome `PENDING`) + put
      `INBOX#`. `ConditionalCheckFailed` → count as `skipped`.
   7. Only after all pages are processed: set account `lastSyncedAt = now`,
      connection `consecutiveFailures = 0`, `status = ACTIVE`.
4. Release lock: `state = IDLE`, `finishedAt`, `lastResult`.

Scheduled runs take `userIds` from `Query PK=SYSTEM, begins_with(SK,
'CONNUSER#')` and run users sequentially within the deadline. `syncNow` runs
one user with `psu` = `{ ipAddress, userAgent }` taken from the API request
context, sent to TrueLayer as `Tl-User-IP` (and `X-Device-User-Agent` where
supported — confirm exact header name during implementation).

### Provider errors

| Classification | Trigger (TrueLayer error codes, confirmed from docs) | Action |
|---|---|---|
| `EXPIRED` | `invalid_grant` (400), `access_denied` (403), `unauthorized` (401), `invalid_token` (401) | Connection `EXPIRED`; skip its remaining accounts |
| `RATE_LIMITED` | `provider_too_many_requests` (429), `provider_request_limit_exceeded` (429) | Stop this connection for this run; `lastError` |
| `TRANSIENT` | `internal_server_error` (500), `provider_error` (503), `connector_overload` (503), `temporarily_unavailable` (503), `provider_timeout` (504), `connector_timeout` (504); also a transactions-request that never leaves `pending` within the polling budget | Retry twice (1 s, 4 s); then `consecutiveFailures++`, `lastError`; `ERROR` at ≥3 |
| `INVALID_RESPONSE` | `validation_error` (400), `invalid_date_range` (400), response fails shape check, or a transactions-request that reaches `status: "failed"` | `consecutiveFailures++`, `lastError`; log account id + type only |

This table replaces the Enable Banking version's HTTP-status-only mapping
with TrueLayer's actual documented error codes; `classifyHttpStatus`'s
generic 401/403/429/5xx bucketing in `src/sync/errors.ts` (Task 1, unchanged)
still works as a fallback for any status TrueLayer returns without a
matching documented error code in the response body.

### Limits

- Manual sync refused if `finishedAt` < 5 min ago (API 429) or `RUNNING` (409).
- Worker Lambda: timeout 300 s, 256 MB, async retries 0; `deadline` =
  `context.getRemainingTimeInMillis()` − 15 s.
- Schedule: `rate(6 hours)`.
- Transactions-request polling: bounded by a max poll count and the
  account's remaining deadline budget, whichever is hit first — exact poll
  interval/count to be tuned against sandbox response times during
  implementation (Enable Banking's design had no equivalent since it used
  synchronous pagination instead of an async job).

## API

All routes JWT-validated (AUTH-01) and registered in `api-handler.ts`.
Unchanged from the Enable Banking design except `/banks/aspsps` is removed
(no bank-picker step) and `/banks/connect`/`/banks/callback` bodies change.

| Route | Behaviour | Responses |
|---|---|---|
| `POST /api/banks/connect` | Start/reconnect auth (`{ startDate, connectionId? }`, no bank selection) | 200 `{ url, state }` / 400 / 404 (unknown `connectionId`) |
| `POST /api/banks/callback` | Complete connection (`{ state }`, no `code`) | 201 `{ connection }` / 400 / 404 |
| `DELETE /api/banks/auth/{state}` | Clear failed attempt | 204 |
| `GET /api/banks/connections` | Connections with derived `needsAttention`; `auth` stripped; no `expiresInDays` (unconfirmed expiry timing, see Provider Change Log) | 200 |
| `DELETE /api/banks/connections/{connectionId}` | Worker `disconnect` | 204 / 404 |
| `POST /api/sync` | Async invoke `syncNow` | 202 / 409 / 429 |
| `GET /api/sync/status` | `SYNCSTATUS` | 200 |
| `GET /api/inbox?cursor=` | Pending items newest first, limit 50 | 200 `{ items, cursor? }` / 400 |
| `GET /api/inbox/count` | Pending count | 200 `{ count }` |
| `POST /api/inbox/{bookingDate}/{txnKey}/confirm` | Body `{ type, categoryId, description? }` | 201 `{ transaction }` / 400 / 404 / 409 |
| `POST /api/inbox/{bookingDate}/{txnKey}/ignore` | Ignore | 204 / 404 |

`needsAttention` = `status` is `EXPIRED` or `ERROR` (the `expiresInDays ≤ 7`
clause from the Enable Banking design is dropped along with the countdown
concept it depended on).

**Confirm/Ignore/cursor/path params:** unchanged from the Enable Banking
design — all provider-agnostic.

## UI

Built with Mantine and `useProtectedApi`, following the visual-redesign
palette and navigation. Simplified from the Enable Banking design per the
bank-selection product decision above.

- **Navigation:** add "Inbox" (with pending-count badge) and "Banks" —
  unchanged.
- **Attention banner** in the layout when any connection `needsAttention`,
  linking to `/banks` — unchanged, but purely reactive (no countdown text
  possible without a confirmed expiry date).
- **`/banks`:** a card per connection — bank name (from `get-user-info`,
  falling back to a generic label if unavailable), accounts (`Current
  Account ••1234`), status badge, "Last synced 2h ago", Reconnect,
  Disconnect (Mantine confirm modal; copy notes that full revocation may
  require action on TrueLayer/the bank's side — see Disconnect above).
  "Connect a bank" modal: **no bank picker** — just a start date
  (`DateInput`, default today, max today, min 2 years ago) and a "Connect"
  button that redirects straight to TrueLayer's hosted page, which shows its
  own bank search. "Sync now" button polling `/api/sync/status` every 3 s
  while `RUNNING`.
- **`/banks/callback`:** loading state while `completeConnection` polls →
  redirect to `/banks` on success; error message + Retry on failure or
  timeout.
- **`/inbox`:** unchanged from the Enable Banking design — rows grouped by
  booking date, type `SegmentedControl`, category `Select`, Confirm/Ignore,
  optimistic removal, mobile card stacking, empty state.
- All bank-sourced text renders as React text nodes only (IO-05/06) —
  unchanged.

## Security & Infrastructure

### IAM (INFRA-01/02)

Unchanged in shape from the Enable Banking design — only the secret ARN
target and its field names change.

| Role | Permissions |
|---|---|
| `static_role` | CloudWatch Logs only |
| `api_role` | Existing DynamoDB actions on the table; `lambda:InvokeFunction` on the worker ARN only |
| `worker_role` | DynamoDB `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchGetItem`, `ConditionCheckItem`, `BatchWriteItem` on the table; `secretsmanager:GetSecretValue` on the TrueLayer secret ARN |

`api_role` additionally needs `ConditionCheckItem` for the confirm/ignore
transactions. EventBridge → worker `aws_lambda_permission` sets `source_arn`
to the rule. The worker has no API Gateway integration.

### Secrets (SEC-01/02/03/04/07)

- OpenTofu creates an empty secret `${app_name}/truelayer` (no
  `aws_secretsmanager_secret_version` resource). The deployer sets
  `{ "clientId": "…", "clientSecret": "…" }` with `aws secretsmanager
  put-secret-value`, so the credential never enters tfvars or state.
- Worker caches the `client_credentials` bearer token per warm container;
  tokens are reused until 5 minutes before their `expires_in` elapses (same
  caching pattern as Enable Banking's JWT cache, applied to a fetched token
  instead of a self-signed one).
- Rotation: create a new client secret in the TrueLayer console, update the
  AWS secret, revoke the old one. Documented in the setup guide.

### Worker command boundary (IO-01/02/07/08, AUTH-04)

Commands: `createConnection`, `completeConnection`, `syncNow`, `disconnect`,
plus the EventBridge scheduled event. `listBanks`/`startAuth` from the Enable
Banking design are removed (no bank-picker command) and `completeAuth`
becomes `completeConnection` (polls status rather than exchanging a code).
Each is a tagged union validated against an exact key allowlist; unknown
commands or fields are rejected. `userId` is always the API-verified JWT
`sub`. `createConnection` only returns a `hosted_page.uri` with `https:`
protocol and a host on an explicit TrueLayer allowlist (exact hosts confirmed
during implementation — likely `payment.truelayer.com`/`auth.truelayer.com`
family, confirm against a real sandbox response rather than guessing).

### Logging (AUTH-06, SEC-06, LOG-03/04/05)

Unchanged — structured JSON with ids, counts, error classifications and
durations only. Never logged: `state`, `providerConnectionId` (treat as
sensitive alongside the old `sessionId`), bearer tokens, secret values,
amounts, descriptions, account numbers, request/response bodies. Explicit
CloudWatch log groups for all three Lambdas with 14-day retention.

### Limits (INFRA-04)

Unchanged — worker timeout 300 s, memory 256 MB,
`aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0`.
No reserved concurrency.

### Known deviation: AUTH-03

Unchanged from the Enable Banking design — `DefaultLayout.tsx` stores Auth0
tokens in `localStorage` for the same reason (the bank redirect round-trip
must survive a full page navigation).

### New infrastructure

- `infra/sync-lambda.tf`: worker Lambda, `worker_role`, log group, EventBridge
  rule + target + permission, secret, event invoke config.
- `infra/lambda.tf` / `infra/api-lambda.tf`: role split, log groups.
- `infra/dynamodb.tf`: TTL, SSE, policy attachments per role.
- `infra/variables.tf`: `app_base_url`.
- `scripts/build-api-handler.cjs`: also compile `sync-handler.ts` to
  `build/sync/index.js`.
- CI: deploy step packages the worker zip.

Added running cost: ≈ $0.40/month (Secrets Manager); Lambda, EventBridge and
DynamoDB usage within free tier for one household. TrueLayer's own data
access is free at this volume (confirmed by user research, 2026-09-15).

### Dependencies (DEP-01/02/03)

**`jsonwebtoken` is no longer needed** by this feature (TrueLayer uses
client-credentials token exchange, not self-signed JWTs) — remove it from
`package.json` when the Enable Banking provider files are deleted, unless
something else in the codebase depends on it (check before removing). New
AWS SDK packages `@aws-sdk/client-lambda` and
`@aws-sdk/client-secrets-manager` (same family as the existing `@aws-sdk/*`
deps), pinned and audited — unchanged.

## Testing

TDD throughout, Vitest, following the existing `vi.hoisted` + mocked
`docClient.send` pattern. Unchanged in method from the Enable Banking
design; only the provider-specific fixtures change.

**Pure units (already merged, unaffected):** `deriveTxnKeys`, normalisation
shape, `syncWindow`, `classifyProviderError` — these test the
provider-agnostic layer and don't change.

**`runSync` with fakes (already merged, unaffected):** the `FakeProvider`
abstraction means `runSync.test.ts` needed no changes for the provider swap.

**Adapters (to be rewritten):** `trueLayerClient` with `vi.stubGlobal('fetch')`
and synthetic fixtures only (no real bank data in the repo): client-credentials
token fetch + cache/refresh timing, retry/backoff on `TRANSIENT` errors.
`trueLayer` provider: `createConnection` request shape, connection-status
polling terminating on the (sandbox-confirmed) ready status, transactions-request
submit + poll + pagination, normalisation (settled-only filter, sign-based
direction, minor-units amount, description fallback, control-char
stripping), auth URL host allowlist rejects look-alike hosts. Worker
commands: unknown command / extra fields rejected; scheduled event iterates
registered users.

**API handlers:** 400 for each invalid input; callback with unknown or
other user's `state` → 404; connections response has no `auth`; confirm
ignores body `amount`/`date`; confirm transaction conditions; cancelled
transaction → 404/409 not 500; forged cursor → 400; invoke payload `userId`
equals JWT `sub`; `/api/sync` 409 while running and 429 within 5 min.
Unchanged from the Enable Banking design — provider-agnostic.

**Manual verification checklist:** TrueLayer sandbox connect + cancel at the
mock bank; confirm the terminal connection status and redirect param shape
against the real sandbox response (the two flagged unconfirmed items);
callback with and without an expired Auth0 session; inbox confirm/ignore at
mobile width; banner on a connection that fails with an EXPIRED-classified
error; real UK bank in production: connect → first sync → confirm → re-sync
shows no duplicates. Infra: `tofu validate` and plan review confirm
`static_role` has no DynamoDB/invoke permissions, worker has no API route,
secret value absent from state. Before PR: SECURITY.md checklist and
security review of the diff.

## Out of Scope

Pending transactions; non-GBP accounts; account selection within a session;
bulk ignore/confirm; editing amount or date on confirm; duplicate-of-manual
detection; email/push notifications; categorisation rules (spec 2); Trading
212 (spec 3); non-AWS storage and Docker (spec 4); TrueLayer payment
initiation / VRP (this spec is account-information/read-only only, not
payment features TrueLayer also offers).
