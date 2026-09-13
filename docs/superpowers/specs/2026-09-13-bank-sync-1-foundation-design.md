# Bank Sync 1 — Sync Foundation & Enable Banking Design

**Date:** 2026-09-13
**Status:** Approved for planning
**Series:** Bank sync specs 1–4. This spec is the foundation; specs 2
(auto-categorisation), 3 (Trading 212) and 4 (self-hosted Docker) build on the
interfaces defined here.
**Covers:** Connecting UK bank accounts via Enable Banking, scheduled + manual
sync of booked transactions into a review inbox, confirm/ignore flow,
connection health, the IAM/secrets/infra needed to run it safely
**Defers:** Categorisation rules (spec 2), Trading 212 (spec 3), non-DynamoDB
storage and Docker (spec 4), pending transactions, non-GBP accounts,
bulk inbox actions, per-account selection

## Goal

Manual entry is the biggest friction in the app. This spec pulls booked
transactions from the user's bank accounts automatically and puts them in a
review inbox, so the budget stays accurate with a few taps instead of typing
every purchase — without the app ever holding bank credentials, and without
the author holding anyone's data.

## Context & Constraints

- **Distribution model is single-tenant self-hosting.** Each deployment belongs
  to one household. The deployer registers their *own* Enable Banking
  application in free **restricted mode** (only accounts they link in their
  own Enable Banking control panel are accessible). The project author never
  operates an instance or shares aggregator credentials. This keeps aggregator
  cost at £0 and keeps the deployment under the UK GDPR household exemption.
- **Enable Banking** is the aggregator (GoCardless Bank Account Data closed to
  new signups in July 2025). API base `https://api.enablebanking.com`; app JWT
  is RS256 with `kid` = application id, `iss` `enablebanking.com`, `aud`
  `api.enablebanking.com`, `exp` ≤ `iat` + 3600.
- **Prerequisite (manual, before implementation):** confirm Lloyds appears in
  `GET /aspsps?country=GB` for the deployer's Enable Banking app and can be
  linked in restricted mode. If not, this spec's provider changes (fallback:
  TrueLayer or Yapily, both sales-priced) but the rest of the design stands.
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

**Booked (settled) transactions only.** Pending transactions often lack
stable IDs and change amount/description on settlement, which would require
fuzzy matching. A 1–3 day delay is acceptable for budgeting.

**Sync runs on a schedule plus a "Sync now" button.** Every 6 hours
(4/day stays within UK unattended-access limits); manual sync is sent with
PSU context so it counts as user-present.

**History starts at a user-chosen start date** set when connecting, defaulting
to today. Users pick the day after their manual records end, so imports never
overlap hand-entered history. No duplicate-of-manual-entry detection in this
spec.

**Default type comes from direction:** money in → `INCOME`, money out →
`EXPENSE`; editable in the inbox (e.g. a Trading 212 deposit becomes
`INVESTMENT_IN`).

**Connection problems surface as an in-app banner** with a Reconnect action.
No email notifications (avoids extra infrastructure for self-hosters).

**GBP accounts only.** Non-GBP accounts in a session are ignored and shown as
unsupported. The app has no currency handling.

**All GBP accounts in a session are included.** No account picker;
disconnecting removes the whole connection.

## Architecture

```
                 ┌──────────────── API Gateway ────────────────┐
 Browser (SPA) ──┤ $default      → static Lambda (static_role) │
   /banks        │ /api/{proxy+} → API Lambda (api_role, JWT)  │
   /banks/callback                    │                        │
   /inbox        └────────────────────┼────────────────────────┘
                                      │ invoke (sync: commands, async: syncNow)
 EventBridge rate(6 hours) ───────► Bank worker Lambda (worker_role)
                                      │         └──► Enable Banking API
                                      ▼
                     DynamoDB (existing table)   Secrets Manager (EB app key)
```

The **bank worker** is a separate Lambda and the only component that can read
the Enable Banking private key. The API Lambda reaches it by invoking a small,
validated set of commands; the static Lambda cannot reach it at all.

### Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `src/sync/types.ts` | `BankProvider`, `ProviderTransaction`, `Connection`, `ConnectedAccount`, `InboxItem`, `SyncStatus`, worker command types | — |
| `src/sync/amount.ts` | `parseAmountToPence` (string-based decimal parsing) | — |
| `src/sync/txnKey.ts` | `deriveTxnKeys` (dedupe keys incl. fallback counter) | `node:crypto` |
| `src/sync/window.ts` | `syncWindow` | — |
| `src/sync/errors.ts` | `ProviderError`, `classifyProviderError` | — |
| `src/sync/store.ts` | `SyncStore` interface | types |
| `src/sync/stores/dynamoSyncStore.ts` | DynamoDB implementation of `SyncStore` | `src/api/db.ts` |
| `src/sync/providers/enableBanking.ts` | JWT signing, `listBanks`, `startAuth`, `completeAuth`, `endSession`, `fetchTransactions`, normalisation | `fetch`, `jsonwebtoken` |
| `src/sync/runSync.ts` | `runSync(deps)` — the whole sync algorithm, platform-agnostic | interfaces only |
| `src/sync/commands.ts` | Worker command validation + dispatch | types, providers, store |
| `sync-handler.ts` (repo root) | Lambda entry: loads secret, builds deps, routes command or scheduled event | all of the above |
| `src/api/banks.ts` | `/api/banks/*` and `/api/sync*` handlers | Lambda invoke client, db |
| `src/api/inbox.ts` | `/api/inbox*` handlers | db, `validateTransactionInput` |
| `app/routes/banks.tsx`, `app/routes/banks.callback.tsx`, `app/routes/inbox.tsx` | UI | `useProtectedApi` |

### Provider interface

```ts
interface BankProvider {
  id: ProviderId; // 'enable-banking' (spec 3 adds 'trading212')
  fetchTransactions(
    conn: Connection,
    account: ConnectedAccount,
    window: { from: string; to: string },
    ctx: { psu?: PsuContext; deadline: number },
  ): Promise<ProviderTransaction[]>;
}

interface ProviderTransaction {
  entryReference: string | null;
  amountPence: number;          // positive integer
  direction: 'IN' | 'OUT';
  bookingDate: string;          // YYYY-MM-DD
  description: string;          // sanitised, ≤200 chars
  currency: string;             // ISO 4217
  fallbackBasis: string;        // stable fields used when entryReference is null
}
```

Connecting is **not** part of `BankProvider`: redirect-based consent and a
pasted API key have nothing in common. Each provider exposes its own connect
functions, called from worker commands.

`Connection` is discriminated by `provider`, with provider-specific
credentials in an `auth` field so spec 3 can add a variant without reshaping
the item:

```ts
type Connection = ConnectionBase &
  ({ provider: 'enable-banking'; auth: { sessionId: string; consentValidUntil: string } }
   /* spec 3 adds: | { provider: 'trading212'; auth: { secretName: string } } */);
```

## Data Model

All items live in the existing table under the user's partition unless noted.

| Item | PK / SK | Fields | Lifetime |
|---|---|---|---|
| Pending auth | `USER#{sub}` / `BANKAUTH#{state}` | `aspspName`, `aspspCountry`, `startDate`, `reconnectConnectionId?`, `expiresAt` (epoch s) | TTL 15 min |
| Connection | `USER#{sub}` / `BANKCONN#{connectionId}` | `connectionId`, `provider`, `displayName` (bank name), `auth`, `status` (`ACTIVE`\|`EXPIRED`\|`ERROR`), `consecutiveFailures`, `lastError?` (`{ type, at }`), `accounts[]`, `createdAt`, `updatedAt` | Until disconnected |
| Connected account (embedded) | — | `accountUid`, `displayName`, `last4`, `currency`, `startDate`, `lastSyncedAt?` | With connection |
| Inbox item | `USER#{sub}` / `INBOX#{bookingDate}#{txnKey}` | `txnKey`, `amount`, `direction`, `suggestedType`, `description`, `bookingDate`, `connectionId`, `accountUid`, `importedAt`, `suggestion?` (reserved for spec 2) | Deleted on confirm/ignore |
| Seen marker | `USER#{sub}` / `SEEN#{txnKey}` | `outcome` (`PENDING`\|`CONFIRMED`\|`IGNORED`), `firstSeenAt` | Permanent |
| Sync status | `USER#{sub}` / `SYNCSTATUS` | `state` (`IDLE`\|`RUNNING`), `startedAt?`, `finishedAt?`, `lastResult?` (`{ imported, skipped, failedAccounts, partial }`) | Updated in place |
| User registry | `SYSTEM` / `CONNUSER#{sub}` | `createdAt` | Written on first connection; deleted when the user's last connection is removed |

`status: ERROR` is set when `consecutiveFailures ≥ 3` and reset to `ACTIVE` on
the next successful account sync.

### Dedupe key

`txnKey = sha256(provider | accountUid | entryReference).hex.slice(0, 32)`.

When `entryReference` is null: `sha256(provider | accountUid | fallbackBasis | n)`
where `fallbackBasis = bookingDate | amountPence | direction | description`
and `n` is the 0-based index among transactions with an identical
`fallbackBasis` **on that booking date**. Because every sync window starts at
the beginning of a day, each run sees whole days, so `n` is stable regardless
of the order the API returns items in (identical items are interchangeable).

### Transaction additions (backwards compatible)

```ts
source?: 'MANUAL' | 'BANK';   // absent = MANUAL
bankRef?: { connectionId: string; accountUid: string; txnKey: string };
```

A confirmed inbox item becomes a normal `TXN#{yearMonth}#{txnKey}` item with
`transactionId = txnKey`. Existing reads, budgets, targets and charts need no
changes. Editing a bank-sourced transaction through the existing update
endpoint is allowed and must preserve `source`/`bankRef`: `updateTransaction`
in `src/api/transactions.ts` currently rebuilds the item from validated input
plus `createdAt`, so it is changed to carry both fields over from the existing
item (with a test).

### Table changes

- `ttl { attribute_name = "expiresAt", enabled = true }`
- `server_side_encryption { enabled = true }` (AWS-managed KMS key)

## Connection Flow

```
/banks            API Lambda                     Bank worker          Enable Banking   Bank
 │ GET /api/banks/aspsps?country=GB ─► invoke listBanks ─────────► GET /aspsps
 │◄─────────────── [{ name, logo, maximumConsentValidity }] ◄──────────┘
 │ POST /api/banks/connect { aspspName, country, startDate }
 │                validate → state = randomUUID
 │                put BANKAUTH#state (TTL 15 min)
 │                invoke startAuth ───────────────────────────► POST /auth
 │◄─────────────── { url } (host allowlisted) ◄────────────────────────┘
 │ window.location = url ──────────────────────────────────────────────────────► SCA
 │◄──────────── /banks/callback?code&state ◄───────────────────────────────────────┘
/banks/callback
 │ POST /api/banks/callback { code, state }
 │                get BANKAUTH#state under caller's PK → 404 if absent
 │                invoke completeAuth ────────────────────────► POST /sessions { code }
 │                worker: put/update BANKCONN#, put SYSTEM/CONNUSER#sub
 │                delete BANKAUTH#state; async invoke syncNow
 │◄─────────────── 201 { connection } → /banks shows "Syncing…"
```

- **Validation (IO-01/02/07)** on `/connect`: body keys limited to
  `aspspName`, `country`, `startDate` and optional `connectionId` (UUID, must
  be an existing connection of the caller's); `startDate` `YYYY-MM-DD`, not in the
  future, not more than 2 years ago; `country` allowlist `['GB']`;
  `aspspName` string 1–100 chars. On `/callback`: `code` string 1–2048 chars,
  `state` UUID format.
- **Consent validity** requested: `min(aspsp.maximum_consent_validity, 180 days)`.
- **State binding:** `BANKAUTH#state` is stored under the caller's PK, so a
  callback submitted by another user (or replayed after completion/expiry)
  finds nothing → 404. This is the CSRF defence.
- **Auth0 collision:** Auth0's SDK treats any URL with `code` + `state`
  query params as its own callback. `Auth0Provider` gets
  `skipRedirectCallback={window.location.pathname === '/banks/callback'}`.
- **Expired Auth0 session on return:** the callback page stores `code`/`state`
  in `sessionStorage`, triggers login, and resumes on return.
- **Bank error/cancel** (`?error=&error_description=&state=`): show a friendly
  message (rendered as text) with Retry; call `DELETE /api/banks/auth/{state}`.
- **Reconnect:** `/connect` accepts optional `connectionId`; stored on the
  pending auth item. `completeAuth` updates the existing connection's
  `auth`, `status → ACTIVE`, `consecutiveFailures → 0`, keeping `startDate` and
  `lastSyncedAt`. Accounts are matched to existing ones by `accountUid`, then
  by `last4` + `displayName`; unmatched accounts are added with
  `startDate` = reconnect date.
- **Disconnect:** worker calls Enable Banking to end the session (best effort;
  failure is logged by type and does not block), deletes the connection and
  its **pending** inbox items (and their `SEEN#` markers with outcome
  `PENDING`, so a future reconnect can re-import them rather than silently
  losing unreviewed items). Confirmed
  transactions and `CONFIRMED`/`IGNORED` markers remain.
- **Self-hoster setup:** register `https://{app_base_url}/banks/callback` as a
  redirect URL in the Enable Banking control panel.

## Sync Algorithm

`runSync({ store, providers, now, deadline, userIds, psu? })`

For each user:

1. **Acquire lock:** conditional update `SYNCSTATUS.state = RUNNING,
   startedAt = now` where `state <> RUNNING OR startedAt < now − 10 min`.
   Condition fails → skip user.
2. For each connection with `status` `ACTIVE` or `ERROR`:
   - Enable Banking with `consentValidUntil < now` → set `EXPIRED`, skip.
3. For each account (independently):
   1. If `deadline − now() < 60 s` → stop processing, `partial = true`.
   2. Window: `from = max(startDate, date(lastSyncedAt) − 5 days)`,
      `to = today`; first run uses `startDate`.
   3. `provider.fetchTransactions(...)` — Enable Banking uses
      `GET /accounts/{uid}/transactions?date_from&date_to&transaction_status=BOOK`,
      following `continuation_key`, max 50 pages.
   4. Normalise: skip non-GBP and `bookingDate < startDate`; amount via
      `parseAmountToPence`; `direction` from `credit_debit_indicator`
      (`CRDT` → `IN`, `DBIT` → `OUT`); description = joined
      `remittance_information`, else creditor/debtor name, else `"Bank transaction"`;
      strip control chars, collapse whitespace, trim to 200 chars.
   5. `deriveTxnKeys` for the batch.
   6. `BatchGet` `SEEN#` keys; for each unseen item a 2-item `TransactWrite`:
      put `SEEN#` (`attribute_not_exists(SK)`, outcome `PENDING`) + put
      `INBOX#`. `ConditionalCheckFailed` → count as `skipped`.
   7. Only after all pages are processed: set account `lastSyncedAt = now`,
      connection `consecutiveFailures = 0`, `status = ACTIVE`.
4. Release lock: `state = IDLE`, `finishedAt`, `lastResult`.

Scheduled runs take `userIds` from `Query PK=SYSTEM, begins_with(SK, 'CONNUSER#')`
and run users sequentially within the deadline. `syncNow` runs one user with
`psu` = `{ ipAddress, userAgent }` taken from the API request context
(header names confirmed against Enable Banking docs during implementation).

### Provider errors

| Classification | Trigger | Action |
|---|---|---|
| `EXPIRED` | 401/403, or consent-expired/revoked error body | Connection `EXPIRED`; skip its remaining accounts |
| `RATE_LIMITED` | 429 | Stop this connection for this run; `lastError` |
| `TRANSIENT` | 5xx, network error, timeout | Retry twice (1 s, 4 s); then `consecutiveFailures++`, `lastError`; `ERROR` at ≥3 |
| `INVALID_RESPONSE` | Response fails shape check | `consecutiveFailures++`, `lastError`; log account id + type only |

### Limits

- Manual sync refused if `finishedAt` < 5 min ago (API 429) or `RUNNING` (409).
- Worker Lambda: timeout 300 s, 256 MB, async retries 0; `deadline` =
  `context.getRemainingTimeInMillis()` − 15 s.
- Schedule: `rate(6 hours)`.

## API

All routes JWT-validated (AUTH-01) and registered in `api-handler.ts`.

| Route | Behaviour | Responses |
|---|---|---|
| `GET /api/banks/aspsps?country=GB` | Worker `listBanks` | 200 `{ aspsps }` / 400 |
| `POST /api/banks/connect` | Start/reconnect auth | 200 `{ url }` / 400 / 404 (unknown `connectionId`) |
| `POST /api/banks/callback` | Complete auth | 201 `{ connection }` / 400 / 404 |
| `DELETE /api/banks/auth/{state}` | Clear failed attempt | 204 |
| `GET /api/banks/connections` | Connections with derived `expiresInDays`, `needsAttention`; `auth` stripped | 200 |
| `DELETE /api/banks/connections/{connectionId}` | Worker `disconnect` | 204 / 404 |
| `POST /api/sync` | Async invoke `syncNow` | 202 / 409 / 429 |
| `GET /api/sync/status` | `SYNCSTATUS` | 200 |
| `GET /api/inbox?cursor=` | Pending items newest first, limit 50 | 200 `{ items, cursor? }` / 400 |
| `GET /api/inbox/count` | Pending count | 200 `{ count }` |
| `POST /api/inbox/{bookingDate}/{txnKey}/confirm` | Body `{ type, categoryId, description? }` | 201 `{ transaction }` / 400 / 404 / 409 |
| `POST /api/inbox/{bookingDate}/{txnKey}/ignore` | Ignore | 204 / 404 |

`needsAttention` = `status` is `EXPIRED` or `ERROR`, or `expiresInDays ≤ 7`.

**Confirm:** amount and date come from the stored inbox item, never the
request body (unknown body keys → 400). Input is validated with the existing
`validateTransactionInput`. One `TransactWrite`: put `TXN#` with
`attribute_not_exists(SK)`, `source: 'BANK'`, `bankRef`; delete `INBOX#` with
`attribute_exists(SK)`; update `SEEN#.outcome = CONFIRMED`. Transaction
cancelled because the inbox item is gone → 404; because the `TXN#` exists →
409.

**Ignore:** one `TransactWrite`: delete `INBOX#` (`attribute_exists`), update
`SEEN#.outcome = IGNORED`.

**Deleting a confirmed transaction** via the existing endpoint leaves its
`SEEN#` as `CONFIRMED`; it is not re-imported.

**Cursor (IO-01):** base64url JSON of `LastEvaluatedKey`; rejected with 400
unless `PK` equals the caller's PK and `SK` starts with `INBOX#`.

**Path params:** `bookingDate` `^\d{4}-\d{2}-\d{2}$`, `txnKey` `^[0-9a-f]{32}$`,
`connectionId` UUID, `state` UUID.

## UI

Built with Mantine and `useProtectedApi`, following the visual-redesign
palette and navigation.

- **Navigation:** add "Inbox" (with pending-count badge) and "Banks".
- **Attention banner** in the layout when any connection `needsAttention`,
  linking to `/banks`.
- **`/banks`:** a card per connection — bank name, accounts
  (`Current Account ••1234`), status badge, "Last synced 2h ago", consent
  expiry, Reconnect, Disconnect (Mantine confirm modal). "Connect a bank"
  modal: searchable bank `Select` and start date (`DateInput`, default today,
  max today, min 2 years ago). "Sync now" button polling `/api/sync/status`
  every 3 s while `RUNNING`.
- **`/banks/callback`:** loading state → redirect to `/banks` on success;
  error message + Retry on failure.
- **`/inbox`:** rows grouped by booking date — description, account, amount
  (green in / red out), type `SegmentedControl` preset to `suggestedType`,
  category `Select` filtered by the type's category type (`EXPENSE` →
  `EXPENSE`, `INCOME` → `INCOME`, `INVESTMENT_*` → `INVESTMENT`), Confirm and
  Ignore. Optimistic removal, restored on failure. Rows stack as cards on
  narrow screens. Empty state: "All caught up" + last sync time.
- All bank-sourced text renders as React text nodes only (IO-05/06).

## Security & Infrastructure

### IAM (INFRA-01/02)

The existing shared `lambda_role` is split — today the unauthenticated static
Lambda has DynamoDB access, which becomes a real risk once the API role can
trigger bank calls.

| Role | Permissions |
|---|---|
| `static_role` | CloudWatch Logs only |
| `api_role` | Existing DynamoDB actions on the table; `lambda:InvokeFunction` on the worker ARN only |
| `worker_role` | DynamoDB `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchGetItem`, `ConditionCheckItem` on the table; `secretsmanager:GetSecretValue` on the Enable Banking secret ARN |

`api_role` additionally needs `ConditionCheckItem` for the confirm/ignore
transactions. EventBridge → worker `aws_lambda_permission` sets `source_arn`
to the rule. The worker has no API Gateway integration.

### Secrets (SEC-01/02/03/04/07)

- OpenTofu creates an empty secret `${app_name}/enable-banking` (no
  `aws_secretsmanager_secret_version` resource). The deployer sets
  `{ "applicationId": "…", "privateKeyPem": "…" }` with
  `aws secretsmanager put-secret-value`, so the key never enters tfvars or
  state.
- Worker caches the secret per warm container; JWTs are reused until 5 min
  before expiry.
- Rotation: create a new key in Enable Banking, update the secret, revoke the
  old key. Documented in the setup guide.

### Worker command boundary (IO-01/02/07/08, AUTH-04)

Commands: `listBanks`, `startAuth`, `completeAuth`, `syncNow`, `disconnect`,
plus the EventBridge scheduled event. Each is a tagged union validated
against an exact key allowlist; unknown commands or fields are rejected.
`userId` is always the API-verified JWT `sub`. `startAuth` only returns an
auth URL with `https:` protocol and a host on an explicit Enable Banking
allowlist (exact hosts confirmed during implementation).

### Logging (AUTH-06, SEC-06, LOG-03/04/05)

Structured JSON with ids, counts, error classifications and durations only.
Never logged: `code`, `state`, `sessionId`, JWTs, secret values, amounts,
descriptions, account numbers, request/response bodies. Explicit CloudWatch
log groups for all three Lambdas with 14-day retention.

### Limits (INFRA-04)

Worker timeout 300 s, memory 256 MB, `aws_lambda_function_event_invoke_config`
with `maximum_retry_attempts = 0`. No reserved concurrency (often unavailable
on new accounts; the lock prevents overlap).

### Known deviation: AUTH-03

`DefaultLayout.tsx` stores Auth0 tokens in `localStorage`
(`cacheLocation="localstorage"`, refresh tokens). This predates the spec and
contradicts AUTH-03, but the bank redirect round-trip depends on the session
surviving a full page navigation. It is retained and recorded here.
Mitigations: strict CSP, no `dangerouslySetInnerHTML`, bank text rendered as
text only.

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
DynamoDB usage within free tier for one household.

### Dependencies (DEP-01/02/03)

No new third-party runtime libraries. JWT signing uses existing
`jsonwebtoken`; hashing uses `node:crypto`. New AWS SDK packages
`@aws-sdk/client-lambda` and `@aws-sdk/client-secrets-manager` (same family as
the existing `@aws-sdk/*` deps), pinned and audited.

## Testing

TDD throughout, Vitest, following the existing `vi.hoisted` + mocked
`docClient.send` pattern.

**Pure units:** `parseAmountToPence` (`"12.34"`→1234, `"12.3"`→1230,
`"12"`→1200; rejects `"12.345"`, `"1e3"`, `""`, `"abc"`, `"-5.00"`);
`deriveTxnKeys` (stable with `entryReference`; fallback keys identical under
shuffled input order; distinct keys for identical same-day items; account
isolation); normalisation (description fallbacks, control-char stripping,
200-char cap, non-GBP and pre-`startDate` skipped); `syncWindow`;
`classifyProviderError`.

**`runSync` with fakes:** an in-memory `FakeSyncStore` that enforces
conditional-write semantics, and a `FakeProvider` with scripted pages and
errors. Cases: two runs → same inbox; overlap → skipped not errors; page-2
failure → `lastSyncedAt` unchanged and other accounts still sync; 401 →
`EXPIRED` without affecting other connections; deadline → stops before next
account with `partial`; held lock → skip; stale lock → taken; seen-marker
condition conflict → `skipped`; expired consent → no provider call.

**Adapters:** `dynamoSyncStore` sends the expected keys,
`ConditionExpression`s and transaction shapes. `enableBanking` with
`vi.stubGlobal('fetch')` and synthetic fixtures only (no real bank data in
the repo): continuation paging, 50-page cap, JWT signed with a test-generated
RSA key and verified (`kid`, `iss`, `aud`, `exp`), auth URL allowlist rejects
look-alike hosts. Worker commands: unknown command / extra fields rejected;
scheduled event iterates registered users.

**API handlers:** 400 for each invalid input; callback with unknown or other
user's `state` → 404; connections response has no `auth`; confirm ignores
body `amount`/`date`; confirm transaction conditions; cancelled transaction →
404/409 not 500; forged cursor → 400; invoke payload `userId` equals JWT
`sub`; `/api/sync` 409 while running and 429 within 5 min.

**Manual verification checklist:** Enable Banking sandbox mock ASPSP connect
+ cancel at bank; callback with and without an expired Auth0 session; inbox
confirm/ignore at mobile width; banner on an expired connection; real Lloyds
in restricted mode: connect → first sync → confirm → re-sync shows no
duplicates. Infra: `tofu validate` and plan review confirm `static_role` has
no DynamoDB/invoke permissions, worker has no API route, secret value absent
from state. Before PR: SECURITY.md checklist and security review of the diff.

## Out of Scope

Pending transactions; non-GBP accounts; account selection within a session;
bulk ignore/confirm; editing amount or date on confirm; duplicate-of-manual
detection; email/push notifications; categorisation rules (spec 2); Trading
212 (spec 3); non-AWS storage and Docker (spec 4).
