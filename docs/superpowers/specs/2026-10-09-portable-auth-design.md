# Portable Auth: design

Second of three sub-projects that let the app run as a self-hosted container alongside the existing AWS deployment: **Storage Interface** (merged, PR #85), **Portable Auth** (this spec) and **Container Image**. It changes nothing a user of the AWS deployment can see; Auth0 keeps working exactly as today.

## Intent

Put a provider seam under authentication and add a second provider: a built-in, single-account login for self-hosted instances. Success means:

- A fresh instance in `local` mode serves a first-run setup page, then login, and every API call except a short list of auth routes is authenticated server-side.
- The Lambda deployment (`auth0` mode) behaves identically; its existing authentication tests pass unchanged after the move.
- One frontend build serves both modes, choosing at runtime.

This serves the self-hosting and hosting-partner plan: each user holds their own data and credentials, and the author only publishes software.

## Decisions

| Question | Decision |
|----------|----------|
| Credential after login | A server-side session ID in an `HttpOnly; SameSite=Strict; Path=/` cookie (`Secure` unless `COOKIE_SECURE=false`). JavaScript never sees it. |
| Cookie contents | 32 random bytes. The `Store` keeps only the SHA-256 hash, so a leaked database does not leak usable sessions, and logout or reset can revoke them. |
| Frontend mode selection | A runtime `/config.json`, fetched before anything mounts. One bundle for both deployments. |
| Account creation | A setup code generated at first start when no account exists, kept in memory and logged once. Setup closes permanently once an account exists. |
| Accounts | Exactly one per instance. No sign-up, no multi-user. |
| Password hashing | `scrypt` from `node:crypto` (no new dependency). Parameters are stored per hash. |
| Provider selection | `AUTH_MODE` env var: `auth0` (default) or `local`, loaded by dynamic `import()` so each runtime loads only its own provider, as `initStore()` does. |

**Not doing (on purpose):** sign-up beyond the first account, multi-user, email-based reset or verification, 2FA, social login, generic OIDC (a later project), the HTTP server, the Dockerfile, generating `/config.json` inside the container (all Container Image), and migrating AWS data into a local account (the export/import CLI already does it with `--as-user`; this project only documents the steps).

## 1. Server side

### The provider seam

`src/auth/` holds:

- `types.ts`: `AuthProvider { authenticate(event): Promise<{ userId: string } | { rejection: ApiResponse }> }`.
- `auth0.ts`: today's `authenticate()` from `api-handler.ts` (JWKS, `aud`, `iss`, `RS256`, `sub`), moved unchanged.
- `local.ts`: session lookup, plus the auth routes below.
- `index.ts`: `initAuth(env)`, `getAuth()`, `setAuth()` (for tests), mirroring `src/store`.

`api-handler.ts` calls `getAuth().authenticate(event)` where it calls `authenticate` today. Handlers and the router still receive only `userId`.

### What local mode stores

All under an `AUTH#` partition, not `USER#`. The export/import CLI works by `query` on one user's partition, so credentials are excluded by construction and cannot leave the instance through an export.

| Item | PK / SK | Fields |
|------|---------|--------|
| Account | `AUTH#ACCOUNT` / `PROFILE` | `userId` (`local\|<uuid>`), `email`, `passwordHash`, `salt`, scrypt `N`/`r`/`p`, `createdAt` |
| Session | `AUTH#SESSIONS` / `<sha256(cookie)>` | `userId`, `createdAt`, `expiresAt` (numeric epoch seconds, so the SQLite TTL purge removes it). One shared partition, because `Store.query` lists a single partition and a password reset must find every session. |
| Throttle | `AUTH#THROTTLE` / `LOGIN` | `failures`, `nextAllowedAt` |

### Routes (local mode only)

These are the only public routes (the AUTH-05 exceptions); everything else stays deny-by-default.

| Route | Behaviour |
|-------|-----------|
| `GET /api/auth/status` | `{ setupRequired: boolean }` |
| `POST /api/auth/setup` | `{ code, email, password }`. Wrong code: 403. Account exists: 409. Creates the account with `put ifAbsent`, so two concurrent setups yield exactly one account. Starts a session. |
| `POST /api/auth/login` | `{ email, password }`. Same 401 for a wrong password and an unknown account. Starts a session. |
| `POST /api/auth/logout` | Deletes the session, clears the cookie. |
| `GET /api/auth/me` | `{ userId, email }` for a valid session, otherwise 401. |

### Setup code

When the auth provider is first built (lazily, on the first request that reaches the API, normally the SPA's `GET /api/auth/me`), if no account exists, generate a random code, hold it in memory only, and log it once. A restart before setup generates a new code (the setup page says so). The code is compared in constant time. After setup it is discarded.

### Passwords, sessions and throttling

- Minimum 12 characters, maximum 128 (bounds hashing cost), no composition rules. Enforced server-side (IO-01) and mirrored in the form.
- `scrypt` with N=2^15, r=8, p=1 (about 32 MB), stored per hash so parameters can be raised later and old hashes still verify.
- Login failures back off exponentially via the throttle item. An unknown account is compared against a dummy hash so timing does not leak existence.
- Sessions last 30 days, sliding: `expiresAt` is extended when less than half the lifetime remains, to avoid a write on every request.
- State-changing requests (anything but `GET`/`HEAD`) must carry an `Origin` that matches the request host, as CSRF defence in depth beside `SameSite=Strict`.
- `store-cli reset-password` prompts for the password (never via argv or the environment), replaces the hash and deletes every session.
- Passwords, cookies, session IDs and the setup code are never logged (AUTH-06), with one exception: the setup code, logged once when the server first handles a request.

## 2. Frontend

- An app-owned `useAuth()` returns `{ isAuthenticated, isLoading, user, login, logout }` and replaces the direct `@auth0/auth0-react` imports in the 16 files that use them.
- `Auth0AuthProvider` wraps the existing Auth0 hooks, so behaviour there is unchanged. `LocalAuthProvider` calls `/api/auth/me` on load and renders the setup or login form.
- `useProtectedApi` no longer asks for a token in local mode: it sends `credentials: 'same-origin'` and no `Authorization` header. In Auth0 mode it behaves as today.
- `user.sub` stays a stable string in both modes (`local|<uuid>` locally), because the offline queue tags entries with it and flushes only the current user's.
- `main` fetches `/config.json` before mounting: `{ "auth": "local" }` or `{ "auth": "auth0", "domain", "clientId", "audience" }`. The static handler's build script writes it from the existing `VITE_AUTH0_*` values, beside `csp.json`. If the fetch fails the app shows a clear error and does not guess a mode.

## 3. Testing

All on the real in-memory `SqliteStore` via `useTestStore`.

- **Provider contract:** one suite for both providers. Missing, malformed and expired credentials get the same 401; a valid one yields `userId`.
- **Auth0 provider:** the existing `authenticate` tests move over unchanged, proving the move preserves behaviour.
- **Local provider:**
  - Setup is refused with a wrong code, refused once an account exists, and two concurrent setups produce exactly one account.
  - Throttling backs off, and a wrong password and an unknown account are indistinguishable.
  - Logout, expiry and password reset each invalidate sessions.
  - The stored session key is a hash, never the raw cookie.
  - A non-GET request with a foreign `Origin` is refused.
  - Password length limits hold at both ends.
  - Passwords, cookies and the setup code never reach `console`, except the one log of the setup code, made when the provider is first built.
- **Frontend:** `useAuth()` for both providers across setup, login and error states. Existing component tests keep passing through a thin shim that keeps their Auth0 mocks working.
- **Browser check:** a Playwright run of setup, login, reload, logout against a local-mode server, in this project's plan and not left as a follow-up (the offline-queue work never got this check).

## 4. `SECURITY.md` amendments (same PR)

- **AUTH-02:** "Delegate to an identity provider, except the built-in single-account login (self-hosted only), which must satisfy the controls below." The exception and its conditions are written down so a reviewer can check them.
- **AUTH-01:** "Validate the credential on every API request": a JWT (signature, `aud`, `iss`, `exp`, `sub`) in Auth0 mode, a server-side session lookup in local mode.
- **AUTH-03:** session cookies must be `HttpOnly`.
- **New controls:** scrypt password hashing, login throttling, and a setup route that closes after first use.

## Risks and unverified points

- `Secure` cookies over plain HTTP cannot be tested end to end here; `COOKIE_SECURE=false` exists for LAN installs and is unverified.
- `scrypt` at about 32 MB may be tight on very small hosts (256 MB containers). Parameters are stored per hash so they can be tuned without invalidating accounts.
- The SQLite TTL purge runs hourly, so an expired session row can still be read. `readSession` therefore checks `expiresAt` itself and never relies on the purge.
- The sliding-session write is skipped until half the lifetime has passed, so `expiresAt` is approximate to within that margin.
- Container Image must call `await initAuth()` at boot so the code is logged at start-up and a bad AUTH_MODE fails fast instead of returning a 500 on every request.
- The first-run setup window is protected by the log-printed code only; anyone with log access can set up the instance, which is the intended trust boundary.
