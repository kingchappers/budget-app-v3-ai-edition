# Storage Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a backend-neutral `Store` interface under every data-access call, with `DynamoStore` (today's behaviour) and `SqliteStore` (for the future container), a shared contract suite, and per-user export/import.

**Architecture:** `src/store/` holds the interface, a `ConditionFailedError`, a registry (`initStore`/`getStore`/`setStore`) and two backends. Handlers call `getStore()` instead of `docClient`. The DynamoDB deployment keeps working at every step; SQLite is exercised by tests and by the export/import CLI until the Container Image sub-project serves it.

**Tech Stack:** TypeScript, Vitest 4, `node:sqlite` (Node 24), `@aws-sdk/lib-dynamodb`, DynamoDB Local (CI only).

**Spec:** `docs/superpowers/specs/2026-10-06-storage-interface-design.md`

## Global Constraints

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- Handler changes are behaviour-preserving: no change to any response body, status code or error message. If a converted test needs a different expectation, stop and investigate.
- No new IAM permission and no table `Scan` (INFRA-01). `infra/` must show no diff at the end.
- Only `src/store/dynamo.ts` (and its tests, plus the CI-only contract setup) may import the DynamoDB SDK packages once Task 12 is done. The SSM client in `src/push/vapid.ts` is unrelated and stays. Only `src/store/sqlite.ts` (and its tests, `testing.ts`) may import `node:sqlite`.
- Export files hold financial data: never committed (SEC-01), written owner-only.
- Conventional commits, imperative, under 72 characters. End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` as a second `-m` paragraph. Reference control IDs where relevant (for example "addresses INFRA-01").
- Run the pre-PR checklist in `SECURITY.md` before opening any PR. Verification before each PR: `yarn typecheck && yarn test`.
- Always use absolute paths or run from the repo root; do not `cd` into subdirectories.

## Review Focus

Failure modes the spec implies that are most likely to bite, each pinned by a test in the owning task:

1. **Optional attributes that are `undefined`** (for example a transaction with no `recurringId`): both backends drop them, so nothing throws and nothing is stored. Contract test (Task 2); transactions test (Task 8).
2. **`null` values** (`archivedAt`, `quietStart`, `anchorDate`): must round-trip as `null`, never vanish. Contract test (Task 2); pots test (Task 6); push store test (Task 11).
3. **Ids containing `_`** next to a prefix query: `_` must not act as a wildcard. Contract test (Task 2); range edge test (Task 3).
4. **Expired trash that DynamoDB TTL has not yet deleted:** hidden by `isLive()` but still present until `purgeExpired()`. Tests in Tasks 3 and 7.
5. **Races on restore/delete:** restoring the same trash item twice, or restoring over a re-created item, must give 404/409 and never duplicate or lose data. Test in Task 7.

## Test conversion rules (used by Tasks 6 to 11)

Existing handler tests mock `docClient.send` and the `*Command` constructors. Convert each file like this:

1. Delete the `vi.hoisted` `mockSend` block, the `vi.mock('../db', …)` block and the `vi.mock('@aws-sdk/lib-dynamodb', …)` block. The key helpers in `db.ts` are pure, so the real ones are used. Keep any other `vi.mock` (for example `'../trash'`).
2. Add this setup (adjust the import list):

```ts
import { afterEach, beforeEach } from 'vitest';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';

let store: SqliteStore;
beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });
```

3. **Mock responses become seeded data.** `mockSend.mockResolvedValueOnce({ Items: [a, b] })` becomes `await seedUser(store, 'user-1', [a, b])`. Every seeded item needs the `SK` the handler queries under (for example `CAT#custom-1`); old mocks often omitted it.
4. **Assertions on command shape** (`mockSend.mock.calls[0][0].Item`) become reads from the store: `expect(await store.get({ PK: 'USER#user-1', SK: 'CAT#x' })).toMatchObject({ … })`.
5. **A simulated conditional failure** (a rejected mock) becomes "do not seed the item"; the real condition then fails naturally.
6. **A simulated outage** (`mockRejectedValueOnce(new Error('boom'))`) becomes `vi.spyOn(store, 'put').mockRejectedValueOnce(new Error('boom'))` (use the method the handler calls).
7. **"Makes no DynamoDB call" assertions** become `const spy = vi.spyOn(store, 'query')` before the call and `expect(spy).not.toHaveBeenCalled()` after.
8. **Paging tests** (`LastEvaluatedKey`, "follows every page") are deleted: paging is internal to the store and is covered by the contract suite and `dynamo.test.ts`.
9. Keep every behavioural expectation (status codes, bodies, messages) identical.

## PR boundaries

| PR | Tasks | Branch (from up-to-date `main`) |
|---|---|---|
| A | 1 to 5: store core, both backends, contract suite, CI | `feat/store-core` |
| B | 6 to 9: shared helpers and the handlers that use them | `feat/store-handlers-core` |
| C | 10 to 11: categories, reassign, push | `feat/store-handlers-rest` |
| D | 12 to 13: remove `docClient`, export/import | `feat/store-cleanup-transfer` |

Within PR B, tests for handlers not yet converted (accounts, targets, transactions, recurring) go red once `pots.ts` and `trash.ts` move, and return green in Tasks 8 and 9. Run the targeted test files named in each task, and the full suite at the end of Task 9. PR A, C and D stay green at every commit.

## File Structure

| File | Responsibility |
|---|---|
| `src/store/types.ts` (create) | `Store`, `Key`, `Item`, `TxOp`, option types, `ConditionFailedError`. A separate file so the backends and the registry do not import each other in a cycle. |
| `src/store/patch.ts` (create) | `planPatch`: shared validation of `patch` inputs (strip `undefined`, reject empty, key attributes, field/default overlap). |
| `src/store/index.ts` (create) | Re-exports `types`, plus `getStore`, `setStore`, `initStore`. |
| `src/store/sqlite.ts` (create) | `SqliteStore`, `prefixUpperBound`. |
| `src/store/dynamo.ts` (create) | `DynamoStore`. |
| `src/store/testing.ts` (create) | `useTestStore`, `resetTestStore`, `seedUser` for tests. |
| `src/store/transfer.ts` (create) | `exportUser`, `importUser`, JSONL helpers. |
| `src/store/cli.ts` (create) | `runCli(argv, env)`: the export/import commands. |
| `store-cli.ts` (create, repo root) | Entry point that calls `runCli`. |
| `scripts/build-store-cli.cjs` (create) | Compiles `store-cli.ts` with `tsc`, like the other build scripts. |
| `src/store/__tests__/` (create) | `contract.ts` (shared suite), `sqlite.contract.test.ts`, `dynamo.contract.test.ts`, `store.test.ts`, `sqlite.test.ts`, `dynamo.test.ts`, `init.test.ts`, `transfer.test.ts`, `cli.test.ts`. |
| `src/api/*.ts`, `src/push/store.ts` (modify) | Migrated to `getStore()`. |
| `src/api/db.ts` (modify) | Keeps only key helpers after Task 12. |
| `api-handler.ts`, `src/push/scheduler.ts` (modify) | Call `initStore()` before first use. |
| `.github/workflows/yarnBuild.yml` (modify) | DynamoDB Local service container for the contract suite. |

---

## PR A: store core

### Task 1: Store types, `ConditionFailedError` and the patch planner

**Files:**
- Create: `src/store/types.ts`, `src/store/patch.ts`, `src/store/index.ts`
- Test: `src/store/__tests__/store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: everything in the spec's interface: `Key`, `Item`, `TxOp`, `QueryOptions`, `PatchOptions`, `Store`, `ConditionFailedError(failedIndex?: number)`, `planPatch(fields, defaults?) => { fields: [string, unknown][]; defaults: [string, unknown][] }`, and `getStore(): Store`, `setStore(store: Store | undefined): void`.

- [ ] **Step 0: Create the branch**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/store-core
```

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/store.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ConditionFailedError, getStore, setStore, type Store } from '..';
import { planPatch } from '../patch';

afterEach(() => { setStore(undefined); });

describe('ConditionFailedError', () => {
  it('carries the failing operation index', () => {
    const error = new ConditionFailedError(1);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConditionFailedError');
    expect(error.failedIndex).toBe(1);
  });

  it('has no index for a single-item condition', () => {
    expect(new ConditionFailedError().failedIndex).toBeUndefined();
  });
});

describe('getStore and setStore', () => {
  it('throws a clear error before a store is set', () => {
    expect(() => getStore()).toThrow(/initStore/);
  });

  it('returns the store that was set and forgets it when cleared', () => {
    const fake = {} as Store;
    setStore(fake);
    expect(getStore()).toBe(fake);
    setStore(undefined);
    expect(() => getStore()).toThrow();
  });
});

describe('planPatch', () => {
  it('drops fields and defaults whose value is undefined', () => {
    const plan = planPatch({ a: 1, b: undefined }, { c: 2, d: undefined });
    expect(plan.fields).toEqual([['a', 1]]);
    expect(plan.defaults).toEqual([['c', 2]]);
  });

  it('keeps null values', () => {
    expect(planPatch({ a: null }).fields).toEqual([['a', null]]);
  });

  it('rejects a patch with nothing to set', () => {
    expect(() => planPatch({})).toThrow('patch needs at least one field');
    expect(() => planPatch({ a: undefined })).toThrow('patch needs at least one field');
  });

  it('rejects a name that is both a field and a default', () => {
    expect(() => planPatch({ a: 1 }, { a: 2 })).toThrow('both fields and defaults');
  });

  it('rejects patching the key attributes', () => {
    expect(() => planPatch({ PK: 'x' })).toThrow('key attribute');
    expect(() => planPatch({ ok: 1 }, { SK: 'x' })).toThrow('key attribute');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/store/__tests__/store.test.ts`
Expected: FAIL with "Failed to resolve import '..'" (the modules do not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/store/types.ts`:

```ts
export interface Key {
  PK: string;
  SK: string;
}

export type Item = Key & Record<string, unknown>;

export type TxOp =
  | { put: Item; ifAbsent?: boolean }
  | { delete: Key; ifPresent?: boolean };

export interface QueryOptions {
  skPrefix?: string;
  skEquals?: string;
  attributes?: string[];
}

export interface PatchOptions {
  mustExist?: boolean;
  defaults?: Record<string, unknown>;
}

export interface Store {
  get(key: Key): Promise<Item | undefined>;
  put(item: Item, opts?: { ifAbsent?: boolean }): Promise<void>;
  patch(key: Key, fields: Record<string, unknown>, opts?: PatchOptions): Promise<Item>;
  delete(key: Key, opts?: { ifPresent?: boolean }): Promise<void>;
  query(pk: string, opts?: QueryOptions): Promise<Item[]>;
  transact(ops: TxOp[]): Promise<void>;
}

export class ConditionFailedError extends Error {
  readonly failedIndex: number | undefined;

  constructor(failedIndex?: number) {
    super(failedIndex === undefined ? 'Condition failed' : `Condition failed on operation ${failedIndex}`);
    this.name = 'ConditionFailedError';
    this.failedIndex = failedIndex;
  }
}
```

Create `src/store/patch.ts`:

```ts
const KEY_ATTRIBUTES = new Set(['PK', 'SK']);

export interface PatchPlan {
  fields: [string, unknown][];
  defaults: [string, unknown][];
}

function definedEntries(values: Record<string, unknown>): [string, unknown][] {
  return Object.entries(values).filter(([, value]) => value !== undefined);
}

export function planPatch(fields: Record<string, unknown>, defaults: Record<string, unknown> = {}): PatchPlan {
  const plan: PatchPlan = { fields: definedEntries(fields), defaults: definedEntries(defaults) };
  if (plan.fields.length + plan.defaults.length === 0) {
    throw new Error('patch needs at least one field');
  }

  const keyAttribute = [...plan.fields, ...plan.defaults].find(([name]) => KEY_ATTRIBUTES.has(name));
  if (keyAttribute) {
    throw new Error(`patch cannot change the key attribute "${keyAttribute[0]}"`);
  }

  const fieldNames = new Set(plan.fields.map(([name]) => name));
  const overlap = plan.defaults.find(([name]) => fieldNames.has(name));
  if (overlap) {
    throw new Error(`patch attribute "${overlap[0]}" is in both fields and defaults`);
  }
  return plan;
}
```

Create `src/store/index.ts` (the `initStore` function is added in Task 5):

```ts
import type { Store } from './types';

export * from './types';

let current: Store | undefined;

export function getStore(): Store {
  if (!current) {
    throw new Error('Store not initialised: call initStore() at startup');
  }
  return current;
}

export function setStore(store: Store | undefined): void {
  current = store;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run src/store/__tests__/store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/patch.ts src/store/index.ts src/store/__tests__/store.test.ts
git commit -m "feat: add Store interface and condition error" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Contract suite and `SqliteStore` core

**Files:**
- Create: `src/store/sqlite.ts`, `src/store/__tests__/contract.ts`, `src/store/__tests__/sqlite.contract.test.ts`

**Interfaces:**
- Consumes: `Store`, `Item`, `Key`, `TxOp`, `QueryOptions`, `PatchOptions`, `ConditionFailedError` from `./types`; `planPatch` from `./patch`.
- Produces: `class SqliteStore implements Store` with `constructor(path: string)`, `purgeExpired(nowSeconds?: number): number`, `close(): void`; `prefixUpperBound(prefix: string): string | null`; and `runStoreContract(name: string, backend: ContractBackend, options?: { skip?: boolean }): void` where `ContractBackend = { create(): Promise<Store>; destroy?(): Promise<void> }`.

- [ ] **Step 1: Write the contract suite and the SQLite runner**

Create `src/store/__tests__/contract.ts` (not a test file by name, so Vitest does not run it directly):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConditionFailedError, type Store } from '../types';

export interface ContractBackend {
  create(): Promise<Store>;
  destroy?(): Promise<void>;
}

const newUser = (): string => `USER#${crypto.randomUUID()}`;

export function runStoreContract(name: string, backend: ContractBackend, options: { skip?: boolean } = {}): void {
  const suite = options.skip ? describe.skip : describe;

  suite(`Store contract: ${name}`, () => {
    let store: Store;

    beforeAll(async () => { store = await backend.create(); });
    afterAll(async () => { await backend.destroy?.(); });

    describe('get and put', () => {
      it('returns undefined for a missing item', async () => {
        expect(await store.get({ PK: newUser(), SK: 'CAT#missing' })).toBeUndefined();
      });

      it('stores an item and returns it with its keys', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'CAT#a', name: 'Food', amount: 350, archivedAt: null });
        expect(await store.get({ PK, SK: 'CAT#a' })).toEqual({ PK, SK: 'CAT#a', name: 'Food', amount: 350, archivedAt: null });
      });

      it('replaces the whole item on put', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'CAT#a', name: 'Food', extra: true });
        await store.put({ PK, SK: 'CAT#a', name: 'Dining' });
        expect(await store.get({ PK, SK: 'CAT#a' })).toEqual({ PK, SK: 'CAT#a', name: 'Dining' });
      });

      it('drops undefined attributes instead of failing', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'TXN#2026-10#t1', amount: 100, recurringId: undefined });
        expect(await store.get({ PK, SK: 'TXN#2026-10#t1' })).toEqual({ PK, SK: 'TXN#2026-10#t1', amount: 100 });
      });

      it('round-trips nulls, arrays and nested objects exactly', async () => {
        const PK = newUser();
        const value = { quietStart: null, list: [1, 'two', null], nested: { ok: true, n: 0 } };
        await store.put({ PK, SK: 'PUSHSUB#x', ...value });
        expect(await store.get({ PK, SK: 'PUSHSUB#x' })).toEqual({ PK, SK: 'PUSHSUB#x', ...value });
      });

      it('refuses to overwrite with ifAbsent and keeps the original', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'CAT#a', name: 'First' }, { ifAbsent: true });
        await expect(store.put({ PK, SK: 'CAT#a', name: 'Second' }, { ifAbsent: true }))
          .rejects.toBeInstanceOf(ConditionFailedError);
        expect(await store.get({ PK, SK: 'CAT#a' })).toMatchObject({ name: 'First' });
      });
    });

    describe('patch', () => {
      it('creates the item when it is missing', async () => {
        const PK = newUser();
        const item = await store.patch({ PK, SK: 'PUSHSUB#x' }, { hour: 8 });
        expect(item).toEqual({ PK, SK: 'PUSHSUB#x', hour: 8 });
        expect(await store.get({ PK, SK: 'PUSHSUB#x' })).toEqual(item);
      });

      it('merges into an existing item and returns the result', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'CAT#a', name: 'Food', icon: 'star' });
        const item = await store.patch({ PK, SK: 'CAT#a' }, { name: 'Dining' }, { mustExist: true });
        expect(item).toEqual({ PK, SK: 'CAT#a', name: 'Dining', icon: 'star' });
      });

      it('throws and creates nothing when mustExist is set and the item is missing', async () => {
        const PK = newUser();
        await expect(store.patch({ PK, SK: 'CAT#gone' }, { name: 'x' }, { mustExist: true }))
          .rejects.toBeInstanceOf(ConditionFailedError);
        expect(await store.get({ PK, SK: 'CAT#gone' })).toBeUndefined();
      });

      it('applies defaults only to attributes that are not already set', async () => {
        const PK = newUser();
        await store.patch({ PK, SK: 'PUSHSUB#x' }, { hour: 8 }, { defaults: { createdAt: 'first' } });
        await store.patch({ PK, SK: 'PUSHSUB#x' }, { hour: 9 }, { defaults: { createdAt: 'second' } });
        expect(await store.get({ PK, SK: 'PUSHSUB#x' })).toMatchObject({ hour: 9, createdAt: 'first' });
      });

      it('ignores undefined fields and keeps null ones', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'RECUR#r', anchorDate: '2026-01-01', leadDays: 3 });
        const item = await store.patch({ PK, SK: 'RECUR#r' }, { anchorDate: null, leadDays: undefined });
        expect(item).toEqual({ PK, SK: 'RECUR#r', anchorDate: null, leadDays: 3 });
      });

      it('rejects an empty patch', async () => {
        await expect(store.patch({ PK: newUser(), SK: 'CAT#a' }, {})).rejects.toThrow('at least one field');
      });
    });

    describe('delete', () => {
      it('removes an item and tolerates a missing one', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'CAT#a', name: 'Food' });
        await store.delete({ PK, SK: 'CAT#a' });
        await store.delete({ PK, SK: 'CAT#a' });
        expect(await store.get({ PK, SK: 'CAT#a' })).toBeUndefined();
      });

      it('throws with ifPresent when the item is missing', async () => {
        await expect(store.delete({ PK: newUser(), SK: 'CAT#a' }, { ifPresent: true }))
          .rejects.toBeInstanceOf(ConditionFailedError);
      });
    });

    describe('query', () => {
      async function seed(PK: string, sks: string[]): Promise<void> {
        for (const SK of sks) await store.put({ PK, SK, n: SK.length });
      }

      it('returns the whole partition in ascending SK order and nothing from other users', async () => {
        const PK = newUser();
        await seed(PK, ['TXN#2026-10#b', 'CAT#a', 'TXN#2026-09#z']);
        await seed(newUser(), ['CAT#other']);
        const items = await store.query(PK);
        expect(items.map(item => item.SK)).toEqual(['CAT#a', 'TXN#2026-09#z', 'TXN#2026-10#b']);
      });

      it('treats an empty prefix as the whole partition', async () => {
        const PK = newUser();
        await seed(PK, ['CAT#a', 'POT#a']);
        expect(await store.query(PK, { skPrefix: '' })).toHaveLength(2);
      });

      it('filters by SK prefix', async () => {
        const PK = newUser();
        await seed(PK, ['TXN#2026-10#a', 'TXN#2026-10#b', 'TXN#2026-11#a', 'CAT#a']);
        const items = await store.query(PK, { skPrefix: 'TXN#2026-10' });
        expect(items.map(item => item.SK)).toEqual(['TXN#2026-10#a', 'TXN#2026-10#b']);
      });

      it('does not treat an underscore in a prefix as a wildcard', async () => {
        const PK = newUser();
        await seed(PK, ['TXN#2026-10#a_b', 'TXN#2026-10#axb', 'TXN#2026-10#a%b']);
        expect((await store.query(PK, { skPrefix: 'TXN#2026-10#a_' })).map(item => item.SK)).toEqual(['TXN#2026-10#a_b']);
        expect((await store.query(PK, { skPrefix: 'TXN#2026-10#a%' })).map(item => item.SK)).toEqual(['TXN#2026-10#a%b']);
      });

      it('matches one SK exactly with skEquals', async () => {
        const PK = newUser();
        await seed(PK, ['CAT#a', 'CAT#ab']);
        expect((await store.query(PK, { skEquals: 'CAT#a' })).map(item => item.SK)).toEqual(['CAT#a']);
        expect(await store.query(PK, { skEquals: 'CAT#none' })).toEqual([]);
      });

      it('returns only the named attributes when asked', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'POT#a', categoryId: 'a', monthlyAmount: 5, archivedAt: null });
        expect(await store.query(PK, { skPrefix: 'POT#', attributes: ['SK'] })).toEqual([{ SK: 'POT#a' }]);
        expect(await store.query(PK, { skPrefix: 'POT#', attributes: ['categoryId'] })).toEqual([{ categoryId: 'a' }]);
      });

      it('rejects skPrefix and skEquals together', async () => {
        await expect(store.query(newUser(), { skPrefix: 'A', skEquals: 'B' })).rejects.toThrow('not both');
      });

      it('returns every item of a partition larger than one page', async () => {
        const PK = newUser();
        const pad = 'x'.repeat(5000);
        await Promise.all(Array.from({ length: 300 }, (_, index) => (
          store.put({ PK, SK: `TXN#2026-10#${String(index).padStart(4, '0')}`, pad })
        )));
        expect(await store.query(PK, { skPrefix: 'TXN#' })).toHaveLength(300);
      }, 60000);
    });

    describe('transact', () => {
      it('applies every operation together', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'TXN#2026-10#t1', amount: 5 });
        await store.transact([
          { delete: { PK, SK: 'TXN#2026-10#t1' }, ifPresent: true },
          { put: { PK, SK: 'TXN#2026-11#t1', amount: 5 }, ifAbsent: true },
        ]);
        expect(await store.get({ PK, SK: 'TXN#2026-10#t1' })).toBeUndefined();
        expect(await store.get({ PK, SK: 'TXN#2026-11#t1' })).toMatchObject({ amount: 5 });
      });

      it('rolls everything back and reports the index of a failed ifAbsent', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'TXN#2026-10#t1', amount: 1 });
        await expect(store.transact([
          { put: { PK, SK: 'TXN#2026-11#t1', amount: 1 } },
          { put: { PK, SK: 'TXN#2026-10#t1', amount: 2 }, ifAbsent: true },
        ])).rejects.toMatchObject({ name: 'ConditionFailedError', failedIndex: 1 });
        expect(await store.get({ PK, SK: 'TXN#2026-11#t1' })).toBeUndefined();
        expect(await store.get({ PK, SK: 'TXN#2026-10#t1' })).toMatchObject({ amount: 1 });
      });

      it('reports index 0 and index 1 for a failed ifPresent delete', async () => {
        const PK = newUser();
        await store.put({ PK, SK: 'B', n: 1 });
        await expect(store.transact([
          { delete: { PK, SK: 'A' }, ifPresent: true },
          { delete: { PK, SK: 'B' } },
        ])).rejects.toMatchObject({ failedIndex: 0 });
        await expect(store.transact([
          { delete: { PK, SK: 'B' }, ifPresent: true },
          { delete: { PK, SK: 'A' }, ifPresent: true },
        ])).rejects.toMatchObject({ failedIndex: 1 });
        expect(await store.get({ PK, SK: 'B' })).toMatchObject({ n: 1 });
      });

      it('rejects two operations on the same item', async () => {
        const PK = newUser();
        await expect(store.transact([
          { put: { PK, SK: 'A', n: 1 } },
          { delete: { PK, SK: 'A' } },
        ])).rejects.toThrow();
      });

      it('does nothing for an empty list', async () => {
        await expect(store.transact([])).resolves.toBeUndefined();
      });
    });
  });
}
```

Create `src/store/__tests__/sqlite.contract.test.ts`:

```ts
import { SqliteStore } from '../sqlite';
import { runStoreContract } from './contract';

runStoreContract('SqliteStore (in memory)', {
  create: async () => new SqliteStore(':memory:'),
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `yarn vitest run src/store/__tests__/sqlite.contract.test.ts`
Expected: FAIL with "Failed to resolve import '../sqlite'".

- [ ] **Step 3: Write `SqliteStore`**

Create `src/store/sqlite.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { planPatch } from './patch';
import {
  ConditionFailedError, type Item, type Key, type PatchOptions, type QueryOptions, type Store, type TxOp,
} from './types';

const MIGRATIONS: string[] = [
  `CREATE TABLE items (
     pk TEXT NOT NULL,
     sk TEXT NOT NULL,
     data TEXT NOT NULL,
     expires_at INTEGER,
     PRIMARY KEY (pk, sk)
   ) WITHOUT ROWID;
   CREATE INDEX items_expires_at ON items (expires_at) WHERE expires_at IS NOT NULL;`,
];

interface Row {
  sk: string;
  data: string;
}

// The smallest string above every string that starts with `prefix`, under SQLite's binary
// (UTF-8 byte) ordering. Null when the last character cannot be bumped safely.
export function prefixUpperBound(prefix: string): string | null {
  const last = prefix.charCodeAt(prefix.length - 1);
  const isSurrogate = last >= 0xd800 && last <= 0xdfff;
  if (isSurrogate || last === 0xffff) return null;
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

function pick(item: Item, attributes: string[]): Item {
  const picked: Record<string, unknown> = {};
  for (const name of attributes) {
    if (name in item) picked[name] = item[name];
  }
  return picked as Item;
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  purgeExpired(nowSeconds: number = Math.floor(Date.now() / 1000)): number {
    const result = this.db
      .prepare('DELETE FROM items WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .run(nowSeconds);
    return Number(result.changes);
  }

  async get(key: Key): Promise<Item | undefined> {
    const data = this.readData(key);
    return data === undefined ? undefined : this.toItem(key.PK, key.SK, data);
  }

  async put(item: Item, opts: { ifAbsent?: boolean } = {}): Promise<void> {
    if (!opts.ifAbsent) {
      this.write(item);
      return;
    }
    this.inTransaction(() => {
      if (this.exists(item)) throw new ConditionFailedError();
      this.write(item);
    });
  }

  async patch(key: Key, fields: Record<string, unknown>, opts: PatchOptions = {}): Promise<Item> {
    const plan = planPatch(fields, opts.defaults);
    return this.inTransaction(() => {
      const stored = this.readData(key);
      if (stored === undefined && opts.mustExist) throw new ConditionFailedError();

      const current: Record<string, unknown> = stored === undefined ? {} : JSON.parse(stored);
      const defaults = plan.defaults.filter(([name]) => current[name] === undefined);
      this.write({ ...Object.fromEntries(defaults), ...current, ...Object.fromEntries(plan.fields), PK: key.PK, SK: key.SK });
      return this.toItem(key.PK, key.SK, this.readData(key) as string);
    });
  }

  async delete(key: Key, opts: { ifPresent?: boolean } = {}): Promise<void> {
    this.inTransaction(() => {
      if (opts.ifPresent && !this.exists(key)) throw new ConditionFailedError();
      this.remove(key);
    });
  }

  async query(pk: string, opts: QueryOptions = {}): Promise<Item[]> {
    if (opts.skPrefix !== undefined && opts.skEquals !== undefined) {
      throw new Error('query takes skPrefix or skEquals, not both');
    }
    const items = this.selectRows(pk, opts).map(row => this.toItem(pk, row.sk, row.data));
    return opts.attributes ? items.map(item => pick(item, opts.attributes as string[])) : items;
  }

  async transact(ops: TxOp[]): Promise<void> {
    if (ops.length === 0) return;
    const keys = ops.map(op => ('put' in op ? op.put : op.delete));
    const identities = new Set(keys.map(key => `${key.PK}\u0000${key.SK}`));
    if (identities.size !== keys.length) {
      throw new Error('transact cannot touch the same item twice');
    }

    this.inTransaction(() => {
      ops.forEach((op, index) => {
        if ('put' in op) {
          if (op.ifAbsent && this.exists(op.put)) throw new ConditionFailedError(index);
          this.write(op.put);
          return;
        }
        if (op.ifPresent && !this.exists(op.delete)) throw new ConditionFailedError(index);
        this.remove(op.delete);
      });
    });
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version > MIGRATIONS.length) {
      throw new Error(
        `This database was created by a newer version of the app (schema ${row.user_version}, this build knows ${MIGRATIONS.length})`,
      );
    }
    for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
      this.inTransaction(() => {
        this.db.exec(MIGRATIONS[version]);
        this.db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    }
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private readData(key: Key): string | undefined {
    const row = this.db.prepare('SELECT data FROM items WHERE pk = ? AND sk = ?').get(key.PK, key.SK) as
      | { data: string }
      | undefined;
    return row?.data;
  }

  private exists(key: Key): boolean {
    return this.db.prepare('SELECT 1 AS present FROM items WHERE pk = ? AND sk = ?').get(key.PK, key.SK) !== undefined;
  }

  private write(item: Item): void {
    const { PK, SK, ...attributes } = item;
    const expiresAt = typeof attributes.expiresAt === 'number' ? attributes.expiresAt : null;
    this.db
      .prepare(
        `INSERT INTO items (pk, sk, data, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (pk, sk) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
      )
      .run(PK, SK, JSON.stringify(attributes), expiresAt);
  }

  private remove(key: Key): void {
    this.db.prepare('DELETE FROM items WHERE pk = ? AND sk = ?').run(key.PK, key.SK);
  }

  private toItem(pk: string, sk: string, data: string): Item {
    return { ...JSON.parse(data), PK: pk, SK: sk };
  }

  private selectRows(pk: string, opts: QueryOptions): Row[] {
    const columns = 'SELECT sk, data FROM items WHERE pk = ?';
    if (opts.skEquals !== undefined) {
      return this.db.prepare(`${columns} AND sk = ?`).all(pk, opts.skEquals) as unknown as Row[];
    }

    const prefix = opts.skPrefix ?? '';
    if (prefix === '') {
      return this.db.prepare(`${columns} ORDER BY sk`).all(pk) as unknown as Row[];
    }

    const upper = prefixUpperBound(prefix);
    if (upper !== null) {
      return this.db.prepare(`${columns} AND sk >= ? AND sk < ? ORDER BY sk`).all(pk, prefix, upper) as unknown as Row[];
    }
    const length = Array.from(prefix).length;
    return this.db
      .prepare(`${columns} AND sk >= ? AND substr(sk, 1, ?) = ? ORDER BY sk`)
      .all(pk, prefix, length, prefix) as unknown as Row[];
  }
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `yarn vitest run src/store`
Expected: PASS (`store.test.ts` and the SQLite contract suite).

- [ ] **Step 5: Commit**

```bash
git add src/store/sqlite.ts src/store/__tests__/contract.ts src/store/__tests__/sqlite.contract.test.ts
git commit -m "feat: add SqliteStore and the Store contract suite" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `SqliteStore` specifics (migrations, TTL purge, range edges)

**Files:**
- Create: `src/store/__tests__/sqlite.test.ts`
- Modify: none (the behaviour was written in Task 2; this task pins it).

**Interfaces:**
- Consumes: `SqliteStore`, `prefixUpperBound` from `../sqlite`.
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

Create `src/store/__tests__/sqlite.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prefixUpperBound, SqliteStore } from '../sqlite';

const PK = 'USER#u1';

describe('SqliteStore on disk', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sqlite-store-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('keeps data across reopening and records the schema version', async () => {
    const path = join(dir, 'budget.sqlite');
    const first = new SqliteStore(path);
    await first.put({ PK, SK: 'CAT#a', name: 'Food' });
    first.close();

    const second = new SqliteStore(path);
    expect(await second.get({ PK, SK: 'CAT#a' })).toMatchObject({ name: 'Food' });
    second.close();

    const raw = new DatabaseSync(path);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    raw.close();
  });

  it('refuses a database created by a newer version of the app', () => {
    const path = join(dir, 'newer.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    expect(() => new SqliteStore(path)).toThrow(/newer version/);
  });
});

describe('purgeExpired', () => {
  it('removes only items whose expiresAt has passed and reports how many', async () => {
    const store = new SqliteStore(':memory:');
    await store.put({ PK, SK: 'TRASH#a', expiresAt: 100 });
    await store.put({ PK, SK: 'TRASH#b', expiresAt: 300 });
    await store.put({ PK, SK: 'CAT#keep', name: 'no expiry' });

    expect(store.purgeExpired(200)).toBe(1);
    expect((await store.query(PK)).map(item => item.SK)).toEqual(['CAT#keep', 'TRASH#b']);
  });

  it('does not hide an expired item from reads before it is purged', async () => {
    const store = new SqliteStore(':memory:');
    await store.put({ PK, SK: 'TRASH#a', expiresAt: 100 });
    expect(await store.get({ PK, SK: 'TRASH#a' })).toMatchObject({ expiresAt: 100 });
  });

  it('follows a patch that changes expiresAt', async () => {
    const store = new SqliteStore(':memory:');
    await store.put({ PK, SK: 'TRASH#a', expiresAt: 100 });
    await store.patch({ PK, SK: 'TRASH#a' }, { expiresAt: 900 });
    expect(store.purgeExpired(200)).toBe(0);
    expect(store.purgeExpired(1000)).toBe(1);
  });
});

describe('prefix ranges', () => {
  it('bumps the last character to form the exclusive upper bound', () => {
    expect(prefixUpperBound('TXN#')).toBe('TXN$');
    expect(prefixUpperBound('a')).toBe('b');
  });

  it('gives up on a last character that cannot be bumped', () => {
    expect(prefixUpperBound('a￿')).toBeNull();
    expect(prefixUpperBound('a\ud83d')).toBeNull();
  });

  it('still finds keys under a prefix that ends in U+FFFF', async () => {
    const store = new SqliteStore(':memory:');
    for (const SK of ['p￿', 'p￿x', 'q', 'p']) await store.put({ PK, SK, n: 1 });
    const items = await store.query(PK, { skPrefix: 'p￿' });
    expect(items.map(item => item.SK)).toEqual(['p￿', 'p￿x']);
  });

  it('finds keys when the prefix ends in the highest ASCII character', async () => {
    const store = new SqliteStore(':memory:');
    for (const SK of ['a~', 'a~z', 'a\u007f', 'b']) await store.put({ PK, SK, n: 1 });
    const items = await store.query(PK, { skPrefix: 'a~' });
    expect(items.map(item => item.SK)).toEqual(['a~', 'a~z']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `yarn vitest run src/store/__tests__/sqlite.test.ts`
Expected: PASS. If any test fails, the failure is a real defect in Task 2's `SqliteStore`: fix `src/store/sqlite.ts`, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/store/__tests__/sqlite.test.ts
git commit -m "test: pin SqliteStore migrations, TTL purge and prefix ranges" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `DynamoStore`, its unit tests, the DynamoDB Local contract run and CI

**Files:**
- Create: `src/store/dynamo.ts`, `src/store/__tests__/dynamo.test.ts`, `src/store/__tests__/dynamo.contract.test.ts`
- Modify: `.github/workflows/yarnBuild.yml`

**Interfaces:**
- Consumes: `Store` types and `ConditionFailedError` from `./types`; `planPatch` from `./patch`; `runStoreContract` from `./__tests__/contract`.
- Produces: `class DynamoStore implements Store` with `constructor(client: Sender, table: string)` and `static fromEnv(env?: NodeJS.ProcessEnv): DynamoStore`; `interface Sender { send(command: any): Promise<any> }`.

- [ ] **Step 1: Write the failing unit tests**

Create `src/store/__tests__/dynamo.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamoStore } from '../dynamo';
import { ConditionFailedError } from '../types';

const send = vi.fn();
const store = new DynamoStore({ send }, 'test-table');
const PK = 'USER#u1';

function sentInput(call = 0): Record<string, any> {
  return send.mock.calls[call][0].input;
}

function awsError(name: string, extra: object = {}): Error {
  return Object.assign(new Error(name), { name, ...extra });
}

beforeEach(() => { send.mockReset(); });

describe('get', () => {
  it('sends only the key and returns the item', async () => {
    send.mockResolvedValueOnce({ Item: { PK, SK: 'CAT#a', name: 'Food' } });
    const item = await store.get({ PK, SK: 'CAT#a', extra: 'ignored' } as any);
    expect(sentInput()).toEqual({ TableName: 'test-table', Key: { PK, SK: 'CAT#a' } });
    expect(item).toEqual({ PK, SK: 'CAT#a', name: 'Food' });
  });

  it('returns undefined when there is no item', async () => {
    send.mockResolvedValueOnce({});
    expect(await store.get({ PK, SK: 'CAT#a' })).toBeUndefined();
  });
});

describe('put', () => {
  it('adds no condition by default', async () => {
    send.mockResolvedValueOnce({});
    await store.put({ PK, SK: 'CAT#a', name: 'Food' });
    expect(sentInput().ConditionExpression).toBeUndefined();
  });

  it('requires the item to be absent with ifAbsent', async () => {
    send.mockResolvedValueOnce({});
    await store.put({ PK, SK: 'CAT#a' }, { ifAbsent: true });
    expect(sentInput().ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('turns a failed condition into ConditionFailedError', async () => {
    send.mockRejectedValueOnce(awsError('ConditionalCheckFailedException'));
    await expect(store.put({ PK, SK: 'CAT#a' }, { ifAbsent: true })).rejects.toBeInstanceOf(ConditionFailedError);
  });

  it('lets other errors through unchanged', async () => {
    const boom = awsError('ProvisionedThroughputExceededException');
    send.mockRejectedValueOnce(boom);
    await expect(store.put({ PK, SK: 'CAT#a' })).rejects.toBe(boom);
  });
});

describe('patch', () => {
  it('aliases every attribute name, drops undefined and returns the new item', async () => {
    send.mockResolvedValueOnce({ Attributes: { PK, SK: 'PUSHSUB#x', hour: 8, auth: 'k' } });
    const item = await store.patch({ PK, SK: 'PUSHSUB#x' }, { hour: 8, auth: 'k', skipped: undefined });
    expect(sentInput()).toMatchObject({
      Key: { PK, SK: 'PUSHSUB#x' },
      UpdateExpression: 'SET #f0 = :f0, #f1 = :f1',
      ExpressionAttributeNames: { '#f0': 'hour', '#f1': 'auth' },
      ExpressionAttributeValues: { ':f0': 8, ':f1': 'k' },
      ReturnValues: 'ALL_NEW',
    });
    expect(sentInput().ConditionExpression).toBeUndefined();
    expect(item).toEqual({ PK, SK: 'PUSHSUB#x', hour: 8, auth: 'k' });
  });

  it('uses if_not_exists for defaults and attribute_exists for mustExist', async () => {
    send.mockResolvedValueOnce({ Attributes: { PK, SK: 'CAT#a' } });
    await store.patch({ PK, SK: 'CAT#a' }, { name: 'x' }, { mustExist: true, defaults: { createdAt: 'now' } });
    expect(sentInput().UpdateExpression).toBe('SET #f0 = :f0, #d0 = if_not_exists(#d0, :d0)');
    expect(sentInput().ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('turns a failed condition into ConditionFailedError', async () => {
    send.mockRejectedValueOnce(awsError('ConditionalCheckFailedException'));
    await expect(store.patch({ PK, SK: 'CAT#a' }, { name: 'x' }, { mustExist: true }))
      .rejects.toBeInstanceOf(ConditionFailedError);
  });

  it('rejects an empty patch without calling DynamoDB', async () => {
    await expect(store.patch({ PK, SK: 'CAT#a' }, {})).rejects.toThrow('at least one field');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('requires the item to exist with ifPresent', async () => {
    send.mockResolvedValueOnce({});
    await store.delete({ PK, SK: 'CAT#a' }, { ifPresent: true });
    expect(sentInput()).toMatchObject({ Key: { PK, SK: 'CAT#a' }, ConditionExpression: 'attribute_exists(PK)' });
  });
});

describe('query', () => {
  it('queries the partition with no sort condition by default', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await store.query(PK);
    expect(sentInput()).toMatchObject({
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'PK' },
      ExpressionAttributeValues: { ':pk': PK },
    });
  });

  it('treats an empty prefix as no sort condition', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await store.query(PK, { skPrefix: '' });
    expect(sentInput().KeyConditionExpression).toBe('#pk = :pk');
  });

  it('uses begins_with for a prefix and equality for skEquals', async () => {
    send.mockResolvedValue({ Items: [] });
    await store.query(PK, { skPrefix: 'TXN#2026-10' });
    await store.query(PK, { skEquals: 'CAT#a' });
    expect(sentInput(0).KeyConditionExpression).toBe('#pk = :pk AND begins_with(#sk, :sk)');
    expect(sentInput(0).ExpressionAttributeValues).toEqual({ ':pk': PK, ':sk': 'TXN#2026-10' });
    expect(sentInput(1).KeyConditionExpression).toBe('#pk = :pk AND #sk = :sk');
  });

  it('aliases projected attributes', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await store.query(PK, { skPrefix: 'POT#', attributes: ['SK', 'categoryId'] });
    expect(sentInput().ProjectionExpression).toBe('#p0, #p1');
    expect(sentInput().ExpressionAttributeNames).toMatchObject({ '#p0': 'SK', '#p1': 'categoryId' });
  });

  it('follows LastEvaluatedKey until the last page', async () => {
    send
      .mockResolvedValueOnce({ Items: [{ PK, SK: 'A' }], LastEvaluatedKey: { PK, SK: 'A' } })
      .mockResolvedValueOnce({ Items: [{ PK, SK: 'B' }] });
    const items = await store.query(PK);
    expect(items.map(item => item.SK)).toEqual(['A', 'B']);
    expect(sentInput(0).ExclusiveStartKey).toBeUndefined();
    expect(sentInput(1).ExclusiveStartKey).toEqual({ PK, SK: 'A' });
  });

  it('rejects skPrefix and skEquals together', async () => {
    await expect(store.query(PK, { skPrefix: 'A', skEquals: 'B' })).rejects.toThrow('not both');
  });
});

describe('transact', () => {
  it('builds Put and Delete items with their conditions', async () => {
    send.mockResolvedValueOnce({});
    await store.transact([
      { delete: { PK, SK: 'A' }, ifPresent: true },
      { put: { PK, SK: 'B', n: 1 }, ifAbsent: true },
      { put: { PK, SK: 'C', n: 2 } },
    ]);
    expect(sentInput().TransactItems).toEqual([
      { Delete: { TableName: 'test-table', Key: { PK, SK: 'A' }, ConditionExpression: 'attribute_exists(PK)' } },
      { Put: { TableName: 'test-table', Item: { PK, SK: 'B', n: 1 }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: 'test-table', Item: { PK, SK: 'C', n: 2 } } },
    ]);
  });

  it('reports the index of the operation whose condition failed', async () => {
    send.mockRejectedValueOnce(awsError('TransactionCanceledException', {
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
    }));
    await expect(store.transact([{ put: { PK, SK: 'A' } }, { put: { PK, SK: 'B' }, ifAbsent: true }]))
      .rejects.toMatchObject({ name: 'ConditionFailedError', failedIndex: 1 });
  });

  it('lets a cancellation without a failed condition through unchanged', async () => {
    const conflict = awsError('TransactionCanceledException', { CancellationReasons: [{ Code: 'TransactionConflict' }] });
    send.mockRejectedValueOnce(conflict);
    await expect(store.transact([{ put: { PK, SK: 'A' } }])).rejects.toBe(conflict);
  });

  it('does not call DynamoDB for an empty list', async () => {
    await store.transact([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('fromEnv', () => {
  it('requires DYNAMODB_TABLE', () => {
    expect(() => DynamoStore.fromEnv({})).toThrow('DYNAMODB_TABLE');
  });

  it('builds a store when the table is named', () => {
    expect(DynamoStore.fromEnv({ DYNAMODB_TABLE: 'budget-data' })).toBeInstanceOf(DynamoStore);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run src/store/__tests__/dynamo.test.ts`
Expected: FAIL with "Failed to resolve import '../dynamo'".

- [ ] **Step 3: Write `DynamoStore`**

Create `src/store/dynamo.ts`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { planPatch } from './patch';
import {
  ConditionFailedError, type Item, type Key, type PatchOptions, type QueryOptions, type Store, type TxOp,
} from './types';

export interface Sender {
  send(command: any): Promise<any>;
}

const MUST_BE_ABSENT = 'attribute_not_exists(PK)';
const MUST_BE_PRESENT = 'attribute_exists(PK)';

function keyOf(key: Key): Key {
  return { PK: key.PK, SK: key.SK };
}

function conditional(expression: string | undefined): { ConditionExpression?: string } {
  return expression ? { ConditionExpression: expression } : {};
}

function translate(error: unknown): unknown {
  if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
    return new ConditionFailedError();
  }
  return error;
}

function translateTransaction(error: unknown): unknown {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return error;
  const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  const failed = reasons.findIndex(reason => reason.Code === 'ConditionalCheckFailed');
  return failed >= 0 ? new ConditionFailedError(failed) : error;
}

export class DynamoStore implements Store {
  constructor(private readonly client: Sender, private readonly table: string) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): DynamoStore {
    const table = env.DYNAMODB_TABLE;
    if (!table) {
      throw new Error('DYNAMODB_TABLE is required when STORE=dynamodb');
    }
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: env.AWS_REGION || 'eu-west-2' }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    return new DynamoStore(client, table);
  }

  async get(key: Key): Promise<Item | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: keyOf(key) }));
    return result.Item as Item | undefined;
  }

  async put(item: Item, opts: { ifAbsent?: boolean } = {}): Promise<void> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.table,
        Item: item,
        ...conditional(opts.ifAbsent ? MUST_BE_ABSENT : undefined),
      }));
    } catch (error) {
      throw translate(error);
    }
  }

  async patch(key: Key, fields: Record<string, unknown>, opts: PatchOptions = {}): Promise<Item> {
    const plan = planPatch(fields, opts.defaults);
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const assignments: string[] = [];

    plan.fields.forEach(([name, value], index) => {
      names[`#f${index}`] = name;
      values[`:f${index}`] = value;
      assignments.push(`#f${index} = :f${index}`);
    });
    plan.defaults.forEach(([name, value], index) => {
      names[`#d${index}`] = name;
      values[`:d${index}`] = value;
      assignments.push(`#d${index} = if_not_exists(#d${index}, :d${index})`);
    });

    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.table,
        Key: keyOf(key),
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ...conditional(opts.mustExist ? MUST_BE_PRESENT : undefined),
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes as Item;
    } catch (error) {
      throw translate(error);
    }
  }

  async delete(key: Key, opts: { ifPresent?: boolean } = {}): Promise<void> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.table,
        Key: keyOf(key),
        ...conditional(opts.ifPresent ? MUST_BE_PRESENT : undefined),
      }));
    } catch (error) {
      throw translate(error);
    }
  }

  async query(pk: string, opts: QueryOptions = {}): Promise<Item[]> {
    if (opts.skPrefix !== undefined && opts.skEquals !== undefined) {
      throw new Error('query takes skPrefix or skEquals, not both');
    }

    const names: Record<string, string> = { '#pk': 'PK' };
    const values: Record<string, unknown> = { ':pk': pk };
    let condition = '#pk = :pk';
    if (opts.skEquals !== undefined) {
      names['#sk'] = 'SK';
      values[':sk'] = opts.skEquals;
      condition += ' AND #sk = :sk';
    } else if (opts.skPrefix) {
      names['#sk'] = 'SK';
      values[':sk'] = opts.skPrefix;
      condition += ' AND begins_with(#sk, :sk)';
    }

    let projection: { ProjectionExpression: string } | Record<string, never> = {};
    if (opts.attributes) {
      opts.attributes.forEach((name, index) => { names[`#p${index}`] = name; });
      projection = { ProjectionExpression: opts.attributes.map((_, index) => `#p${index}`).join(', ') };
    }

    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ...projection,
        ExclusiveStartKey: startKey,
      }));
      items.push(...((result.Items ?? []) as Item[]));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  async transact(ops: TxOp[]): Promise<void> {
    if (ops.length === 0) return;
    try {
      await this.client.send(new TransactWriteCommand({
        TransactItems: ops.map(op => ('put' in op
          ? { Put: { TableName: this.table, Item: op.put, ...conditional(op.ifAbsent ? MUST_BE_ABSENT : undefined) } }
          : { Delete: { TableName: this.table, Key: keyOf(op.delete), ...conditional(op.ifPresent ? MUST_BE_PRESENT : undefined) } })),
      }));
    } catch (error) {
      throw translateTransaction(error);
    }
  }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `yarn vitest run src/store/__tests__/dynamo.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the DynamoDB Local contract run**

Create `src/store/__tests__/dynamo.contract.test.ts`:

```ts
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoStore } from '../dynamo';
import { runStoreContract } from './contract';

const endpoint = process.env.DYNAMODB_ENDPOINT;
const table = `store-contract-${crypto.randomUUID()}`;
const raw = new DynamoDBClient({
  endpoint,
  region: 'eu-west-2',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

runStoreContract('DynamoStore (DynamoDB Local)', {
  create: async () => {
    await raw.send(new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
    }));
    const client = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    return new DynamoStore(client, table);
  },
  destroy: async () => { await raw.send(new DeleteTableCommand({ TableName: table })); },
}, { skip: !endpoint });
```

- [ ] **Step 6: Run the contract suite against DynamoDB Local**

Run (needs Docker; if Docker is unavailable locally, skip to Step 7 and let CI be the first real run):

```bash
docker run --rm -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
DYNAMODB_ENDPOINT=http://localhost:8000 yarn vitest run src/store
docker stop ddb-local
```

Expected: PASS, with the DynamoStore suite running (not skipped). If the "reports the index" transact tests fail only because DynamoDB Local omits `CancellationReasons`, change those two tests in `contract.ts` to run only when `backend.name !== 'DynamoDB Local'`-style gating by adding an optional `skipTests?: string[]` to `ContractBackend` and skipping them for Dynamo; `dynamo.test.ts` already pins that mapping with a mocked client. Any other failure is a real parity bug in `DynamoStore`.

- [ ] **Step 7: Add the CI service container**

Resolve the image digest to pin (the repo pins third-party references by SHA):

```bash
docker pull amazon/dynamodb-local:latest
docker inspect --format='{{index .RepoDigests 0}}' amazon/dynamodb-local:latest
```

In `.github/workflows/yarnBuild.yml`, add a `services` block to the `build_package` job directly after `runs-on: ubuntu-latest`, using the digest printed above:

```yaml
    services:
      dynamodb-local:
        image: amazon/dynamodb-local@sha256:<digest printed by the command above>
        ports:
          - 8000:8000
```

and give the `Run tests` step an env:

```yaml
    - name: Run tests
      env:
        DYNAMODB_ENDPOINT: http://localhost:8000
      run: yarn test
```

- [ ] **Step 8: Commit**

```bash
git add src/store/dynamo.ts src/store/__tests__/dynamo.test.ts src/store/__tests__/dynamo.contract.test.ts .github/workflows/yarnBuild.yml
git commit -m "feat: add DynamoStore and run the contract suite in CI" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `initStore`, the test helper and entry-point wiring

**Files:**
- Modify: `src/store/index.ts`, `api-handler.ts`, `src/push/scheduler.ts`, `src/api/__tests__/apiHandler.test.ts`
- Create: `src/store/testing.ts`, `src/store/__tests__/init.test.ts`

**Interfaces:**
- Consumes: `DynamoStore.fromEnv`, `SqliteStore`.
- Produces: `initStore(env?: NodeJS.ProcessEnv): Promise<Store>`; from `testing.ts`: `useTestStore(): SqliteStore` (creates an in-memory store and installs it), `resetTestStore(): void`, `seedUser(store: Store, userId: string, items: Array<{ SK: string } & Record<string, unknown>>): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/init.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getStore, initStore, setStore } from '..';
import { DynamoStore } from '../dynamo';
import { SqliteStore } from '../sqlite';

afterEach(() => { setStore(undefined); });

describe('initStore', () => {
  it('builds a DynamoStore by default', async () => {
    const store = await initStore({ DYNAMODB_TABLE: 'budget-data' });
    expect(store).toBeInstanceOf(DynamoStore);
    expect(getStore()).toBe(store);
  });

  it('builds a SqliteStore when STORE=sqlite', async () => {
    const store = await initStore({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(store).toBeInstanceOf(SqliteStore);
  });

  it('requires SQLITE_PATH for the sqlite store', async () => {
    await expect(initStore({ STORE: 'sqlite' })).rejects.toThrow('SQLITE_PATH');
  });

  it('rejects an unknown STORE value', async () => {
    await expect(initStore({ STORE: 'postgres' })).rejects.toThrow('Unknown STORE "postgres"');
  });

  it('returns the same store on repeated and concurrent calls', async () => {
    const env = { STORE: 'sqlite', SQLITE_PATH: ':memory:' };
    const [first, second] = await Promise.all([initStore(env), initStore(env)]);
    expect(second).toBe(first);
    expect(await initStore(env)).toBe(first);
  });

  it('can try again after a failed start', async () => {
    await expect(initStore({ STORE: 'sqlite' })).rejects.toThrow();
    const store = await initStore({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(store).toBeInstanceOf(SqliteStore);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run src/store/__tests__/init.test.ts`
Expected: FAIL ("initStore is not a function" or similar).

- [ ] **Step 3: Implement `initStore` and the test helper**

Replace `src/store/index.ts` with:

```ts
import type { Store } from './types';

export * from './types';

let current: Store | undefined;
let pending: Promise<Store> | undefined;

export function getStore(): Store {
  if (!current) {
    throw new Error('Store not initialised: call initStore() at startup');
  }
  return current;
}

export function setStore(store: Store | undefined): void {
  current = store;
  pending = undefined;
}

async function createStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const kind = env.STORE || 'dynamodb';
  if (kind === 'dynamodb') {
    const { DynamoStore } = await import('./dynamo');
    return DynamoStore.fromEnv(env);
  }
  if (kind === 'sqlite') {
    const path = env.SQLITE_PATH;
    if (!path) {
      throw new Error('SQLITE_PATH is required when STORE=sqlite');
    }
    const { SqliteStore } = await import('./sqlite');
    return new SqliteStore(path);
  }
  throw new Error(`Unknown STORE "${kind}": expected "dynamodb" or "sqlite"`);
}

// Loads only the chosen backend, so the Lambda never needs node:sqlite and a container never needs the AWS SDK.
export function initStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  if (current) return Promise.resolve(current);
  pending ??= createStore(env).then(
    store => {
      current = store;
      return store;
    },
    error => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}
```

Create `src/store/testing.ts`:

```ts
import { setStore } from '.';
import { SqliteStore } from './sqlite';
import type { Store } from './types';

let active: SqliteStore | undefined;

export function useTestStore(): SqliteStore {
  active?.close();
  active = new SqliteStore(':memory:');
  setStore(active);
  return active;
}

export function resetTestStore(): void {
  setStore(undefined);
  active?.close();
  active = undefined;
}

export async function seedUser(
  store: Store,
  userId: string,
  items: Array<{ SK: string } & Record<string, unknown>>,
): Promise<void> {
  for (const item of items) {
    await store.put({ ...item, PK: `USER#${userId}` });
  }
}
```

- [ ] **Step 4: Run to verify the new tests pass**

Run: `yarn vitest run src/store`
Expected: PASS.

- [ ] **Step 5: Wire the entry points**

In `api-handler.ts`, add the import next to the other `./src/...` imports:

```ts
import { initStore } from './src/store';
```

and inside the existing `try` block of `handler`, initialise before dispatching:

```ts
  try {
    await initStore();
    return await router.dispatch(event, auth.userId);
  } catch (error) {
```

In `src/push/scheduler.ts`, add `import { initStore } from '../store';` with the other imports, and at the start of `handler()` after the vapid check:

```ts
  await initStore();
  const summary = await runScheduler({
```

- [ ] **Step 6: Update the API handler test and add a failing-store case**

In `src/api/__tests__/apiHandler.test.ts`, after the existing `vi.mock('../push', …)` line add:

```ts
const { mockInitStore } = vi.hoisted(() => ({ mockInitStore: vi.fn() }));
vi.mock('../../store', () => ({ initStore: mockInitStore }));
```

in the top-level `beforeEach`, after `allowToken();`, add:

```ts
  mockInitStore.mockReset().mockResolvedValue(undefined);
```

and add this test inside `describe('authentication', …)`'s sibling area (any existing top-level `describe` for dispatch errors; if none, add a new `describe('store start-up', …)` at the end of the file):

```ts
describe('store start-up', () => {
  it('answers 500 without leaking detail when the store cannot start, and reaches no handler', async () => {
    mockInitStore.mockRejectedValueOnce(new Error('DYNAMODB_TABLE is required when STORE=dynamodb'));
    const res = await invoke(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' });
    expect(res.body).not.toContain('DYNAMODB_TABLE');
    expect(handlerCalls()).toEqual([]);
  });
});
```

- [ ] **Step 7: Verify, then confirm the Lambda build still compiles**

Run: `yarn vitest run src/store src/api/__tests__/apiHandler.test.ts src/push && yarn typecheck`
Expected: PASS.

Run (the same flags the build scripts use, without emitting):

```bash
yarn tsc api-handler.ts push-handler.ts --noEmit --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop
```

Expected: no output (success).

- [ ] **Step 8: Full suite, then commit and open PR A**

Run: `yarn test`
Expected: PASS (no handler has changed behaviour yet).

```bash
git add src/store api-handler.ts src/push/scheduler.ts src/api/__tests__/apiHandler.test.ts
git commit -m "feat: choose the store at start-up with initStore" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Run the `SECURITY.md` pre-PR checklist, push the branch and open PR A (`gh pr create`), confirming the DynamoDB Local job ran the contract suite (not skipped) in CI. After it merges: `git checkout main && git pull --ff-only`.

---

## PR B: shared helpers and the handlers that use them

Create the branch first: `git checkout -b feat/store-handlers-core`.

### Task 6: `pots.ts`, `potArchive.ts` and `transactionsRange.ts`

**Files:**
- Modify: `src/api/pots.ts`, `src/api/potArchive.ts`
- Test (convert): `src/api/__tests__/pots.test.ts`, `src/api/__tests__/potArchive.test.ts`, `src/api/__tests__/transactionsRange.test.ts`
- `src/api/transactionsRange.ts` needs no source change: it only calls `queryAll` from `pots.ts`.

**Interfaces:**
- Consumes: `getStore` from `../store`.
- Produces: `queryAll(userId: string, prefix: string): Promise<Record<string, unknown>[]>` and `queryOne(userId: string, sk: string): Promise<Record<string, unknown> | undefined>` keep their exact signatures (accounts, trash and others depend on them).

- [ ] **Step 1: Convert the tests first**

Apply the *Test conversion rules* to the three test files. `pots.test.ts` and `transactionsRange.test.ts` mock `QueryCommand` only; `potArchive.test.ts` also keeps its `vi.mock('../trash', …)`. Add these tests (they pin the review-focus items and the new seams) to `pots.test.ts`:

```ts
describe('putPot', () => {
  it('stores settings with archivedAt as a real null, not a missing attribute', async () => {
    await seedUser(store, 'user-1', [{ SK: 'CAT#custom-pot', categoryId: 'custom-pot', name: 'Garden', type: 'POT', icon: 'star', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' }]);
    const month = new Date().toISOString().slice(0, 7);
    const res = await putPot(
      { body: JSON.stringify({ monthlyAmount: 5000, goalAmount: null, autoContribute: false, month }) } as any,
      'user-1',
      { categoryId: 'custom-pot' },
    );
    expect(res.statusCode).toBe(200);
    const stored = await store.get({ PK: 'USER#user-1', SK: 'POT#custom-pot' });
    expect(stored).toMatchObject({ monthlyAmount: 5000, goalAmount: null, archivedAt: null });
  });
});
```

(`putPot` and the event shape come from the existing imports of that test file; reuse its existing `makeEvent` helper if it has one instead of the inline object.)

- [ ] **Step 2: Run the converted tests to see them fail**

Run: `yarn vitest run src/api/__tests__/pots.test.ts src/api/__tests__/potArchive.test.ts src/api/__tests__/transactionsRange.test.ts`
Expected: FAIL (the handlers still call `docClient`; the store is empty).

- [ ] **Step 3: Migrate `pots.ts`**

In `src/api/pots.ts`:

- Replace the first three imports with:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getStore } from '../store';
import { pk, catSk, potSk } from './db';
```

- Replace `queryAll` and `queryOne` with:

```ts
export async function queryAll(userId: string, prefix: string): Promise<Record<string, unknown>[]> {
  return getStore().query(pk(userId), { skPrefix: prefix });
}

export async function queryOne(userId: string, sk: string): Promise<Record<string, unknown> | undefined> {
  return getStore().get({ PK: pk(userId), SK: sk });
}
```

- In `putPot`, replace the `docClient.send(new PutCommand(…))` call with:

```ts
  await getStore().put({ PK: pk(userId), SK: potSk(categoryId), ...settings });
```

- [ ] **Step 4: Migrate `potArchive.ts`**

In `src/api/potArchive.ts`, remove the `PutCommand` import, change the `./db` import to `import { pk, potSk, recurringSk } from './db';`, add `import { getStore } from '../store';`, and replace `savePotSettings` with:

```ts
async function savePotSettings(userId: string, settings: PotSettings): Promise<void> {
  await getStore().put({ PK: pk(userId), SK: potSk(settings.categoryId), ...settings });
}
```

- [ ] **Step 5: Run the targeted tests**

Run: `yarn vitest run src/api/__tests__/pots.test.ts src/api/__tests__/potArchive.test.ts src/api/__tests__/transactionsRange.test.ts src/api/__tests__/potsCalc.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/pots.ts src/api/potArchive.ts src/api/__tests__/pots.test.ts src/api/__tests__/potArchive.test.ts src/api/__tests__/transactionsRange.test.ts
git commit -m "refactor: read and write pots through the Store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `trash.ts`

**Files:**
- Modify: `src/api/trash.ts`
- Test (convert): `src/api/__tests__/trash.test.ts`

**Interfaces:**
- Consumes: `getStore`, `ConditionFailedError` from `../store`; `queryAll` from `./pots` (unchanged signature).
- Produces: `moveToTrash(userId: string, entityType: TrashEntityType, originalSk: string): Promise<void>`, `getTrash`, `restoreFromTrash` keep their signatures.

- [ ] **Step 1: Convert the tests and add the race and expiry tests**

Apply the *Test conversion rules* to `trash.test.ts` (it uses fake timers: keep `vi.useFakeTimers()` and `vi.setSystemTime(NOW)` in its `beforeEach`, and call `useTestStore()` in the same `beforeEach`). The old `cancelled([...])` helper is no longer needed. Add these tests:

```ts
describe('expired entries that have not been purged yet', () => {
  it('hides them from getTrash even though they are still stored', async () => {
    await seedUser(store, 'user-1', [
      trashRecord({ SK: 'TRASH#TRANSACTION#2026-09#live', expiresAt: NOW_SECONDS + 1000 }),
      trashRecord({ SK: 'TRASH#TRANSACTION#2026-09#old', originalSk: 'TXN#2026-09#old', expiresAt: NOW_SECONDS - 1 }),
    ].map(({ PK: _pk, ...rest }) => rest as { SK: string }));
    const res = await getTrash(event(), 'user-1', {});
    const ids = JSON.parse(res.body).items.map((entry: { id: string }) => entry.id);
    expect(ids).toEqual(['2026-09#live']);
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#old' })).toBeDefined();
  });

  it('refuses to restore one', async () => {
    await seedUser(store, 'user-1', [{ ...trashRecord({ expiresAt: NOW_SECONDS - 1 }), PK: undefined } as any]);
    const res = await restoreFromTrash(event({ entityType: 'TRANSACTION', id: '2026-09#t1' }), 'user-1', {});
    expect(res.statusCode).toBe(404);
  });
});

describe('restore races', () => {
  async function seedTrash(): Promise<void> {
    const { PK: _pk, ...record } = trashRecord();
    await seedUser(store, 'user-1', [record as { SK: string }]);
  }

  it('restores once and answers 404 the second time without duplicating anything', async () => {
    await seedTrash();
    const body = { entityType: 'TRANSACTION', id: '2026-09#t1' };
    expect((await restoreFromTrash(event(body), 'user-1', {})).statusCode).toBe(200);
    expect((await restoreFromTrash(event(body), 'user-1', {})).statusCode).toBe(404);
    expect(await store.query('USER#user-1', { skPrefix: 'TXN#' })).toHaveLength(1);
    expect(await store.query('USER#user-1', { skPrefix: 'TRASH#' })).toHaveLength(0);
  });

  it('answers 409 and keeps the trash entry when the item has been re-created', async () => {
    await seedTrash();
    await seedUser(store, 'user-1', [{ SK: 'TXN#2026-09#t1', amount: 999 }]);
    const res = await restoreFromTrash(event({ entityType: 'TRANSACTION', id: '2026-09#t1' }), 'user-1', {});
    expect(res.statusCode).toBe(409);
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' })).toMatchObject({ amount: 999 });
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' })).toBeDefined();
  });
});

describe('moveToTrash', () => {
  it('moves the item into trash with the original key and a 30-day expiry', async () => {
    await seedUser(store, 'user-1', [{ SK: 'TXN#2026-09#t1', ...txn }]);
    await moveToTrash('user-1', 'TRANSACTION', 'TXN#2026-09#t1');
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' })).toBeUndefined();
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TRANSACTION#2026-09#t1' })).toMatchObject({
      entityType: 'TRANSACTION',
      originalSk: 'TXN#2026-09#t1',
      item: txn,
      expiresAt: NOW_SECONDS + THIRTY_DAYS,
    });
  });

  it('does nothing when the item is already gone', async () => {
    await moveToTrash('user-1', 'TRANSACTION', 'TXN#2026-09#missing');
    expect(await store.query('USER#user-1')).toEqual([]);
  });
});
```

Adapt `trashRecord` usage to drop its `PK` field when seeding (as the snippets above do); `seedUser` supplies the partition.

- [ ] **Step 2: Run to see failures**

Run: `yarn vitest run src/api/__tests__/trash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrate `trash.ts`**

In `src/api/trash.ts`:

- Replace the first lines' imports (`GetCommand, TransactWriteCommand` and `docClient, TABLE, pk`) with:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionFailedError, getStore } from '../store';
import { pk } from './db';
```

(keep the existing `queryAll`, `ApiResponse`, `ok, err, parseJsonObject` imports).

- Delete the `cancellationCodes` function.

- Replace `moveToTrash` with:

```ts
export async function moveToTrash(userId: string, entityType: TrashEntityType, originalSk: string): Promise<void> {
  const store = getStore();
  const key = { PK: pk(userId), SK: originalSk };
  const existing = await store.get(key);
  if (!existing) return;

  const id = originalSk.slice(TRASH_ENTITIES[entityType].length);
  const deletedAtMs = Date.now();
  try {
    await store.transact([
      { delete: key, ifPresent: true },
      {
        put: {
          PK: pk(userId),
          SK: trashSk(entityType, id),
          entityType,
          originalSk,
          item: withoutKeys(existing),
          deletedAt: new Date(deletedAtMs).toISOString(),
          expiresAt: Math.floor(deletedAtMs / 1000) + TRASH_RETENTION_SECONDS,
        },
      },
    ]);
  } catch (error) {
    if (error instanceof ConditionFailedError && error.failedIndex === 0) return;
    throw error;
  }
}
```

- In `restoreFromTrash`, replace the lookup and the transaction:

```ts
  const trashKey = { PK: pk(userId), SK: trashSk(entityType, id) };
  const stored = await getStore().get(trashKey);
  const entry = stored ? toTrashEntry(stored) : null;
  if (!entry || !isLive(entry, nowSeconds())) {
    return err(404, 'This item is no longer in Recently deleted');
  }

  const originalSk = `${TRASH_ENTITIES[entityType]}${id}`;
  try {
    await getStore().transact([
      { put: { ...entry.item, PK: pk(userId), SK: originalSk }, ifAbsent: true },
      { delete: trashKey, ifPresent: true },
    ]);
  } catch (error) {
    if (error instanceof ConditionFailedError && error.failedIndex === 0) {
      return err(409, 'This item is already in place, so it was not restored');
    }
    if (error instanceof ConditionFailedError && error.failedIndex === 1) {
      return err(404, 'This item is no longer in Recently deleted');
    }
    throw error;
  }

  return ok({ entityType, id, item: entry.item });
```

- [ ] **Step 4: Run the targeted tests**

Run: `yarn vitest run src/api/__tests__/trash.test.ts src/api/__tests__/potArchive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/trash.ts src/api/__tests__/trash.test.ts
git commit -m "refactor: move trash through Store transactions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `targets.ts`, `transactions.ts` and `accounts.ts`

**Files:**
- Modify: `src/api/targets.ts`, `src/api/transactions.ts`, `src/api/accounts.ts`
- Test (convert): `src/api/__tests__/targets.test.ts`, `src/api/__tests__/transactions.test.ts`, `src/api/__tests__/accounts.test.ts`

**Interfaces:**
- Consumes: `getStore` from `../store`.
- Produces: unchanged handler signatures.

- [ ] **Step 1: Convert the tests and add the optional-attribute test**

Apply the *Test conversion rules* to the three files. In `transactions.test.ts` also add:

```ts
describe('createTransaction without a recurring link', () => {
  it('stores no recurringId attribute at all', async () => {
    const res = await createTransaction(
      makeEvent({ amount: 350, type: 'EXPENSE', categoryId: 'cat-dining', description: 'Coffee', date: '2026-10-02' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(201);
    const [stored] = await store.query('USER#user-1', { skPrefix: 'TXN#2026-10' });
    expect(stored).toBeDefined();
    expect('recurringId' in stored).toBe(false);
  });

  it('moves a transaction to the new month in one step when its date changes month', async () => {
    await seedUser(store, 'user-1', [{ SK: 'TXN#2026-09#t1', transactionId: 't1', yearMonth: '2026-09', amount: 100, type: 'EXPENSE', categoryId: 'cat-dining', description: '', date: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z' }]);
    const res = await updateTransaction(
      makeEvent({ amount: 100, type: 'EXPENSE', categoryId: 'cat-dining', description: '', date: '2026-10-01' }),
      'user-1',
      { yearMonth: '2026-09', transactionId: 't1' },
    );
    expect(res.statusCode).toBe(200);
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-09#t1' })).toBeUndefined();
    expect(await store.get({ PK: 'USER#user-1', SK: 'TXN#2026-10#t1' })).toMatchObject({ yearMonth: '2026-10', createdAt: '2026-09-30T00:00:00.000Z' });
  });
});
```

(`makeEvent` is the existing helper in that test file; if its name differs, use the file's own helper.)

- [ ] **Step 2: Run to see failures**

Run: `yarn vitest run src/api/__tests__/targets.test.ts src/api/__tests__/transactions.test.ts src/api/__tests__/accounts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrate `targets.ts`**

Imports become:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getStore } from '../store';
import { pk, targetSk } from './db';
```

`getTargets` body:

```ts
  const targets = await getStore().query(pk(userId), { skPrefix: 'TARGET#' });
  return ok({ targets });
```

`upsertTarget`'s write:

```ts
  await getStore().put({ PK: pk(userId), SK: targetSk(categoryId), ...target });
```

- [ ] **Step 4: Migrate `transactions.ts`**

Imports become:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getStore } from '../store';
import { pk, txnSk } from './db';
```

`getTransactions` (after computing `yearMonth`):

```ts
  const transactions = await getStore().query(pk(userId), { skPrefix: `TXN#${yearMonth}` });
  return ok({ transactions });
```

`createTransaction`'s write:

```ts
  await getStore().put({ PK: pk(userId), SK: txnSk(yearMonth, transactionId), ...transaction });
```

`updateTransaction`'s lookup and writes:

```ts
  const store = getStore();
  const existing = (await store.get({ PK: pk(userId), SK: txnSk(yearMonth, transactionId) })) as unknown as Transaction | undefined;
  if (!existing) {
    return err(404, 'Transaction not found');
  }
```

and the write section:

```ts
  if (newYearMonth === yearMonth) {
    await store.put({ PK: pk(userId), SK: txnSk(yearMonth, transactionId), ...transaction });
  } else {
    await store.transact([
      { delete: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) } },
      { put: { PK: pk(userId), SK: txnSk(newYearMonth, transactionId), ...transaction } },
    ]);
  }
```

- [ ] **Step 5: Migrate `accounts.ts`**

Imports: remove `PutCommand` and `docClient, TABLE`; add `import { getStore } from '../store';`; `./db` import becomes `import { pk, accountSk } from './db';`. In `createAccount`, `updateAccount` and `addBalance`, each `docClient.send(new PutCommand({ TableName: TABLE, Item: { PK: pk(userId), SK: accountSk(<id>), ...account } }))` becomes:

```ts
  await getStore().put({ PK: pk(userId), SK: accountSk(accountId), ...account });
```

(`createAccount` uses the local `accountId`; the other two use `accountId` from `params`.)

- [ ] **Step 6: Run the targeted tests**

Run: `yarn vitest run src/api/__tests__/targets.test.ts src/api/__tests__/transactions.test.ts src/api/__tests__/accounts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/targets.ts src/api/transactions.ts src/api/accounts.ts src/api/__tests__/targets.test.ts src/api/__tests__/transactions.test.ts src/api/__tests__/accounts.test.ts
git commit -m "refactor: read and write targets, transactions and accounts via Store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `recurring.ts`

**Files:**
- Modify: `src/api/recurring.ts`
- Test (convert): `src/api/__tests__/recurring.test.ts`

**Interfaces:**
- Consumes: `getStore`, `ConditionFailedError` from `../store`.
- Produces: unchanged handler signatures; `toRecurring` unchanged.

- [ ] **Step 1: Convert the tests and add the null test**

Apply the *Test conversion rules* to `recurring.test.ts` (it has the most `mockSend` uses; the update tests become "seed the item, call the handler, read it back"; the "item not found → 404" tests become "do not seed"). Add:

```ts
describe('updateRecurring on a monthly bill', () => {
  it('stores anchorDate as null and keeps createdAt', async () => {
    await seedUser(store, 'user-1', [{
      SK: 'RECUR#r1', recurringId: 'r1', type: 'EXPENSE', categoryId: 'cat-rent', amount: 1000, description: 'Rent',
      dayOfMonth: 1, frequency: 'MONTHLY', anchorDate: null, leadDays: 3, handledPeriod: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
    const res = await updateRecurring(
      makeEvent({ type: 'EXPENSE', categoryId: 'cat-rent', amount: 1200, description: 'Rent', dayOfMonth: 2, frequency: 'MONTHLY' }),
      'user-1',
      { recurringId: 'r1' },
    );
    expect(res.statusCode).toBe(200);
    expect(await store.get({ PK: 'USER#user-1', SK: 'RECUR#r1' })).toMatchObject({
      amount: 1200, dayOfMonth: 2, anchorDate: null, createdAt: '2026-01-01T00:00:00.000Z', handledPeriod: null,
    });
  });

  it('answers 404 and creates nothing for an unknown id', async () => {
    const res = await updateRecurring(
      makeEvent({ type: 'EXPENSE', categoryId: 'cat-rent', amount: 1200, dayOfMonth: 2, frequency: 'MONTHLY' }),
      'user-1',
      { recurringId: 'nope' },
    );
    expect(res.statusCode).toBe(404);
    expect(await store.query('USER#user-1')).toEqual([]);
  });
});
```

(Use the file's existing event helper name in place of `makeEvent` if it differs.)

- [ ] **Step 2: Run to see failures**

Run: `yarn vitest run src/api/__tests__/recurring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrate `recurring.ts`**

- Imports: remove `QueryCommand, PutCommand, UpdateCommand` and the `docClient, TABLE` names; they become:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionFailedError, getStore } from '../store';
import { pk, recurringSk } from './db';
```

- Delete the `isConditionalFailure` function.

- `getRecurring`:

```ts
  const items = await getStore().query(pk(userId), { skPrefix: 'RECUR#' });
  return ok({ recurring: items.map(toRecurring) });
```

- `createRecurring`'s write:

```ts
  await getStore().put({ PK: pk(userId), SK: recurringSk(recurring.recurringId), ...recurring });
```

- `updateRecurring`'s `try` block:

```ts
  try {
    const item = await getStore().patch(
      { PK: pk(userId), SK: recurringSk(recurringId) },
      { type, categoryId, amount, description, dayOfMonth, frequency, anchorDate, leadDays, updatedAt: new Date().toISOString() },
      { mustExist: true },
    );
    return ok({ recurring: toRecurring(item) });
  } catch (error) {
    if (error instanceof ConditionFailedError) return err(404, 'Recurring item not found');
    throw error;
  }
```

- `setRecurringHandled`'s `try` block:

```ts
  try {
    const item = await getStore().patch(
      { PK: pk(userId), SK: recurringSk(recurringId) },
      { handledPeriod: period, updatedAt: new Date().toISOString() },
      { mustExist: true },
    );
    return ok({ recurring: toRecurring(item) });
  } catch (error) {
    if (error instanceof ConditionFailedError) return err(404, 'Recurring item not found');
    throw error;
  }
```

- [ ] **Step 4: Run the whole converted group, then the full suite**

Run: `yarn vitest run src/api && yarn test`
Expected: PASS (the group from Tasks 6 to 9 is now consistent; `categories`, `reassign` and `push` tests still use their own `docClient` mocks and still pass).

- [ ] **Step 5: Commit and open PR B**

```bash
git add src/api/recurring.ts src/api/__tests__/recurring.test.ts
git commit -m "refactor: store recurring items through patch with mustExist" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Run `yarn typecheck`, the `SECURITY.md` pre-PR checklist, push and open PR B. After merge: `git checkout main && git pull --ff-only`.

---

## PR C: categories, reassign, push

Create the branch first: `git checkout -b feat/store-handlers-rest`.

### Task 10: `categories.ts` and `reassign.ts`

**Files:**
- Modify: `src/api/categories.ts`, `src/api/reassign.ts`
- Test (convert): `src/api/__tests__/categories.test.ts`, `src/api/__tests__/reassign.test.ts`

**Interfaces:**
- Consumes: `getStore`, `ConditionFailedError` from `../store`.
- Produces: unchanged handler signatures.

- [ ] **Step 1: Convert the tests and add the rename test**

Apply the *Test conversion rules* to both files. `getCategories` tests that used two sequential `mockResolvedValueOnce` calls (custom categories, then pots) become seeding `CAT#…` and `POT#…` items. In `reassign.test.ts` the four-call expectation (`toHaveBeenCalledTimes(4)`) becomes assertions on the final stored categoryIds. Add:

```ts
describe('updateCategory', () => {
  it('renames in place, keeping the other attributes', async () => {
    await seedUser(store, 'user-1', [{ SK: 'CAT#c1', categoryId: 'c1', name: 'Old', type: 'EXPENSE', icon: 'star', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' }]);
    const res = await updateCategory(makeEvent({ name: 'New' }), 'user-1', { categoryId: 'c1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).category).toMatchObject({ categoryId: 'c1', name: 'New', icon: 'star' });
  });

  it('answers 404 and creates nothing for an unknown category', async () => {
    const res = await updateCategory(makeEvent({ name: 'New' }), 'user-1', { categoryId: 'ghost' });
    expect(res.statusCode).toBe(404);
    expect(await store.query('USER#user-1')).toEqual([]);
  });
});
```

and in `reassign.test.ts`:

```ts
it('skips an item deleted between the read and the update, and counts only the ones it changed', async () => {
  await seedUser(store, 'user-1', [
    { SK: 'TXN#2026-10#a', categoryId: 'old' },
    { SK: 'TXN#2026-10#b', categoryId: 'old' },
    { SK: 'CAT#new', categoryId: 'new', name: 'New', type: 'EXPENSE' },
  ]);
  const realPatch = store.patch.bind(store);
  vi.spyOn(store, 'patch').mockImplementation(async (key, fields, opts) => {
    if (key.SK === 'TXN#2026-10#b') await store.delete(key);
    return realPatch(key, fields, opts);
  });
  const res = await reassignCategory(makeEvent({ toCategoryId: 'new' }), 'user-1', { categoryId: 'old' });
  expect(JSON.parse(res.body)).toEqual({ reassigned: 1, recurringReassigned: 0 });
});
```

- [ ] **Step 2: Run to see failures**

Run: `yarn vitest run src/api/__tests__/categories.test.ts src/api/__tests__/reassign.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrate `categories.ts`**

- Imports: replace the lib-dynamodb and `./db` lines with:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionFailedError, getStore } from '../store';
import { pk, catSk } from './db';
```

(keep the other existing imports) and delete `isConditionalFailure`.

- `getCategories`:

```ts
  const store = getStore();
  const [customItems, potItems] = await Promise.all(
    ['CAT#', 'POT#'].map(prefix => store.query(pk(userId), { skPrefix: prefix })),
  );

  const archivedIds = new Set(
    potItems
      .filter(item => typeof item.archivedAt === 'string')
      .map(item => String(item.categoryId)),
  );
  const custom = customItems.map(toCategory);
```

- `createCategory`'s write:

```ts
  await getStore().put({ PK: pk(userId), SK: catSk(categoryId), ...category });
```

- `deleteCategory`'s write:

```ts
  await getStore().delete({ PK: pk(userId), SK: catSk(categoryId) });
```

- `updateCategory`'s `try`/`catch`:

```ts
  try {
    const item = await getStore().patch(
      { PK: pk(userId), SK: catSk(categoryId) },
      { name: validName.value },
      { mustExist: true },
    );
    return ok({ category: toCategory(item) });
  } catch (error) {
    if (error instanceof ConditionFailedError) return err(404, 'Category not found');
    throw error;
  }
```

- [ ] **Step 4: Migrate `reassign.ts`**

Imports:

```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionFailedError, getStore } from '../store';
import { pk, catSk } from './db';
```

Replace `reassignItems` with:

```ts
async function reassignItems(
  userId: string,
  prefix: string,
  categoryId: string,
  toCategoryId: string,
): Promise<number> {
  const store = getStore();
  const items = await store.query(pk(userId), { skPrefix: prefix });
  const matching = items.filter(item => item.categoryId === categoryId);

  let reassigned = 0;
  for (const batch of chunk(matching, UPDATE_BATCH_SIZE)) {
    const results = await Promise.all(batch.map(async (item) => {
      try {
        await store.patch({ PK: pk(userId), SK: item.SK }, { categoryId: toCategoryId }, { mustExist: true });
        return true;
      } catch (error) {
        if (error instanceof ConditionFailedError) return false;
        throw error;
      }
    }));
    reassigned += results.filter(Boolean).length;
  }

  return reassigned;
}
```

and in `reassignCategory` replace the target lookup with:

```ts
  if (!DEFAULT_CATEGORY_IDS.has(toCategoryId)) {
    const target = await getStore().get({ PK: pk(userId), SK: catSk(toCategoryId) });
    if (!target) {
      return err(400, 'toCategoryId does not exist');
    }
  }
```

- [ ] **Step 5: Run the targeted tests**

Run: `yarn vitest run src/api/__tests__/categories.test.ts src/api/__tests__/reassign.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/categories.ts src/api/reassign.ts src/api/__tests__/categories.test.ts src/api/__tests__/reassign.test.ts
git commit -m "refactor: store categories and reassignment via Store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `push.ts` and `src/push/store.ts`

**Files:**
- Modify: `src/api/push.ts`, `src/push/store.ts`
- Test (convert): `src/api/__tests__/push.test.ts`
- Test (create): `src/push/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `getStore` from `../store` (and `../../store` from tests).
- Produces: unchanged exports of `push.ts`; `src/push/store.ts` keeps `listSubscribedUsers(): Promise<string[]>`, `loadSubscriptions(userId): Promise<StoredSubscription[]>`, `loadReminderData(userId, today): Promise<ReminderData>`, `removeSubscription(userId, sk): Promise<void>`, and the `StoredSubscription` / `ReminderData` types.

- [ ] **Step 1: Convert `push.test.ts` and write the store test**

Apply the *Test conversion rules* to `src/api/__tests__/push.test.ts`. It filters recorded commands by `type` (`Update`, `Put`, `Delete`): replace those with reads from the store. Add:

```ts
describe('createPushSubscription', () => {
  it('keeps the original createdAt when the same device subscribes again', async () => {
    const body = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'AAA', auth: 'BBB' } }, settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'));
    await createPushSubscription(makeEvent(body), 'user-1', {});
    vi.setSystemTime(new Date('2026-10-05T08:00:00.000Z'));
    await createPushSubscription(makeEvent({ ...body, settings: { ...body.settings, hour: 9 } }), 'user-1', {});
    vi.useRealTimers();

    const [stored] = await store.query('USER#user-1', { skPrefix: 'PUSHSUB#' });
    expect(stored).toMatchObject({ hour: 9, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-05T08:00:00.000Z', quietStart: null });
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeDefined();
  });

  it('drops the user from the scheduler index once their last device unsubscribes', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    await createPushSubscription(makeEvent({ subscription: { endpoint, keys: { p256dh: 'AAA', auth: 'BBB' } }, settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }), 'user-1', {});
    const res = await deletePushSubscription(makeEvent({ endpoint }), 'user-1', {});
    expect(res.statusCode).toBe(204);
    expect(await store.query('USER#user-1', { skPrefix: 'PUSHSUB#' })).toEqual([]);
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeUndefined();
  });
});
```

(Use the file's existing event helper name in place of `makeEvent` if it differs.)

Create `src/push/__tests__/store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';
import { listSubscribedUsers, loadReminderData, loadSubscriptions, removeSubscription } from '../store';

let store: SqliteStore;
beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

const subscription = (sk: string, over: Record<string, unknown> = {}) => ({
  SK: sk, endpoint: `https://fcm.googleapis.com/${sk}`, p256dh: 'p', auth: 'a', hour: 8,
  quietStart: null, quietEnd: null, timeZone: 'Europe/London', ...over,
});

describe('listSubscribedUsers', () => {
  it('reads the user ids from the index partition', async () => {
    await store.put({ PK: 'PUSHIDX', SK: 'USER#alice', updatedAt: 'x' });
    await store.put({ PK: 'PUSHIDX', SK: 'USER#bob', updatedAt: 'x' });
    expect(await listSubscribedUsers()).toEqual(['alice', 'bob']);
  });
});

describe('loadSubscriptions', () => {
  it('returns null quiet hours as null and the other settings as numbers and text', async () => {
    await seedUser(store, 'u1', [subscription('PUSHSUB#one'), subscription('PUSHSUB#two', { quietStart: 22, quietEnd: 7 })]);
    const loaded = await loadSubscriptions('u1');
    expect(loaded.map(entry => entry.settings)).toEqual([
      { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' },
      { hour: 8, quietStart: 22, quietEnd: 7, timeZone: 'Europe/London' },
    ]);
    expect(loaded[0]).toMatchObject({ sk: 'PUSHSUB#one', p256dh: 'p', auth: 'a' });
  });

  it('ignores other users and other entity types', async () => {
    await seedUser(store, 'u1', [subscription('PUSHSUB#one'), { SK: 'CAT#a', categoryId: 'a' }]);
    await seedUser(store, 'u2', [subscription('PUSHSUB#other')]);
    expect(await loadSubscriptions('u1')).toHaveLength(1);
  });
});

describe('loadReminderData', () => {
  it('loads bills, category ids and transactions from three months back to the month ahead', async () => {
    await seedUser(store, 'u1', [
      { SK: 'RECUR#r1', recurringId: 'r1', type: 'EXPENSE', categoryId: 'cat-rent', amount: 1, dayOfMonth: 1, createdAt: 'x', updatedAt: 'x' },
      { SK: 'CAT#c1', categoryId: 'c1', name: 'Garden' },
      { SK: 'TXN#2026-07#a', transactionId: 'a' },
      { SK: 'TXN#2026-06#old', transactionId: 'old' },
      { SK: 'TXN#2026-11#next', transactionId: 'next' },
      { SK: 'TXN#2026-12#too-far', transactionId: 'far' },
    ]);
    const data = await loadReminderData('u1', '2026-10-05');
    expect(data.recurring.map(entry => entry.recurringId)).toEqual(['r1']);
    expect(data.categories).toEqual([{ categoryId: 'c1' }]);
    expect(data.transactions.map(entry => entry.transactionId).sort()).toEqual(['a', 'next']);
  });
});

describe('removeSubscription', () => {
  it('keeps the index while another device remains and drops it with the last one', async () => {
    await seedUser(store, 'u1', [subscription('PUSHSUB#one'), subscription('PUSHSUB#two')]);
    await store.put({ PK: 'PUSHIDX', SK: 'USER#u1', updatedAt: 'x' });

    await removeSubscription('u1', 'PUSHSUB#one');
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#u1' })).toBeDefined();

    await removeSubscription('u1', 'PUSHSUB#two');
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#u1' })).toBeUndefined();
  });
});
```

(`LOOK_BACK_MONTHS` in `app/lib/recurring` decides the window; the expectation above assumes 3 months back as the file's comment states. If the constant differs, adjust the seeded months, not the code.)

- [ ] **Step 2: Run to see failures**

Run: `yarn vitest run src/api/__tests__/push.test.ts src/push/__tests__/store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrate `src/api/push.ts`**

Imports: replace the lib-dynamodb and `./db` lines with:

```ts
import { createHash } from 'crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getStore } from '../store';
import { pk, PUSH_INDEX_PK, pushIndexSk, pushSubscriptionSk } from './db';
```

`subscriptionKeys`:

```ts
async function subscriptionKeys(userId: string): Promise<string[]> {
  const items = await getStore().query(pk(userId), { skPrefix: 'PUSHSUB#', attributes: ['SK'] });
  return items.map(item => item.SK);
}
```

`createPushSubscription`'s two writes:

```ts
  const now = new Date().toISOString();
  const store = getStore();
  await store.patch(
    { PK: pk(userId), SK: sk },
    {
      endpoint: record.endpoint,
      p256dh: record.p256dh,
      auth: record.auth,
      hour: record.hour,
      quietStart: record.quietStart,
      quietEnd: record.quietEnd,
      timeZone: record.timeZone,
      updatedAt: now,
    },
    { defaults: { createdAt: now } },
  );
  await store.put({ PK: PUSH_INDEX_PK, SK: pushIndexSk(userId), updatedAt: now });
```

`deletePushSubscription`'s deletes:

```ts
  const store = getStore();
  await store.delete({ PK: pk(userId), SK: pushSubscriptionSk(endpointHash(body.endpoint)) });

  // With no device left, the user drops out of the scheduler's index.
  const remaining = await subscriptionKeys(userId);
  if (remaining.length === 0) {
    await store.delete({ PK: PUSH_INDEX_PK, SK: pushIndexSk(userId) });
  }
```

- [ ] **Step 4: Migrate `src/push/store.ts`**

Replace the file's contents with:

```ts
import { shiftMonth } from '../../app/lib/months';
import { LOOK_BACK_MONTHS } from '../../app/lib/recurring';
import type { Category, Recurring, Transaction } from '../../app/lib/types';
import { PUSH_INDEX_PK, pk } from '../api/db';
import { toRecurring } from '../api/recurring';
import { getStore } from '../store';
import type { DeliverySettings } from './select';

export interface StoredSubscription {
  sk: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  settings: DeliverySettings;
}

export interface ReminderData {
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
}

// Everyone who has turned reminders on, found with one query on the index partition.
export async function listSubscribedUsers(): Promise<string[]> {
  const items = await getStore().query(PUSH_INDEX_PK, { attributes: ['SK'] });
  return items.map(item => String(item.SK).replace(/^USER#/, ''));
}

export async function loadSubscriptions(userId: string): Promise<StoredSubscription[]> {
  const items = await getStore().query(pk(userId), { skPrefix: 'PUSHSUB#' });
  return items.map(item => ({
    sk: String(item.SK),
    endpoint: String(item.endpoint),
    p256dh: String(item.p256dh),
    auth: String(item.auth),
    settings: {
      hour: Number(item.hour),
      quietStart: item.quietStart === null || item.quietStart === undefined ? null : Number(item.quietStart),
      quietEnd: item.quietEnd === null || item.quietEnd === undefined ? null : Number(item.quietEnd),
      timeZone: String(item.timeZone),
    },
  }));
}

// What the app's own due list needs: bills, the categories they belong to, and recent entries
// (three months back and the month ahead), so a bill already logged is not asked about again.
export async function loadReminderData(userId: string, today: string): Promise<ReminderData> {
  const store = getStore();
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: LOOK_BACK_MONTHS + 2 }, (_, index) => shiftMonth(thisMonth, index - LOOK_BACK_MONTHS));

  const [recurring, categories, ...perMonth] = await Promise.all([
    store.query(pk(userId), { skPrefix: 'RECUR#' }),
    store.query(pk(userId), { skPrefix: 'CAT#', attributes: ['categoryId'] }),
    ...months.map(month => store.query(pk(userId), { skPrefix: `TXN#${month}#` })),
  ]);

  return {
    recurring: recurring.map(toRecurring),
    categories: categories.map(item => ({ categoryId: String(item.categoryId) }) as Category),
    transactions: perMonth.flat() as unknown as Transaction[],
  };
}

// Drops a subscription the push service says is gone, and the user from the index once none is left.
export async function removeSubscription(userId: string, sk: string): Promise<void> {
  const store = getStore();
  await store.delete({ PK: pk(userId), SK: sk });
  const remaining = await store.query(pk(userId), { skPrefix: 'PUSHSUB#', attributes: ['SK'] });
  if (remaining.length === 0) {
    await store.delete({ PK: PUSH_INDEX_PK, SK: `USER#${userId}` });
  }
}
```

Note: `pushIndexSk(userId)` returns `USER#${userId}`; if you prefer to keep the helper, import `pushIndexSk` from `../api/db` and use `{ PK: PUSH_INDEX_PK, SK: pushIndexSk(userId) }` instead of the literal.

- [ ] **Step 5: Run the targeted tests and the full suite**

Run: `yarn vitest run src/api/__tests__/push.test.ts src/push && yarn test`
Expected: PASS.

- [ ] **Step 6: Commit and open PR C**

```bash
git add src/api/push.ts src/push/store.ts src/api/__tests__/push.test.ts src/push/__tests__/store.test.ts
git commit -m "refactor: store push subscriptions and reminder data via Store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Run `yarn typecheck`, the `SECURITY.md` pre-PR checklist, push and open PR C. After merge: `git checkout main && git pull --ff-only`.

---

## PR D: cleanup and export/import

Create the branch first: `git checkout -b feat/store-cleanup-transfer`.

### Task 12: Remove `docClient` and verify nothing else changed

**Files:**
- Modify: `src/api/db.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `src/api/db.ts` exports only the key helpers (`pk`, `catSk`, `txnSk`, `targetSk`, `recurringSk`, `potSk`, `accountSk`, `PUSH_INDEX_PK`, `pushSubscriptionSk`, `pushIndexSk`).

- [ ] **Step 1: Prove the AWS SDK is now confined**

Run:

```bash
grep -rn "@aws-sdk\|docClient\|TABLE\b" src api-handler.ts push-handler.ts --include='*.ts' | grep -v "src/store/"
```

Expected: only `src/api/db.ts` lines (the client, `docClient` and `TABLE`) and, in `src/push/vapid.ts`, its `@aws-sdk/client-ssm` use. Anything else is a handler that was missed: migrate it before continuing.

- [ ] **Step 2: Remove the client from `db.ts`**

Replace the first six lines of `src/api/db.ts` (the two AWS imports, the `client`, `docClient` and `TABLE` declarations) so the file begins directly with:

```ts
export const pk = (userId: string): string => `USER#${userId}`;
```

keeping every other export unchanged.

- [ ] **Step 3: Verify no leftover mocks and the full pipeline**

Run:

```bash
grep -rn "mockSend\|lib-dynamodb" src --include='*.ts' | grep -v "src/store/"
yarn typecheck && yarn test
yarn tsc api-handler.ts push-handler.ts --noEmit --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop
git diff --stat main -- infra
```

Expected: the grep prints nothing; typecheck and tests pass; the `tsc` command prints nothing; the `infra` diff is empty (INFRA-01: no new IAM permission).

- [ ] **Step 4: Commit**

```bash
git add src/api/db.ts
git commit -m "refactor: drop the DynamoDB client from db.ts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Per-user export and import

**Files:**
- Create: `src/store/transfer.ts`, `src/store/cli.ts`, `store-cli.ts`, `scripts/build-store-cli.cjs`, `src/store/__tests__/transfer.test.ts`, `src/store/__tests__/cli.test.ts`
- Modify: `package.json` (scripts), `.gitignore`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `Store`, `Item` from `./types`; `initStore` from `.`; `pk` from `../api/db`.
- Produces: `exportUser(store: Store, userId: string): Promise<Item[]>`; `toJsonl(items: Item[]): string`; `parseJsonl(text: string): Item[]`; `importUser(store: Store, items: Item[], options: { asUser: string; replace?: boolean }): Promise<number>`; `runCli(argv: string[], env?: NodeJS.ProcessEnv): Promise<string>`.

- [ ] **Step 1: Write the failing transfer tests**

Create `src/store/__tests__/transfer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SqliteStore } from '../sqlite';
import { exportUser, importUser, parseJsonl, toJsonl } from '../transfer';

const seed = async (store: SqliteStore): Promise<void> => {
  await store.put({ PK: 'USER#auth0|abc', SK: 'CAT#c1', name: 'Garden', archivedAt: null });
  await store.put({ PK: 'USER#auth0|abc', SK: 'TXN#2026-10#t1', amount: 350 });
  await store.put({ PK: 'USER#auth0|abc', SK: 'TRASH#TARGET#c1', expiresAt: 4102444800 });
  await store.put({ PK: 'USER#auth0|abc', SK: 'PUSHSUB#hash', endpoint: 'https://fcm.googleapis.com/x' });
  await store.put({ PK: 'PUSHIDX', SK: 'USER#auth0|abc', updatedAt: 'x' });
  await store.put({ PK: 'USER#someone-else', SK: 'CAT#other', name: 'Other' });
};

describe('exportUser', () => {
  it('exports one partition, keeping trash and leaving out push subscriptions', async () => {
    const store = new SqliteStore(':memory:');
    await seed(store);
    const items = await exportUser(store, 'auth0|abc');
    expect(items.map(item => item.SK)).toEqual(['CAT#c1', 'TRASH#TARGET#c1', 'TXN#2026-10#t1']);
  });
});

describe('JSONL', () => {
  it('round-trips items, including null and expiry', async () => {
    const store = new SqliteStore(':memory:');
    await seed(store);
    const items = await exportUser(store, 'auth0|abc');
    expect(parseJsonl(toJsonl(items))).toEqual(items);
  });

  it('names the line of a malformed record', () => {
    expect(() => parseJsonl('{"PK":"USER#a","SK":"x"}\nnot json\n')).toThrow('Line 2 is not valid JSON');
    expect(() => parseJsonl('{"PK":"USER#a"}\n')).toThrow('Line 1 is missing PK or SK');
    expect(() => parseJsonl('[1]\n')).toThrow('Line 1 is not an object');
  });

  it('ignores blank lines', () => {
    expect(parseJsonl('\n{"PK":"USER#a","SK":"x"}\n\n')).toHaveLength(1);
  });
});

describe('importUser', () => {
  it('moves the data to the new user id, including between backends', async () => {
    const source = new SqliteStore(':memory:');
    await seed(source);
    const target = new SqliteStore(':memory:');

    const count = await importUser(target, await exportUser(source, 'auth0|abc'), { asUser: 'local-1' });

    expect(count).toBe(3);
    const copied = await target.query('USER#local-1');
    expect(copied.map(item => item.SK)).toEqual(['CAT#c1', 'TRASH#TARGET#c1', 'TXN#2026-10#t1']);
    expect(copied[0]).toEqual({ PK: 'USER#local-1', SK: 'CAT#c1', name: 'Garden', archivedAt: null });
    expect(copied[1]).toMatchObject({ expiresAt: 4102444800 });
    expect(await target.query('USER#auth0|abc')).toEqual([]);
  });

  it('refuses to write into a user that already has data', async () => {
    const target = new SqliteStore(':memory:');
    await target.put({ PK: 'USER#local-1', SK: 'CAT#existing', name: 'Keep me' });
    await expect(importUser(target, [{ PK: 'USER#a', SK: 'CAT#x' }], { asUser: 'local-1' }))
      .rejects.toThrow('already has data');
    expect(await target.get({ PK: 'USER#local-1', SK: 'CAT#existing' })).toBeDefined();
  });

  it('replaces the existing data when asked', async () => {
    const target = new SqliteStore(':memory:');
    await target.put({ PK: 'USER#local-1', SK: 'CAT#old', name: 'Old' });
    await importUser(target, [{ PK: 'USER#a', SK: 'CAT#new', name: 'New' }], { asUser: 'local-1', replace: true });
    expect((await target.query('USER#local-1')).map(item => item.SK)).toEqual(['CAT#new']);
  });

  it('rejects a file with more than one partition or a non-user partition', async () => {
    const target = new SqliteStore(':memory:');
    await expect(importUser(target, [{ PK: 'USER#a', SK: 'x' }, { PK: 'USER#b', SK: 'y' }], { asUser: 'z' }))
      .rejects.toThrow('more than one user');
    await expect(importUser(target, [{ PK: 'PUSHIDX', SK: 'USER#a' }], { asUser: 'z' }))
      .rejects.toThrow('USER#');
  });

  it('skips push subscriptions if a hand-edited file contains them', async () => {
    const target = new SqliteStore(':memory:');
    const count = await importUser(
      target,
      [{ PK: 'USER#a', SK: 'CAT#x' }, { PK: 'USER#a', SK: 'PUSHSUB#h', endpoint: 'e' }],
      { asUser: 'z' },
    );
    expect(count).toBe(1);
    expect(await target.query('USER#z', { skPrefix: 'PUSHSUB#' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `yarn vitest run src/store/__tests__/transfer.test.ts`
Expected: FAIL with "Failed to resolve import '../transfer'".

- [ ] **Step 3: Write `transfer.ts`**

Create `src/store/transfer.ts`:

```ts
import { pk } from '../api/db';
import type { Item, Store } from './types';

// Push subscriptions are bound to the old host's VAPID keys, so they are never moved.
const PUSH_SUBSCRIPTION_PREFIX = 'PUSHSUB#';

export interface ImportOptions {
  asUser: string;
  replace?: boolean;
}

function isTransferable(item: Item): boolean {
  return !item.SK.startsWith(PUSH_SUBSCRIPTION_PREFIX);
}

export async function exportUser(store: Store, userId: string): Promise<Item[]> {
  const items = await store.query(pk(userId));
  return items.filter(isTransferable);
}

export function toJsonl(items: Item[]): string {
  return items.map(item => `${JSON.stringify(item)}\n`).join('');
}

export function parseJsonl(text: string): Item[] {
  const items: Item[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const lineNumber = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Line ${lineNumber} is not valid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Line ${lineNumber} is not an object`);
    }
    const { PK, SK } = parsed as Record<string, unknown>;
    if (typeof PK !== 'string' || typeof SK !== 'string') {
      throw new Error(`Line ${lineNumber} is missing PK or SK`);
    }
    items.push(parsed as Item);
  });
  return items;
}

export async function importUser(store: Store, items: Item[], options: ImportOptions): Promise<number> {
  if (new Set(items.map(item => item.PK)).size > 1) {
    throw new Error('The file holds more than one user partition');
  }
  if (items.some(item => !item.PK.startsWith('USER#'))) {
    throw new Error('Only USER# partitions can be imported');
  }

  const target = pk(options.asUser);
  const existing = await store.query(target, { attributes: ['SK'] });
  if (existing.length > 0 && !options.replace) {
    throw new Error(`User "${options.asUser}" already has data; pass --replace to overwrite it`);
  }

  for (const item of existing) {
    await store.delete({ PK: target, SK: item.SK });
  }
  const transferable = items.filter(isTransferable);
  for (const item of transferable) {
    await store.put({ ...item, PK: target });
  }
  return transferable.length;
}
```

- [ ] **Step 4: Run to verify the transfer tests pass**

Run: `yarn vitest run src/store/__tests__/transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing CLI tests**

Create `src/store/__tests__/cli.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setStore } from '..';
import { runCli } from '../cli';
import { SqliteStore } from '../sqlite';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'store-cli-'));
  env = { STORE: 'sqlite', SQLITE_PATH: join(dir, 'budget.sqlite') };
});

afterEach(() => {
  setStore(undefined);
  rmSync(dir, { recursive: true, force: true });
});

async function seedDatabase(): Promise<void> {
  const store = new SqliteStore(env.SQLITE_PATH as string);
  await store.put({ PK: 'USER#auth0|abc', SK: 'CAT#c1', name: 'Garden' });
  store.close();
}

describe('runCli', () => {
  it('exports to an owner-only file and refuses to overwrite it', async () => {
    await seedDatabase();
    const out = join(dir, 'budget-export.jsonl');

    const message = await runCli(['export', 'auth0|abc', '--out', out], env);

    expect(message).toContain('Exported 1 items');
    expect(readFileSync(out, 'utf8')).toContain('"CAT#c1"');
    expect(statSync(out).mode & 0o077).toBe(0);
    setStore(undefined);
    await expect(runCli(['export', 'auth0|abc', '--out', out], env)).rejects.toThrow(/EEXIST/);
  });

  it('imports a file under a new user id', async () => {
    const input = join(dir, 'in.jsonl');
    writeFileSync(input, '{"PK":"USER#auth0|abc","SK":"CAT#c1","name":"Garden"}\n');

    const message = await runCli(['import', '--in', input, '--as-user', 'local-1'], env);

    expect(message).toContain('Imported 1 items');
    setStore(undefined);
    const store = new SqliteStore(env.SQLITE_PATH as string);
    expect(await store.get({ PK: 'USER#local-1', SK: 'CAT#c1' })).toMatchObject({ name: 'Garden' });
  });

  it('prints usage for a missing argument, an unknown command and --help', async () => {
    await expect(runCli(['export'], env)).rejects.toThrow('Usage');
    await expect(runCli(['frobnicate'], env)).rejects.toThrow('Usage');
    expect(await runCli(['--help'], env)).toContain('Usage');
  });

  it('does not touch the file system when the output path is missing', async () => {
    await expect(runCli(['export', 'someone'], env)).rejects.toThrow('Usage');
    expect(existsSync(join(dir, 'budget-export.jsonl'))).toBe(false);
  });
});
```

- [ ] **Step 6: Run to see failure**

Run: `yarn vitest run src/store/__tests__/cli.test.ts`
Expected: FAIL with "Failed to resolve import '../cli'".

- [ ] **Step 7: Write the CLI**

Create `src/store/cli.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { initStore } from '.';
import { exportUser, importUser, parseJsonl, toJsonl } from './transfer';

const USAGE = `Usage:
  export <userId> --out <file>             write one user's data as JSONL (owner-only file, never overwritten)
  import --in <file> --as-user <userId> [--replace]
                                           load a JSONL file under a user id; refuses a user that has data unless --replace

The backend comes from the environment: STORE=dynamodb with DYNAMODB_TABLE (and your AWS credentials),
or STORE=sqlite with SQLITE_PATH. The export holds financial data: keep it private and never commit it.`;

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      in: { type: 'string' },
      'as-user': { type: 'string' },
      replace: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) return USAGE;

  const [command, userId] = positionals;
  if (command === 'export') {
    if (!userId || !values.out) throw new Error(USAGE);
    const store = await initStore(env);
    const items = await exportUser(store, userId);
    writeFileSync(values.out, toJsonl(items), { mode: 0o600, flag: 'wx' });
    return `Exported ${items.length} items for ${userId} to ${values.out}`;
  }

  if (command === 'import') {
    const asUser = values['as-user'];
    if (!values.in || !asUser) throw new Error(USAGE);
    const items = parseJsonl(readFileSync(values.in, 'utf8'));
    const store = await initStore(env);
    const count = await importUser(store, items, { asUser, replace: values.replace });
    return `Imported ${count} items as ${asUser}`;
  }

  throw new Error(USAGE);
}
```

Create `store-cli.ts` at the repo root:

```ts
import { runCli } from './src/store/cli';

runCli(process.argv.slice(2))
  .then(message => { console.log(message); })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
```

Create `scripts/build-store-cli.cjs`:

```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Compiles the export/import command, the same way build-push-handler.cjs compiles the scheduler.
const outDir = path.join(__dirname, '../build/store-cli');
fs.mkdirSync(outDir, { recursive: true });

console.log('Compiling store CLI...');
execSync(
  'tsc store-cli.ts --outDir build/store-cli --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop',
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
);
console.log('✓ Store CLI compiled to build/store-cli/store-cli.js');
```

- [ ] **Step 8: Run the CLI tests**

Run: `yarn vitest run src/store`
Expected: PASS.

- [ ] **Step 9: Add the script, ignore rules and a real end-to-end check**

In `package.json` `scripts`, add after `"test:watch"`:

```json
    "store-cli": "node scripts/build-store-cli.cjs && node build/store-cli/store-cli.js"
```

(Add the comma on the preceding line as needed.)

Append to `.gitignore`:

```
# Exports and local databases hold personal financial data (SEC-01)
budget-export*.jsonl
*.sqlite
*.sqlite-shm
*.sqlite-wal
```

Run the compiled command end to end against a scratch database:

```bash
S=/private/tmp/claude-501/-Users-samuelchapman-Projects-budget-app-v3-ai-edition/c75665a9-43b8-4a7b-a280-b9645a8bd793/scratchpad
printf '{"PK":"USER#auth0|abc","SK":"CAT#c1","name":"Garden"}\n' > $S/in.jsonl
STORE=sqlite SQLITE_PATH=$S/e2e.sqlite yarn -s store-cli import --in $S/in.jsonl --as-user local-1
STORE=sqlite SQLITE_PATH=$S/e2e.sqlite yarn -s store-cli export local-1 --out $S/out.jsonl
cat $S/out.jsonl
git status --short
```

Expected: "Imported 1 items as local-1", "Exported 1 items for local-1 …", the output file shows `{"name":"Garden","PK":"USER#local-1","SK":"CAT#c1"}`, and `git status` shows only the intended source changes (no `build/`, `.sqlite` or `.jsonl` files).

- [ ] **Step 10: Update the roadmap**

In `docs/ROADMAP.md`, change the Storage Interface row's status from "Spec written: …" to the merged state once the four PRs are open, listing them: run `gh pr list --state all --search "store" --json number,title,url` and write `Merged: [PR A](url), [PR B](url), [PR C](url), [PR D](url). Spec: …, plan: `superpowers/plans/2026-10-06-storage-interface.md``. If a PR is not merged yet, say "Implemented on `<branch>` ([PR #n](url))" for it instead.

- [ ] **Step 11: Full verification, commit and open PR D**

Run: `yarn typecheck && yarn test`
Expected: PASS.

```bash
git add src/store/transfer.ts src/store/cli.ts store-cli.ts scripts/build-store-cli.cjs src/store/__tests__/transfer.test.ts src/store/__tests__/cli.test.ts package.json .gitignore docs/ROADMAP.md
git commit -m "feat: add per-user store export and import" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Run the `SECURITY.md` pre-PR checklist (SEC-01 for the export file and ignore rules, INFRA-01 for the empty `infra/` diff), push and open PR D.

---

## Self-review notes (spec coverage)

| Spec requirement | Task |
|---|---|
| `Store` interface, `ConditionFailedError` with `failedIndex`, `patch` upsert with `mustExist`/`defaults`, no paging, ordered queries | 1, 2 |
| `SqliteStore`: schema, range prefix queries, atomic writes, TTL purge, WAL, migrations, newer-database refusal | 2, 3 |
| `DynamoStore` thin adapter, `removeUndefinedValues`, error mapping, no infra change | 4, 12 |
| `initStore` with dynamic imports, `getStore`/`setStore` | 5 |
| Contract suite on both backends, DynamoDB Local in CI | 2, 4 |
| Handler migration in small PRs, handler tests off `*Command` mocks | 6 to 11 |
| Remove `docClient`; no IAM or `infra/` change | 12 |
| Export/import: per-user, `query`-only, push subscriptions excluded, `--as-user`, `--replace`, owner-only file | 13 |
| Roadmap status | 13 |

Names used consistently across tasks: `getStore`, `setStore`, `initStore`, `useTestStore`, `resetTestStore`, `seedUser`, `planPatch`, `prefixUpperBound`, `runStoreContract`, `exportUser`, `importUser`, `toJsonl`, `parseJsonl`, `runCli`.
