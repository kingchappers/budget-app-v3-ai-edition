# Bank Sync 4 — Self-Hosted Docker Distribution Design

**Date:** 2026-09-13
**Status:** Draft — direction approved, details pending review; lowest
priority of the series
**Series:** Bank sync specs 1–4. Depends on specs 1–3 being stable.
**Covers:** A storage abstraction for all entities, a SQLite implementation,
generic OIDC login, a single-container Node server with an in-process
scheduler, and a published Docker image
**Defers:** Postgres, hosting-partner listings (business task), migration
tooling between AWS and Docker deployments

## Goal

The AWS deployment (Lambda, DynamoDB, Auth0, OpenTofu) is too heavy for most
self-hosters. A single Docker container with a SQLite file makes the app easy
to run on a home server or VPS, and is the prerequisite for listing on
hosting partners (e.g. PikaPods) as part of the monetisation plan. The AWS
deployment remains supported.

## Product Decisions

- **Both deployment targets are first-class.** Business logic is shared; only
  entry points, storage and scheduling differ.
- **SQLite for Docker.** One file on a mounted volume; backups are "copy the
  file". Postgres deferred until someone needs it.
- **Generic OIDC for login, no built-in username/password.** SECURITY.md
  AUTH-02 forbids custom auth. Any OIDC provider works: Auth0 (existing),
  Authentik, Keycloak, Pocket ID, Zitadel, etc.
- **Single household per container**, same as the AWS model.
- **No telemetry, no phone-home.** Update awareness is documentation plus
  GitHub releases, per the monetisation plan's "never touch user data" rule.

### Decisions made during spec writing (review these)

- **Frontend auth moves from `@auth0/auth0-react` to a generic OIDC client**
  for both targets (Auth0 is OIDC-compliant). Candidate: `oidc-client-ts` +
  `react-oidc-context` (DEP-02 review at planning). This is also the moment
  to revisit the AUTH-03 localStorage deviation recorded in spec 1.
- **SQLite driver:** Node's built-in `node:sqlite` if stable in the Node
  version the image targets; otherwise `better-sqlite3`. Decided at planning.
- **HTTP server:** `node:http` with the existing router (which already
  dispatches on method + path) behind a thin adapter that converts
  `IncomingMessage` to the handler event shape. No framework unless the
  adapter proves awkward.
- **Scheduler:** `setInterval`-based, calling the same `runSync` every 6 h
  with an in-process lock, no cron dependency.
- **Secrets via environment variables or `*_FILE` variants** (Docker secrets
  convention, e.g. `ENABLE_BANKING_PRIVATE_KEY_FILE=/run/secrets/eb_key`).
  Trading 212 keys stored encrypted in SQLite with AES-256-GCM using a
  deployer-supplied `APP_ENCRYPTION_KEY` (Secrets Manager has no local
  equivalent).
- **Images for `linux/amd64` and `linux/arm64`** (home servers and Raspberry
  Pi), published to GitHub Container Registry.

## Assumptions About Specs 1–3

1. All bank-sync code depends on `SyncStore` and `BankProvider` interfaces,
   never on DynamoDB or Lambda directly.
2. `runSync(deps)` takes `now`, `deadline`, `store`, `providers`, `userIds`
   and has no Lambda imports.
3. Worker commands (`src/sync/commands.ts`) are callable as plain functions;
   the Lambda-invoke boundary exists only in `sync-handler.ts` and
   `src/api/banks.ts`.
4. Rules (spec 2) and Trading 212 secrets (spec 3) are reached through
   interfaces that can take a non-AWS implementation.
5. Existing handlers (`transactions`, `categories`, `targets`, `reassign`)
   still use `docClient` directly — this spec migrates them.

## Architecture

```
┌──────────────────── container ────────────────────┐
│ server.ts (node:http)                             │
│   /            → static SPA assets                │
│   /api/*       → OIDC JWT check → router          │
│ scheduler.ts   → runSync every 6h                 │
│ commands called in-process (no Lambda invoke)     │
│ SqliteStores   → /data/budget.db (volume)         │
└───────────────────────────────────────────────────┘
          │ HTTPS                       │ HTTPS
   OIDC provider                 Enable Banking / Trading 212
```

In Docker there is no separate worker process, so the least-privilege
separation of spec 1 (only the worker can read bank secrets) collapses into
one process. This is accepted for Docker and documented; the AWS target keeps
the split.

## Components

| Module | Responsibility |
|---|---|
| `src/store/interfaces.ts` | `TransactionStore`, `CategoryStore`, `TargetStore`, `RuleStore`, plus existing `SyncStore` |
| `src/store/dynamo/*` | DynamoDB implementations (existing logic moved out of handlers) |
| `src/store/sqlite/*` | SQLite implementations + schema migrations (versioned SQL files) |
| `src/api/*` (change) | Handlers receive stores via deps instead of importing `docClient` |
| `src/auth/verifyJwt.ts` | Generic OIDC JWT verification (issuer discovery, JWKS, `aud`, `iss`, `exp`, `sub`) shared by `api-handler.ts` and `server.ts` |
| `src/secrets/*` | `SecretStore` interface; Secrets Manager and encrypted-SQLite implementations |
| `server.ts` | HTTP adapter, static files, security headers, graceful shutdown |
| `scheduler.ts` | Interval + lock + `runSync` |
| `Dockerfile` | Multi-stage build, non-root user, read-only root FS, `/data` volume |

## Data

SQLite schema mirrors entities, not DynamoDB keys: tables `categories`,
`transactions` (indexed by `user_id, year_month`), `targets`, `rules`,
`connections`, `inbox_items` (indexed by `user_id, booking_date`), `seen`
(primary key `user_id, txn_key`), `sync_status`, `bank_auth` (with
`expires_at`, purged on read and by scheduler). Conditional writes become
`INSERT … ON CONFLICT DO NOTHING` + affected-row checks and transactions.
WAL mode on; `PRAGMA foreign_keys = ON`.

## Security

- Container runs as non-root, read-only root filesystem, only `/data`
  writable; no shell in final image where practical.
- `APP_ENCRYPTION_KEY` (≥32 random bytes, base64) is required to connect
  Trading 212; the connect command fails without it, and the server refuses
  to start if Trading 212 connections exist but the key is missing or short
  (fail closed).
- Same security headers as `SECURITY_HEADERS`; HTTPS expected to be
  terminated by a reverse proxy (documented), with `TRUST_PROXY` controlling
  whether `X-Forwarded-For` is used for PSU IP.
- Setup guide covers backups (SQLite `.backup` or file copy while stopped),
  updating (pull new tag), and security advisories (GitHub Security
  Advisories on the repo).

## Testing

- **Store contract suite:** one shared test suite per store interface run
  against the SQLite implementation (in-memory database) and the DynamoDB
  implementation (DynamoDB Local in CI via service container). This replaces
  spec 1's `FakeSyncStore` as the source of truth for conditional semantics.
- **Handler tests** move from mocking `docClient` to injecting in-memory or
  SQLite stores.
- **Server adapter:** request → event mapping, static file fallback, JWT
  rejection, security headers.
- **Image smoke test in CI:** build, start with a test OIDC issuer, hit
  `/api/categories` with a signed token, stop.
- **Manual:** run on arm64 and amd64; connect Enable Banking sandbox through a
  reverse proxy; restart container and confirm data and scheduler resume.

## Migration Order (for planning)

1. Extract store interfaces and DynamoDB implementations; handlers take
   deps. AWS behaviour unchanged, all existing tests pass.
2. Generic OIDC verification on the API side (Auth0 still configured).
3. Frontend OIDC client swap.
4. SQLite stores + contract suite.
5. `server.ts`, `scheduler.ts`, encrypted secret store.
6. Dockerfile, CI image build + smoke test, setup guide.

Steps 1–3 are valuable to the AWS deployment on their own and can ship
independently.

## Out of Scope

Postgres; multi-household containers; data migration between AWS and Docker
deployments; Helm charts; hosting-partner onboarding (business task); a
built-in OIDC provider.
