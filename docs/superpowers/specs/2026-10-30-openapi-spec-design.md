# OpenAPI spec for the Hoardwise API (HOA-7)

## Why

Tokens (HOA-5/6) let agents and scripts call the API, but nothing describes it. The route list, the amount unit, the date formats and the transaction-type names live only in the handlers. HOA-8 (SKILL.md), HOA-9 (agent API reference built in CI) and the MCP work (HOA-10/11) all need one trustworthy description to build on, so a wrong or stale spec is worse than none: an agent would act on it.

## Goals

- `docs/openapi.yaml`, OpenAPI 3.1, hand-written, covering every route: the 31 budget and push routes plus the 3 `/api/tokens` routes.
- Request and response schemas for each operation, and the error shape `{ "error": string }` (plus the 429 `Retry-After` and the extra fields some errors carry).
- Prose the code does not state, in the spec's `info.description` and schema descriptions:
  - Amounts are integer pence (or cents), positive, at most `MAX_AMOUNT_PENCE` (1,000,000,000). Account balances use the field name `pence`.
  - Dates are `YYYY-MM-DD`; months are `YYYY-MM`; timestamps are ISO 8601.
  - Transaction types: `EXPENSE` is Spend, `INCOME` is Income, `SET_ASIDE` is Add to pot, `TAKE_OUT` is Take from pot. "Budgets" are category targets (`/api/targets`), weekly or monthly.
  - Auth: session cookie or Auth0 JWT for the app; personal access tokens (`hwr_` read, `hww_` write) as `Authorization: Bearer`. Read tokens may only call GET and HEAD. Tokens never reach `/api/tokens`, `/api/push` or `/api/auth`.
- Each operation says whether a token can call it (`x-token-access: none | read | write`).
- CI fails on drift (see Tests).

## Non-goals

- Serving the spec from the API, rendering it, or publishing it (HOA-9).
- The `/api/auth/*` routes. They belong to the auth provider (local login or Auth0), not the budget API, and tokens never reach them. The overview says so.
- Generating the spec from code. It stays hand-written; the tests keep it honest.
- Changing any handler's behaviour. Where the spec finds an inconsistency, it documents what the code does and the finding goes in a Linear issue.

## Tests (the drift guard)

1. **Valid spec.** `docs/openapi.yaml` parses and validates as OpenAPI 3.1 (new dev dependencies: a YAML parser and an OpenAPI validator).
2. **Route parity, both ways.** `Router` gains a `routes()` method returning `{ method, template }` pairs. The test builds the same routers `api-handler.ts` builds (core, push, tokens) and fails if a registered route is missing from the spec or a spec operation has no route. To make that possible without importing `api-handler.ts` (which calls `initStore` lazily but wires the handler), the route registration moves into an exported function both use.
3. **Token access parity.** `x-token-access` is checked against `createTokenRouter()` (which routes a token reaches) and the method rule in `tokenAccessRejection` (GET/HEAD vs write).
4. **Contract test.** Each operation is called once against a `MemoryStore` seeded with a small household, using the spec's own request examples, and the 2xx response body is validated against the operation's response schema with Ajv. Error responses are validated against the `Error` schema for one representative case per status the spec lists. Operations whose success needs a push service or the network are skipped with a listed reason.

Spec examples double as the contract test's inputs, so an example that stops being valid fails CI too.

## Decisions

Mine (not discussed): OpenAPI 3.1 rather than 3.0; file at `docs/openapi.yaml`; the `x-token-access` extension name; Ajv for schema validation; the route-registration refactor in item 2; leaving `/api/auth/*` out.

Yours: hand-written spec with CI drift checks; the contract test is included.

## Left to the builder

Schema naming and shared components, example data, tag grouping (categories, transactions, targets, pots, recurring, accounts, trash, push, tokens), and which dev dependencies, provided they are pinned and `yarn audit` stays clean.

## Security and review notes

- The spec must not contain a real-looking token, host or credential; examples use obvious placeholders (`hwr_` followed by `EXAMPLE`).
- The overview repeats the SECURITY.md token rules (AUTH-12..16) accurately; the token-access test is what keeps it accurate.
