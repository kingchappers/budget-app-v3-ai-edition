# Bank Sync — Build Order

**Date:** 2026-09-13
**Specs:** `docs/superpowers/specs/2026-09-13-bank-sync-{1..4}-*-design.md`

This is the sequence across all four bank sync specs. Only spec 1 has a
task-level plan today (`2026-09-13-bank-sync-1-foundation.md`). Specs 2–4 get
their own task-level plans when their phase starts, written against the code
that actually exists by then — their "Assumptions About Spec 1" sections are
the checklist for what to re-verify.

## Phase 0 — Prerequisites (manual, no code)

**Provider changed 2026-09-15: Enable Banking → TrueLayer.** Enable Banking
does not support UK banks at all (lost EU passporting rights post-Brexit) —
this was caught after Tasks 1-5 and 8 were already built against
provider-agnostic interfaces (unaffected) and Tasks 6-7 were built against
Enable Banking specifically (now superseded, see Phase 1 below). See the
spec's "Provider Change Log" section for the full reasoning.

| # | Task | Gate |
|---|---|---|
| 0.1 | Merge PR #23 (AGPL licence) | Merged |
| 0.2 | Create a TrueLayer console account; create a **sandbox** application | Sandbox `client_id`/`client_secret` in hand |
| 0.3 | Walk the sandbox connection flow once by hand (create a connection, complete consent against the mock bank, confirm the connection's status) to observe: the real terminal `status` value, the redirect params TrueLayer actually appends to `return_uri`, and the transactions-request/poll response shapes. Record findings against the spec's "Unconfirmed items carried into implementation" list before writing Tasks 6-7 equivalents | Findings recorded; no more guessing needed for those items |
| 0.4 | Create a **production** application for the eventual real-bank connection | Production `client_id`/`client_secret` in hand |

## Phase 1 — Spec 1: Sync foundation + TrueLayer

Plans: `2026-09-13-bank-sync-1-foundation.md` (Tasks 1-23, original —
Tasks 1-5 and 8 complete, merged, and unaffected by the provider change;
Tasks 6-7 merged but superseded; Tasks 9-23 never implemented and largely
superseded) plus `2026-09-15-bank-sync-1-truelayer-provider.md` (Tasks
24-35, the TrueLayer rewrite — read its "What needs rework vs. what
doesn't" table for the definitive task-by-task mapping between the two
plans before dispatching anything). Execute the original plan's Tasks 11,
13, 15, 21, 22 as written when their turn comes (no provider-specific
content); execute the new plan's Tasks 24-35 in place of the original's
Tasks 6-7, 9-10, 12, 14, 16-20; finish with the original plan's Task 23
(spec update / e2e verification / security review), using the new plan's
sandbox as the target.

Internal order (updated):

1. ~~Pure sync core~~ — done (Tasks 1-4)
2. ~~Store~~ — done (Task 5)
3. **TrueLayer client + provider** (client-credentials token, HTTP, connection creation + status polling, transactions request/poll) — needs a fresh task-level plan, replacing the old Enable-Banking-flavoured Tasks 6-7
4. ~~`runSync` against fakes~~ — done (Task 8)
5. **Worker commands + Lambda handler + build script** — needs rewriting: `createConnection`/`completeConnection` replace `startAuth`/`completeAuth`; no `listBanks` command
6. **Infrastructure** (role split, table TTL/SSE, secret, worker Lambda, schedule, log groups) — mostly unchanged, secret name/fields differ (`${app_name}/truelayer`, `{clientId, clientSecret}`)
7. **API** (transactions `bankRef` preservation, banks/sync handlers, inbox handlers, route registration) — `/banks/aspsps` route removed, `/banks/connect` and `/banks/callback` body shapes change
8. **Frontend** (API client + hooks, Auth0 callback fix, banks pages, inbox page, navigation + banner) — "Connect a bank" modal loses its bank-search picker (TrueLayer's hosted page shows its own)
9. **Verification** (sandbox end-to-end, security review, real bank)

Milestones:
- **M1 (after step 4, i.e. Task 8):** sync logic proven by tests with zero
  infrastructure. **Already reached** — see `.superpowers/sdd/` ledger on
  `feat/bank-sync-1-foundation`.
- **M2 (after step 6):** deployable worker; `aws lambda invoke` with
  `createConnection` returns a usable `hosted_page.uri` against the sandbox.
- **M3 (after step 9):** real UK bank transactions arriving in the inbox,
  confirmed into budgets, no duplicates across re-syncs. **Use it for ~2 weeks
  before Phase 2** — real data will show whether rules need anything the
  spec 2 draft missed.

Ship as several PRs (one per step group above) rather than one large PR, so
each is reviewable and CI-deployed incrementally. Steps 1–5 deploy nothing
user-visible; step 6 deploys an idle worker; steps 7–8 expose the feature.

## Phase 2 — Spec 2: Auto-categorisation rules

Start by re-reading spec 2's assumptions against the merged spec 1 code, fix
the spec, then write its task-level plan. Expected order: pure matching
(`normalise`, `match`, `suggestPattern`) → rules CRUD API → suggestions in
`runSync` → confirm with `rememberRule` → apply-rules → category reassignment
→ rules page + inbox changes.

Decide at the start of this phase whether the duplicate-of-manual badge is
needed, based on Phase 1 usage.

## Phase 3 — Spec 3: Trading 212

Before planning: confirm the Trading 212 interest transaction enum and the
account-info endpoint used to verify keys (the API is beta). Expected order:
`roundDecimalToPence` → provider with pacing → `connectApiKey`/disconnect
commands + scoped Secrets Manager IAM → API route → connect modal.

Phases 2 and 3 are independent of each other; either can go first. Rules
first is recommended because they reduce inbox effort for every provider.

## Phase 4 — Spec 4: Self-hosted Docker

Lowest priority; start only once specs 1–3 have been stable in daily use.
Spec 4 already defines its internal order; steps 1–3 (store extraction,
generic OIDC API verification, frontend OIDC client) improve the AWS
deployment on their own and can ship before any Docker work.

## Cross-cutting rules for every phase

- TDD; each PR passes `yarn test` and `yarn typecheck`.
- SECURITY.md checklist and a security review before each PR that touches
  API, worker, IAM or secrets.
- Infra changes go through CI (`tofu plan` on PR, apply on merge) — never
  applied manually (INFRA-10).
- When implementation deviates from a spec, update the spec in the same PR.
