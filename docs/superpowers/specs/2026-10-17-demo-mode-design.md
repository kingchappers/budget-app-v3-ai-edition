# Demo Mode Design

Date: 2026-10-17. Sub-project of the self-hosting work, after Storage Interface, Portable Auth, Container Image and Hosted Readiness (all merged; `v0.2.0` is published). Goal: anyone, including a hosting partner evaluating the app, can try the real product with realistic invented data from a link, with nothing to install or sign up for, and with no visitor data ever reaching a server.

## Context

- The app is a React SPA that talks to `/api/*`. `app/lib/runtimeConfig.ts` reads `/config.json` (`{ auth: 'local' }` or `{ auth: 'auth0', ... }`) and `AuthProvider` renders the matching provider. In local mode `LocalAuthProvider` asks `/api/auth/me` and `/api/auth/status` and shows the sign-in form only when signed out.
- Nothing under `src/api/` imports a Node module, and the `Store` interface (`src/store/types.ts`) has six methods (`get`, `put`, `patch`, `delete`, `query`, `transact`). The same contract suite (`src/store/__tests__/contract.ts`, run by `runStoreContract`) covers `SqliteStore` and `DynamoStore`.
- `scripts/screenshots/fixtures.mjs` already defines an invented household (store-item shaped, dates derived from "now") and `scripts/screenshots/capture.mjs` runs the app against stubbed responses. Nothing there is real.
- The monetisation plan forbids designs that make the author a data processor: a public demo must not retain visitors' data.

## Decisions (agreed 2026-10-17)

1. The demo's backend lives **in the visitor's browser**: an in-memory `Store` plus the real router and handlers behind an intercepted `fetch`. Edits live in the tab and vanish on reload.
2. It is a **separate static build** (`yarn build:demo` -> `build/demo/`), not a route in the normal app. Demo code is compiled out of the Lambda and container builds.
3. This sub-project ends at a working build, CI checks and docs. **Deploying** the demo to a public address is a separate step for the owner.

## Scope

1. `MemoryStore`, a Map-backed `Store`.
2. A fetch adapter that serves `/api/*`, `/config.json` and the auth endpoints in the browser.
3. Seeding from one shared household definition, through the real handlers.
4. The demo shell: banner, Reset button, hidden features, no service worker.
5. The `build:demo` script, CI checks, docs.

## Non-goals

Persistence across reloads (an easy later addition), a server-side demo, multi-user, push reminders, analytics or any network call beyond the demo's own static files, deploying infrastructure, and any change to production behaviour.

## Design

### 1. `MemoryStore`

`app/demo/memoryStore.ts` implements `Store` over a `Map` keyed by `PK` then `SK`. It must pass `runStoreContract` unchanged (the same suite as `SqliteStore` and `DynamoStore`), which is the proof that handlers behave the same on it: ordering of `query` results, `skPrefix`/`skEquals`/`attributes` options, `put` with `ifAbsent`, `patch` with `mustExist` and `defaults`, `delete` with `ifPresent`, and `transact` that applies all operations or none (`ConditionFailedError` with the failing index). Items are copied on the way in and out so callers cannot mutate stored state.

### 2. Fetch adapter

`app/demo/installApi.ts` exports `installDemoApi(options)` which replaces `window.fetch`:

- `/config.json` -> `{"auth":"local"}`. The existing local-login provider then needs no change.
- `/api/auth/me` -> 200 with a fixed visitor (`{ userId: 'demo|visitor', email: 'demo@example.com' }`); `/api/auth/status` -> `{ setupRequired: false, recoveryOpen: false }`; `/api/auth/login|setup|logout` -> 200 no-ops (the sign-in UI is never shown, and sign-out is hidden).
- Every other `/api/*` request is turned into the API Gateway-shaped event the Lambda receives (method, path, query, headers, body, `requestContext` including a templated `routeKey`), passed to the **real router and handlers** with the `MemoryStore` registered through the existing store registry and a stub auth provider whose `authenticate` returns the visitor, and the handler's result becomes a `Response` (status, headers, JSON body, cookies ignored).
- A handler that throws becomes a JSON 500 `{ "error": "Internal server error" }`, as in the Lambda.
- Any request that is not `/config.json` or `/api/*` falls through to the original `fetch` (the demo's own static files).

The adapter imports `createRouter` and the handler modules directly and does **not** import `api-handler.ts`, so the Lambda entry file's wiring (auth0 and sqlite/dynamo store factories) is not pulled into the browser bundle. If importing `src/store/index.ts` still drags server-only code in, the demo build aliases or splits it; the build check in section 5 is the gate, and the plan's first task verifies it before anything else is built.

### 3. Seeding

`app/demo/seed.ts` builds the invented household from a single typed definition shared with the screenshots harness (the harness imports it, so there is one source of truth), with dates worked out from "now". It is **applied through the real handlers** (create categories, accounts, pots, targets, recurring bills, transactions) at start-up, not written to the store directly, so any change to the data model keeps the demo valid by construction. The plan's first seeding task checks how much of `fixtures.mjs` can be reused as is; if the shapes differ it adapts the definition rather than duplicating it.

### 4. Demo shell

- A permanent banner above the app: "Demo: your changes stay in this browser tab and vanish when you reload. Don't enter real financial details." and a **Reset demo** button. Reset recreates the `MemoryStore`, re-seeds and reloads the page, so it can never show half-reset state.
- Hidden in the demo: push-reminder toggles, the account and sign-out menu, and PWA install and service-worker registration (a cached worker would fight the intercepted `fetch`).
- The demo page has a strict policy: `default-src 'self'` with no third-party hosts, no analytics, and `noindex`.
- Mounting: when `import.meta.env.VITE_DEMO` is `'true'` the app entry installs the adapter and seeds **before** the first render (top-level await or an awaited bootstrap), so no request ever reaches the network. In any other build the constant is false and the demo modules are never imported (dead-code eliminated).

### 5. Build, CI and docs

- `yarn build:demo` runs the SPA build with `VITE_DEMO=true` into `build/demo/` (the build directory is selectable through an environment variable read by `react-router.config.ts`; the default stays `build`), and does not touch `build/client`, `build/api` or `build/container`.
- CI (the existing Node workflow, not the container workflow) gains two checks: (a) the **production** build (`yarn build`) contains no demo marker string (a unique constant exported from `app/demo/`); (b) the **demo** build bundles no `node:` import and no AWS SDK or SQLite code, and its entry HTML references only its own files.
- `docs/SELF-HOSTING.md` or a short new section in `README.md` explains what the demo is, how to build it, that it can be served from any static host, and that the owner decides where. `docs/ROADMAP.md` records the sub-project. `CLAUDE.md` Commands lists `yarn build:demo`.

## Security and privacy

- No visitor data leaves the page: the adapter answers every API call locally and passes only static-file requests through. The CSP forbids other origins.
- The demo includes no real credentials, tokens or tenant values, and no code path for real authentication; the visitor identity is a constant.
- Demo code must not be reachable in production: guarded by the build flag and the production-build marker check.
- SECURITY.md gets a short note (no new control id unless the plan finds a need): the demo build is data-free by construction.

## Testing

- `MemoryStore`: the shared contract suite, plus tests for copy-on-read and `transact` atomicity.
- Adapter: unit tests for event shape (method, path, templated `routeKey`, query, JSON body, headers), unknown route -> 404, handler throw -> JSON 500, pass-through of non-API requests, and the auth endpoints.
- Seed: after seeding, listing categories, pots, transactions for the current month and recurring bills returns the invented household; running the seed twice on a fresh store gives the same result.
- Component test: the demo boots, shows the banner and the seeded Home figures; an edit changes the data; Reset restores the seeded state; no request outside the app's own files is made.
- CI build checks as in section 5.
- Not verified until deployed: behaviour on real mobile browsers and on the chosen static host.

## Review focus

1. A demo build must never be usable as a production build, and a production build must never contain demo code or the fake auth endpoints.
2. The fake sign-in must not leak into real modes: the intercepted `/api/auth/*` answers exist only when the demo flag is on.
3. `MemoryStore` must be indistinguishable from the other stores through the contract suite, including `transact` atomicity.
4. The demo must make no request that leaves the page (analytics, fonts, images from other hosts), including from third-party UI libraries.
5. Reset must restore a fully consistent seeded state and never leave handlers pointing at a stale store.
