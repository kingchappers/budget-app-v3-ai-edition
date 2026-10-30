# Personal API Tokens Design

Date: 2026-10-30. Covers HOA-5 (scoped, revocable personal API tokens) and HOA-6 (accept them on `/api/*`). The OpenAPI spec (HOA-7), SKILL.md (HOA-8), the MCP endpoint (HOA-11 onward) and OAuth for consumer connectors (HOA-15) build on this and are not part of it.

## Intent

A Hoardwise user can give their own AI tools and scripts access to their own data. The tools are desktop AI clients (Claude desktop, ChatGPT or similar) and coding agents (Claude Code and its equivalents). They read what the user has entered and do the analysis themselves: graphs, metrics, trends, recommendations. Hoardwise does not build the analysis. The same door lets users build their own things on the functions the app already has.

Today this is impossible. The API accepts only an Auth0 login token (AWS) or a session cookie (self-hosted), and neither is something a script or desktop client can hold safely.

## Goals

- A signed-in user creates a personal token in Settings and pastes it into a client.
- A token is **read-only by default**. A **read and write** token is a deliberate, clearly marked choice.
- The user picks an expiry at creation: 90, 180, 365 or 730 days, or never.
- Tokens can be listed and revoked, and show when they were last used.
- Works on both deployments: self-hosted (container, `AUTH_MODE=local`) and AWS (Auth0). Each token reaches only its owner's data.
- Every existing `/api/*` route that a user can call works with a token, without a second copy of any business logic.

## Non-goals

- Finer permissions than read versus read and write (for example "spending but not balances"). Decided: not for now.
- OAuth, consent screens and one-click connector sign-in (HOA-15).
- Calls from third-party web pages. No CORS is enabled and none is added; clients are programs, not other websites.
- Token refresh or rotation flows, per-token rate limits, IP allow-lists, webhooks.
- Tokens in the demo. The demo has no token page and no server.

## Anti-goals

The feature has failed, even if it technically works, if any of these is possible:

- A read token changes data.
- A token creates, lists or revokes tokens (a leaked read token must not be able to mint a write token).
- A token, or enough of one to use it, appears in a log, an export of the user's data, any response after creation, an error message or a URL.
- The server believes a scope or expiry the client claims, instead of what it stored.
- A revoked, expired or unknown token is distinguishable from another by the response.

## Design

### Token format

`hwr_<43 characters>` for read-only and `hww_<43 characters>` for read and write. The 43 characters are the base64url form of 32 bytes from `crypto.randomBytes` (256 bits). The prefix is for people and secret scanners: it lets a user see at a glance how risky a pasted token is. **The server never trusts the prefix**; scope comes from the stored record only.

### Storage

Only a SHA-256 hash of the token is stored (the same `hashToken` the sessions use). The full token is shown once, at creation, and cannot be recovered. A fast unsalted hash is appropriate here because the secret is 256 random bits, not a human-chosen password; a slow KDF would add cost to every request and no protection.

Two items, written in one transaction, both outside every `USER#` partition so that `store-cli export` and backups of user data never include credentials (the same rule the `AUTH#` partitions already follow):

- Lookup: partition `AUTH#TOKENS`, sort key = the hash. Holds `tokenId`, `userId`, `scope` (`read` or `write`), `expiresAt` (epoch seconds, or absent for never).
- Listing: partition `AUTH#TOKENLIST#<userId>`, sort key = `tokenId`. Holds the name, scope, `createdAt`, `expiresAt`, `lastUsedAt`, and the token's first 8 characters for recognition. No hash.

Revoking deletes both in one transaction. The builder may adjust the exact keys but must keep both properties: one lookup by hash, and nothing credential-shaped under `USER#`.

### Accepting a token (HOA-6)

One new step in `api-handler.ts`, ahead of `auth.authenticate`. Both the Lambda and the container run this same handler, so it covers both deployments.

1. If the `Authorization` header is `Bearer hwr_…` or `Bearer hww_…`, look the hash up. Missing, expired or unknown: respond 401 with the same body for all three.
2. A valid token yields a principal of `{ userId, via: 'token', scope }`. A request that carries both a token and a session cookie uses the token only; the cookie is ignored.
3. Anything else falls through to the existing Auth0 or session check, unchanged.
4. The token step runs first of all, even ahead of the self-hosted login's public `/api/auth/*` handling: a valid token on an `/api/auth/*` route is answered 403, not passed on. It also happens **before** the self-hosted login's `Origin` check. That check exists for cookies, which a browser sends by itself; a header token is not sent by itself, so there is no cross-site forgery to defend against, and a script has no `Origin`.

`AuthResult` gains `via` and `scope`; the router passes the principal on. Existing handlers keep receiving `userId` and need no change.

The store must be initialised before the token lookup (today `initStore()` runs after authentication).

### Enforcing read-only

In one place, in front of the router, not per route. A `read` token may make `GET` and `HEAD` requests only; anything else is refused with 403 and `{"error":"This token is read-only"}`. Deny by default: a method not on the list is refused.

This is only as strong as "every `GET` route is free of side effects". The builder must audit the route table and add a test that fails if a `GET` route is added that writes.

### Token management API

New routes, registered in `api-handler.ts` beside the push routes (not in `registerCoreRoutes`, so the demo never has them): create (`POST /api/tokens`), list (`GET /api/tokens`), revoke (`DELETE /api/tokens/{tokenId}`). They answer **only to a real sign-in** (`via` is `session` or Auth0 login), never to a token, and are refused for a token with 403. The same applies to the existing `/api/auth/*` and push-subscription routes.

Creation validates, server-side, with allow-lists: name 1 to 60 characters; scope one of `read`, `write`; expiry one of `90`, `180`, `365`, `730`, `never` (days). The server computes `expiresAt` itself. At most 25 tokens per user. The full token appears in the create response once and is never returned again. The response is sent with `Cache-Control: no-store`.

### Settings page

An "Access tokens" section in Settings, hidden in the demo:

- A list: name, "Read only" or "Read and write" (words and an icon, never colour alone), created, expires, last used, and a Revoke button with a confirmation.
- A create form: name; access (Read only preselected); expiry (90 days preselected).
- Choosing "Read and write" or "Never" shows a plain-language warning. In local mode, creating a write token asks for the account password again.
- After creation the token is shown once with a Copy button and a note that it cannot be shown again.

It follows `docs/brand.md`: theme tokens, WCAG AA, calm and low-stimulation.

### Revocation and lifecycle

- Revoke one token, from the list. Takes effect on the next request.
- In local mode, a password reset (marker file, `store-cli reset-password`) revokes every token, as it already ends every session.
- Expired tokens are refused at lookup. Leftover expired items may be cleaned up lazily.
- `lastUsedAt` is updated at most once an hour per token, so reads do not each cause a write. It is bookkeeping, not user data.

### Logging

Log token creation, revocation and each failed token use (reason internal only: `unknown`, `expired`, `revoked`), with `tokenId` and never the token, its hash or its prefix, and not the request body (AUTH-06, LOG-04). Log a 403 for a write attempt on a read token with the route template, not the raw path.

### Abuse limits

The AWS stage already throttles (100 requests a second, burst 50). The container has no limiter, so it gets a small in-memory limit on **failed** token lookups per client address (over 30 a minute answers 429 for a minute), using the existing `TRUST_PROXY` setting to find the address. Guessing a 256-bit token is not a realistic attack, so this limits cost and noise, not break-in.

## Security review against external guidance

| Source | Guidance | How the design meets it |
|---|---|---|
| OWASP REST Security Cheat Sheet | Credentials must not appear in the URL; HTTPS only | Header only; query-string tokens are not read. TLS is already required (HTTP section of `SECURITY.md`). |
| OWASP REST Security Cheat Sheet | Access control at each endpoint; allow-list of HTTP methods per caller; generic errors; audit logs, log token validation failures | One enforcement point in front of the router, deny by default; read tokens limited to `GET`/`HEAD`; identical 401s; the logging section above. |
| OWASP REST Security Cheat Sheet | 429 when requests arrive too fast | AWS throttling; container failed-lookup limiter. |
| OWASP API Security Top 10 2023: API1 Broken Object Level Authorization | A caller must reach only their own objects | The token resolves to its owner's `userId`, and every existing handler already scopes by it. A cross-user test is required. |
| API2 Broken Authentication | Strong credentials, no leakage, revocation | 256-bit random, hashed at rest, shown once, revocable, expiring, never logged or exported. |
| API4 Unrestricted Resource Consumption | Limit consumption | 25 tokens per user; throttling; failed-lookup limiter. |
| API5 Broken Function Level Authorization | Admin-type functions need separate checks | Token management and `/api/auth/*` refuse tokens; read tokens refuse every write. |
| API9 Improper Inventory Management | Know and document every endpoint | HOA-7 (the OpenAPI spec) follows this work and documents the token routes. |
| OWASP Authorization Cheat Sheet | Least privilege; deny by default; validate on every request | Read-only default; deny by default; the lookup runs on every request, never cached across them. |
| NIST SP 800-63B | Store authenticator secrets hashed; invalidate immediately on notice or evidence of compromise; do not force routine changes; limit failed attempts | Hashed; revocation applies on the next request, and a password reset revokes all; no forced rotation, so "never" is allowed (see below); failed-attempt limiter. NIST sets no fixed lifetime for authenticators. |
| RFC 6750 (bearer tokens) | TLS always; not in URLs; short-lived (one hour or less); audience restriction; do not leak | TLS and header-only as above. **Deviation:** personal tokens last months, not an hour (see below). Audience is this one instance. |
| CWE (SANS/CWE Top 25): CWE-287, CWE-306, CWE-862, CWE-863 | Missing or incorrect authentication and authorization | Covered by the single enforcement point and the management-routes rule above. |
| CWE-532 / CWE-200 | Secrets in logs or responses | Never logged; shown once; `no-store`. |
| CWE-352 (CSRF) | Forged cross-site requests | A header token is not ambient, so it is not forgeable; a request with a token ignores any cookie. |

### Accepted deviations

- **Lifetime.** RFC 6750 asks for short-lived bearer tokens. A personal token that a person pastes into a desktop client cannot be an hour long without a refresh flow, which is a non-goal. The mitigations are: the expiry choice with 90 days preselected, read-only by default, instant revocation, last-used visibility, and hashed, never-logged storage. "Never" is allowed by decision; it shows a warning at creation.
- **Unsalted hash.** Acceptable at 256 bits of randomness, as above.

## Controls to add to `SECURITY.md`

- AUTH-12: Personal API tokens are random (at least 128 bits, here 256), stored only as hashes outside `USER#`, shown once, expiring by user choice, revocable, and never logged or exported.
- AUTH-13: Token requests are read-only unless the stored scope allows writes; enforcement is central and deny by default; scope and expiry come only from the stored record.
- AUTH-14: A token may not call token management, `/api/auth/*` or push-subscription routes.
- AUTH-15: A password reset revokes every token (local mode).
- AUTH-16: Failed token lookups are rate limited in the container.

## Left to the builder

- Exact item keys (within the two stated properties), file layout, and whether the work ships as two PRs (server, then Settings UI).
- Audit of the route table for side-effecting `GET` routes, and the guard test.
- Confirming no infrastructure change is needed: the new items live in the existing table, API Gateway has no authorizer, and the table policy is table-wide. If a policy is scoped to key patterns, it needs updating.
- Whether `yarn screenshots` needs re-running, if the Settings page is one of the About-page images.
- Wording of the Settings copy, in Hoardwise's calm tone.

## My calls (not yet confirmed by the owner)

- Token prefixes `hwr_` and `hww_`.
- 90 days preselected as the default expiry.
- Password re-entry to create a write token, in local mode only (Auth0 mode has no password for us to check; it relies on the signed-in session).
- A password reset revokes all tokens, even when it is a forgotten password rather than a compromise: it fails safe, at the cost of re-creating tokens.
- 25 tokens per user; failed-lookup limit of 30 a minute per address.
- Token management refuses tokens, rather than allowing a write token to manage tokens.
