# Bank Sync — Build Order

**Date:** 2026-09-13
**Specs:** `docs/superpowers/specs/2026-09-13-bank-sync-{1..4}-*-design.md`

This is the sequence across all four bank sync specs. Only spec 1 has a
task-level plan today (`2026-09-13-bank-sync-1-foundation.md`). Specs 2–4 get
their own task-level plans when their phase starts, written against the code
that actually exists by then — their "Assumptions About Spec 1" sections are
the checklist for what to re-verify.

## Phase 0 — Prerequisites (manual, no code)

| # | Task | Gate |
|---|---|---|
| 0.1 | Merge PR #23 (AGPL licence) | Merged |
| 0.2 | Create Enable Banking account; create a **production** application in restricted mode; download its private key | App id + PEM in hand |
| 0.3 | In the control panel, confirm Lloyds appears for GB and link your Lloyds accounts | Lloyds linked. **If Lloyds is missing, stop and revisit spec 1's provider choice** |
| 0.4 | Also create a **sandbox** application for development/testing against the mock ASPSP | Sandbox app id + PEM |

## Phase 1 — Spec 1: Sync foundation + Enable Banking

Plan: `2026-09-13-bank-sync-1-foundation.md`. Internal order:

1. **Pure sync core** (types, amount, keys, window, errors, normaliser) — no AWS, no network
2. **Store** (interface, fake, DynamoDB implementation)
3. **Enable Banking client + provider** (JWT, HTTP, connect API, transactions)
4. **`runSync`** against fakes
5. **Worker commands + Lambda handler + build script**
6. **Infrastructure** (role split, table TTL/SSE, secret, worker Lambda, schedule, log groups)
7. **API** (transactions `bankRef` preservation, banks/sync handlers, inbox handlers, route registration)
8. **Frontend** (API client + hooks, Auth0 callback fix, banks pages, inbox page, navigation + banner)
9. **Verification** (sandbox end-to-end, security review, real Lloyds)

Milestones:
- **M1 (after step 4):** sync logic proven by tests with zero infrastructure.
- **M2 (after step 6):** deployable worker; `aws lambda invoke` with
  `listBanks` returns GB banks from the sandbox.
- **M3 (after step 9):** real Lloyds transactions arriving in the inbox,
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
