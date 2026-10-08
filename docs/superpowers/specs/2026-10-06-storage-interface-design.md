# Storage Interface: design

First of three sub-projects that let the app run as a self-hosted container alongside the existing AWS deployment: **Storage Interface** (this spec), **Portable Auth** and **Container Image**. It branches from `main` and changes no behaviour a user can see; the Lambda and DynamoDB deployment keeps running on it unchanged.

## Intent

Put a small backend-neutral `Store` interface under every data-access call, with two implementations: `DynamoStore` (today's behaviour) and `SqliteStore` (what the container will use). Success means:

- The same contract tests pass against both backends.
- Every handler talks to `Store`, and nothing outside `DynamoStore` imports the AWS SDK.
- A user's data can be exported from either backend and imported into either, which is the path for moving real AWS data into a container.

This serves the self-hosting and hosting-partner plan: each user holds their own data, and the author only publishes software (see the monetisation decisions).

## Decisions

| Question | Decision |
|----------|----------|
| Databases supported in the container | SQLite only. Postgres can be added later behind the same interface. |
| Interface vocabulary | Keep the `PK`/`SK` single-table keys and the existing `pk()`, `txnSk()` etc. helpers. No per-entity repositories. This keeps the migration mechanical and behaviour-preserving. |
| Handler access | A module-level store, chosen once at startup by `await initStore()`, which reads the `STORE` env var (`dynamodb` default, `sqlite`) and loads only that backend with a dynamic `import()`, so the Lambda never needs `node:sqlite` and the container never needs the AWS SDK. `getStore()` is synchronous and `setStore()` overrides it for tests, mirroring how `docClient` is used today. The store is not threaded through handler signatures. |
| Paging | `query` returns every matching item. No cursor. |
| Failures | A backend-neutral `ConditionFailedError`, with `failedIndex` for `transact`, replaces the `error.name` string checks and the cancellation-code-by-position logic. |
| SQLite driver | `node:sqlite`, built into Node 24. The Dockerfile pins the Node version, and only `sqlite.ts` touches the driver, so swapping to `better-sqlite3` is a one-file change. |
| DynamoDB TTL | `SqliteStore` fills an `expires_at` column from the item's numeric `expiresAt` and exposes `purgeExpired()`. It has no timers; the container server calls it at startup and hourly. |
| Export/import | Per user, built on `query` and `put` only. No table scan, so the IAM policy gains no permission (INFRA-01). |

**Not doing (on purpose):** auth changes, the HTTP server, Docker, Postgres, per-entity repositories, cursor paging, a table-wide scan, and any API or response-shape change.

## 1. The `Store` interface

```ts
type Key = { PK: string; SK: string };
type Item = Key & Record<string, unknown>;

type TxOp =
  | { put: Item; ifAbsent?: boolean }
  | { delete: Key; ifPresent?: boolean };

interface Store {
  get(key: Key): Promise<Item | undefined>;
  put(item: Item, opts?: { ifAbsent?: boolean }): Promise<void>;
  patch(key: Key, fields: Record<string, unknown>,
        opts?: { mustExist?: boolean; defaults?: Record<string, unknown> }): Promise<Item>;
  delete(key: Key, opts?: { ifPresent?: boolean }): Promise<void>;
  query(pk: string, opts?: { skPrefix?: string; skEquals?: string; attributes?: string[] }): Promise<Item[]>;
  transact(ops: TxOp[]): Promise<void>;
}
```

- **`patch` is an upsert**, matching DynamoDB `UpdateItem`: it creates the item when missing. `mustExist: true` throws `ConditionFailedError` instead, covering today's `attribute_exists(PK)` cases. `defaults` are applied only to attributes not already set, covering `createdAt = if_not_exists(createdAt, :now)` in `push.ts`. It returns the updated item.
- **`query`** takes exactly one of `skPrefix`, `skEquals` or neither (the whole partition). `attributes` returns only the named attributes, covering the two projection sites (`SK`, `categoryId`). Results are ordered by `SK` ascending, as DynamoDB returns them, and an empty `skPrefix` means the whole partition.
- **`transact`** is all-or-nothing. On a failed condition it throws `ConditionFailedError` whose `failedIndex` is the position of the operation that failed. `trash.ts` branches on this for "already in place" versus "no longer in Recently deleted".
- **Item shape is unchanged:** flat objects with `PK` and `SK` alongside attributes, so responses such as `getTransactions` stay byte-identical.
- **Layout:** `src/store/types.ts` (interface and error, split out so the backends and the registry never import each other), `index.ts` (re-exports them, plus `getStore`/`setStore`/`initStore`), `patch.ts` (shared `patch` validation), `dynamo.ts`, `sqlite.ts`.

## 2. `SqliteStore`

- **Schema:** `items(pk TEXT NOT NULL, sk TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY (pk, sk)) WITHOUT ROWID`, plus a partial index on `expires_at` where it is not null. Key attributes are columns; everything else is JSON in `data`.
- **Prefix queries use a range, never `LIKE`:** `sk >= :prefix AND sk < :prefixUpperBound` under the default binary collation. IDs match `[A-Za-z0-9_-]`, and `_` is a `LIKE` wildcard, so `LIKE` would match unrelated keys. Binary ordering also matches DynamoDB's byte ordering.
- **Atomicity:** `node:sqlite` is synchronous, so `patch` is a read-modify-write inside one `BEGIN IMMEDIATE` transaction. `transact` runs each operation in order inside the same kind of transaction and, on a failed condition, rolls back and throws `ConditionFailedError` with `failedIndex`.
- **Values:** `null` and numbers must round-trip exactly (for example `quietStart: null` in push subscriptions), as the contract suite asserts. `undefined` attributes are dropped by both backends. `DynamoStore` configures the document client with `removeUndefinedValues: true`, because by default the client throws on `undefined`.
- **TTL:** `purgeExpired(now?)` deletes rows whose `expires_at` has passed. Reads do not filter expired rows, matching DynamoDB's lazy TTL, so the existing `isLive()` check in `trash.ts` keeps working.
- **Operation:** WAL mode and a busy timeout. `PRAGMA user_version` with a numbered migration list, starting at 1, so later releases can change the schema safely.
- **Configuration:** `STORE=sqlite` and `SQLITE_PATH` (default `/data/budget.sqlite` is for the container spec to set; this spec only requires the variable).

## 3. `DynamoStore`

A thin adapter over the existing `docClient`. Each method issues the same Get, Put, Update, Delete, Query and TransactWrite commands the handlers issue today, and translates `ConditionalCheckFailedException` and `TransactionCanceledException` into `ConditionFailedError`, deriving `failedIndex` from the cancellation reasons. Query pages are followed to the end internally. `infra/` and the Lambda IAM policy do not change.

## 4. Testing

- **Contract suite**, run against both backends: get/put/patch/delete; prefix, equality and whole-partition queries; ids containing underscores; `null` and number round-trips; `ifAbsent`, `ifPresent` and `mustExist`; `defaults`; `attributes` projection; transact commit, and rollback with the right `failedIndex`.
- **`SqliteStore`** runs in memory. **`DynamoStore`** runs against DynamoDB Local as a CI service container. It is CI-only and never shipped, and it is what proves the two backends agree.
- **`SqliteStore`-specific tests:** the migration runner, `purgeExpired`, and range-prefix edge cases (the last character at the top of the range, an empty prefix).
- **`DynamoStore` unit tests** with a mocked client check command shapes and error mapping only.
- **Handler tests** stop mocking `*Command` constructors. They call `setStore(new SqliteStore(':memory:'))`, seed items, and assert on behaviour and resulting store state. This replaces the roughly 277 `mockSend` references and is done per file alongside each handler migration.
- **Export/import round-trip:** DynamoDB Local to JSONL to SQLite to JSONL, compared item by item.

## 5. Migration order

Small PRs, as with the earlier sub-projects:

1. The store package, both backends, the contract suite and the CI job. No handler changes.
2. Handlers in groups, each PR migrating source and tests together: targets, categories, transactions, pots, accounts; then trash, reassign, recurring; then push (including `src/push/store.ts` and the duplicated `queryAll` helpers).
3. Remove the `docClient` export and `db.ts`'s AWS client, and delete the `lib-dynamodb` mocks.
4. The export/import command.

## 6. Export/import

- `export <userId>` writes the user's `USER#<id>` partition as JSONL, one item per line, using `query` only. It runs from the user's own machine with their own AWS credentials.
- **Push subscriptions are excluded** (`PUSHSUB#` items and the `PUSHIDX` entry). They are bound to the old host's VAPID keys and would silently fail elsewhere; the new instance asks the user to re-enable reminders.
- **Trash items are included**, with their `expiresAt`.
- `import --as-user <id>` rewrites the partition key. DynamoDB ids are Auth0 subs, while the built-in login in Portable Auth will issue its own id. Import refuses to write into a non-empty partition unless `--replace` is passed.
- The export file contains financial data. It is written with owner-only permissions, and the docs say never to commit it (SEC-01).

## 7. Open items, resolved while writing the plan

- **`patch` return value:** `categories.ts` and both `UpdateCommand`s in `recurring.ts` use `ReturnValues: 'ALL_NEW'`, so `patch` returning the updated item replaces them.
- **Paging:** the third `ExclusiveStartKey` site is `reassign.ts`, which also pages to the end, so `query` needs no cursor.
- **`node:sqlite`:** it prints no experimental warning on Node 24.18, resolves under Vitest 4, and is typed by the installed `@types/node` 22.19 (all checked).
- **Export/import location:** a root-level `store-cli.ts`, compiled by `scripts/build-store-cli.cjs` in the same way as `api-handler.ts` and `push-handler.ts`. It reads and writes files given by `--out` and `--in`, with `--out` created owner-only and refusing to overwrite.

## Rollout

No infra or IAM change, and no API or response change. `STORE` defaults to `dynamodb`, so the Lambda deployment behaves as before at every step. Rollback of any PR is a revert. `node:sqlite` adds no dependency; DynamoDB Local is a CI service container only.

## Global constraints (for the plan)

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- Security controls in `SECURITY.md` apply (INFRA-01: no new IAM permission and no `Scan`; IO-01 and AUTH-01 unchanged; SEC-01 for export files); run the pre-PR checklist before any PR.
- Handler changes must be behaviour-preserving: no change to any response body, status code or error message.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
