# Bank Sync 2 — Auto-Categorisation Rules Design

**Date:** 2026-09-13
**Status:** Draft — product direction approved, details pending review
**Series:** Bank sync specs 1–4. Depends on spec 1.
**Covers:** Rules that suggest a type and category for inbox items, learning
rules from confirmations, a rules management page
**Defers:** AI/LLM categorisation (candidate Pro add-on), auto-confirming
without review, duplicate-of-manual-entry detection (optional extension below)

## Goal

Spec 1 makes importing automatic but categorising still manual. This spec
makes the inbox mostly "tap Confirm": each imported item arrives with a
suggested type and category, learned from the user's own past confirmations.

## Product Decisions

**Learn from confirmations plus editable rules.** When confirming an inbox
item the user can tick "Remember for similar transactions", which creates a
rule. Rules are listed on a page where they can be edited, reordered and
deleted. Rejected: hand-written rules only (tedious setup), AI categorisation
(needs per-deployer API keys, sends descriptions to a third party, contradicts
"data never leaves your instance"; reserved for a possible Pro add-on).

**Suggestions never bypass review.** Inbox items still require Confirm (spec 1
decision). A suggestion only pre-fills the type and category controls.

**First matching rule wins, in user-defined order.** Predictable and easy to
explain; no scoring.

### Decisions made during spec writing (review these)

- **Matching is a case-insensitive substring match on a normalised
  description.** Normalisation: uppercase, strip digits and punctuation,
  collapse whitespace. `"TESCO STORES 1234 LONDON"` → `"TESCO STORES LONDON"`.
  This absorbs store numbers and card-reference noise without regex.
- **The suggested pattern when learning** is the first two normalised words
  of the description (`"TESCO STORES"`), editable in the confirm UI before
  saving. Users can shorten it to `"TESCO"`.
- **Optional account scope:** a rule may be limited to one connected account
  (useful when the same payee means different things on different accounts).
  Default: all accounts.
- **Optional direction scope:** `IN`, `OUT`, or any. Learned rules default to
  the confirmed item's direction so a refund doesn't get categorised as the
  purchase category's expense.
- **No regex rules.** Avoids ReDoS risk (IO-03-adjacent) and keeps the UI
  simple. Revisit if substring proves insufficient.

## Assumptions About Spec 1

If any of these change during spec 1 implementation, update this spec.

1. `InboxItem` has an optional `suggestion?: { type, categoryId, ruleId }`
   field that spec 1 writes as absent.
2. `runSync` writes inbox items in one place (the 2-item `TransactWrite`) so a
   suggestion can be computed immediately before that write.
3. `POST /api/inbox/{bookingDate}/{txnKey}/confirm` validates body keys with
   an explicit allowlist that this spec extends with `rememberRule`.
4. The `SyncStore` interface can be extended with rule reads without breaking
   the DynamoDB implementation.
5. Inbox items store `description`, `direction` and `accountUid`.

## Data Model

| Item | PK / SK | Fields |
|---|---|---|
| Rule | `USER#{sub}` / `RULE#{ruleId}` | `ruleId`, `pattern` (normalised, 2–60 chars), `direction` (`IN`\|`OUT`\|`ANY`), `accountUid?`, `type`, `categoryId`, `position` (integer), `createdAt`, `updatedAt`, `matchCount`, `lastMatchedAt?` |

Rules are read with one `Query begins_with(SK, 'RULE#')` and sorted by
`position` in memory — a household has tens of rules, not thousands. Cap: 500
rules per user (API rejects beyond).

`matchCount`/`lastMatchedAt` are updated on confirm (not on suggest) so the
rules page can show which rules are actually used.

## Components

| Module | Responsibility |
|---|---|
| `src/rules/normalise.ts` | `normaliseDescription(s)` |
| `src/rules/match.ts` | `matchRule(rules, item): Rule \| null` (pure) |
| `src/rules/suggestPattern.ts` | `suggestPattern(description)` (pure) |
| `src/api/rules.ts` | Rules CRUD + reorder handlers |
| `src/sync/runSync.ts` (change) | Load rules once per user; set `suggestion` on new inbox items |
| `src/api/inbox.ts` (change) | `rememberRule` on confirm; `POST /api/inbox/apply-rules` |
| `app/routes/rules.tsx` | Rules page |
| `app/routes/inbox.tsx` (change) | Pre-fill from suggestion; "Remember" checkbox with editable pattern |

## Behaviour

**During sync:** after normalising a new transaction and before writing it,
`matchRule` runs against the user's rules. A match sets
`suggestion = { type, categoryId, ruleId }`, and `suggestedType` takes the
rule's type.

**Rule created or edited:** existing pending inbox items do not change
automatically. The rules page and inbox offer "Apply rules to inbox",
calling `POST /api/inbox/apply-rules`, which recomputes `suggestion` for all
pending items (bounded by the inbox size; paginated internally).

**Confirm with `rememberRule`:** body gains
`rememberRule?: { pattern: string; direction: 'IN' | 'OUT' | 'ANY'; accountScoped: boolean }`.
The rule is created in the same `TransactWrite` as the confirm (a fourth
item), appended at the last position. If an identical rule (`pattern`,
`direction`, `accountUid`) exists, it is updated to the new type/category
instead of duplicated. If the item had a suggestion, that rule's
`matchCount` increments. DynamoDB rejects a transaction that touches the same
item twice, so when the suggested rule and the remembered rule are the same
item, the rule write and the `matchCount` increment are merged into one
update.

**Category deleted or reassigned:** existing `reassignCategory` (in
`src/api/reassign.ts`) is extended to rewrite `categoryId` on matching rules;
deleting a category with rules requires reassignment, following the existing
transaction behaviour.

## API

| Route | Behaviour |
|---|---|
| `GET /api/rules` | Rules sorted by `position` |
| `POST /api/rules` | Create; body `{ pattern, direction, accountUid?, type, categoryId }` |
| `PUT /api/rules/{ruleId}` | Replace fields (not `position`) |
| `DELETE /api/rules/{ruleId}` | Delete |
| `PUT /api/rules/order` | Body `{ ruleIds: string[] }` — full ordering; rewrites `position` (batched ≤25 per transaction) |
| `POST /api/inbox/apply-rules` | Recompute suggestions for pending items; 200 `{ updated }` |

Validation (IO-01/02/07): `pattern` normalised server-side, 2–60 chars after
normalisation; `direction` allowlist; `type` via `VALID_TRANSACTION_TYPES`;
`categoryId` must exist for the user and its category type must be compatible
with `type`; `ruleIds` must be exactly the user's current rule set (no
additions/omissions) or 400.

## UI

- **Inbox:** controls pre-filled from `suggestion` with a small "Suggested by
  rule" hint linking to the rule. "Remember for similar" checkbox reveals an
  editable pattern (pre-filled by `suggestPattern`) and an "only this account"
  toggle.
- **Rules page (`/rules`, linked from Inbox and Categories):** list with
  pattern, direction, account, → type/category, match count, last matched;
  drag-to-reorder (Mantine-compatible, no new dependency if avoidable —
  up/down buttons as fallback); edit in a modal; delete with confirm modal;
  "Apply rules to inbox" button.

## Optional Extension: Duplicate-of-Manual Badge

Deferred from spec 1. On inbox read, flag an item when a `MANUAL` transaction
exists with the same amount and a date within ±2 days. Implemented as a
read-time query over the relevant `TXN#{yearMonth}` partitions (at most two
months). Include only if the inbox shows real overlap after spec 1 ships.

## Testing

- **Pure:** `normaliseDescription` table (digits, punctuation, whitespace,
  unicode letters preserved); `matchRule` (first-match order, direction scope,
  account scope, no match → null); `suggestPattern` (short descriptions,
  single word, empty after normalisation).
- **runSync:** new items get suggestions; no rules → no suggestion; rules
  loaded once per user (not per transaction).
- **API:** CRUD validation; incompatible category type → 400; reorder with
  missing/extra ids → 400; confirm with `rememberRule` creates rule
  atomically; identical rule updated not duplicated; 500-rule cap;
  apply-rules updates only pending items; category reassignment rewrites
  rules.

## Out of Scope

Regex rules; amount-based rules; auto-confirm; AI suggestions; splitting one
bank transaction across categories; shared/community rule packs.
