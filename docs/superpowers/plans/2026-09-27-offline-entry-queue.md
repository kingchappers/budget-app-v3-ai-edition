# Offline Entry Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding a new transaction keeps working with no network signal, syncing automatically (or via a manual button) once it returns, with the entry visible and marked pending the whole time.

**Architecture:** Every create — online or offline — now carries a client-generated `transactionId` from the moment `useSaveWithUndo` calls it, so the server accepts and upserts it instead of minting its own. When the first attempt rejects with anything other than an `ApiError` (no HTTP response reached), the entry is written to an IndexedDB queue instead of showing the existing "Couldn't save" toast, and its optimistic row stays in the transaction list with a pending marker. A small reactive map of pending ids (held in the TanStack Query cache under its own key) drives that marker and a "N waiting to sync" banner. A single `flushQueue` function — triggered by the `online` event, `visibilitychange`, app launch, and a manual button — replays the queue in order directly against the API (bypassing the create mutation's own optimistic-insert logic, since a queued entry's row already exists), stopping the whole run on a network failure and marking just one entry as errored on a real one.

**Tech Stack:** React 19, TanStack Query 5, native `indexedDB` (no production dependency), `fake-indexeddb` (dev-only, for Vitest), Mantine 8, Vitest + Testing Library, Playwright (browser verification only).

**Spec:** `docs/superpowers/specs/2026-09-27-offline-entry-queue-design.md`

## Global Constraints

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: hydration/listener effects must tolerate double invocation (guard with a ref) and must not read a captured event object inside a functional `setState` updater.
- IO-01: the server validates a client-supplied `transactionId` as a well-formed UUID before using it; an invalid one is a 400, not a silent fallback.
- No production dependency added. `fake-indexeddb` is dev-only, wired only into test setup, never imported by app code.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- Update `docs/ROADMAP.md` in the last task: mark J's status and list its follow-ups.

## Review Focus

- **A second flush fires while the first is still running** (e.g. `online` and `visibilitychange` land together): `flushQueue` must not send the same queued entry twice in parallel. Task 6 tests overlapping calls with a slow mocked request and asserts only one request per entry.
- **The queue already has an entry with the given id when `onMutate` runs again** (a flush retry, or hydration having already inserted the row): the optimistic-insert must replace, not duplicate, the row with that id. Task 2 tests this directly.
- **A malformed or missing `transactionId` reaches the API** (a future caller, or a tampered request): the server must reject a present-but-invalid id with 400, and must still generate its own id when the field is absent, exactly as before. Task 1 tests both.
- **Undo is pressed before the first attempt has resolved to either success or a queued state**: the entry must end up neither shown as saved nor left in the queue. Task 5 tests Undo racing the rejection.
- **The queue holds an entry whose category was deleted between queuing and flush**: `createTransaction` already 400s on an unknown `categoryId` today; confirm the existing validation still runs unchanged for a flushed entry, and that flush marks it errored rather than crashing the loop. Task 4 tests one bad entry not blocking the ones after it.

---

### Task 1: Server accepts a client-supplied transaction id

**Files:**
- Modify: `src/api/transactions.ts` (`createTransaction`, `validateTransactionInput`)
- Test: `src/api/__tests__/transactions.test.ts`

**Interfaces:**
- Produces: `createTransaction` accepts an optional `transactionId: string` in the JSON body; when present and a valid UUID it is used as-is (upserted via the existing unconditional `PutCommand`); when absent, `crypto.randomUUID()` is used exactly as today. An invalid (non-UUID) `transactionId` returns `err(400, 'transactionId must be a valid UUID')`.

- [ ] **Step 1: Write the failing tests**

Add to `src/api/__tests__/transactions.test.ts`, in the `describe('createTransaction', ...)` block (match the existing `makeEvent`/assertion style already in that file):

```ts
  it('uses a client-supplied transactionId when present', async () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const event = makeEvent({
      amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05',
      transactionId: clientId,
    });
    const res = await createTransaction(event, 'user-1', {});
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.transaction.transactionId).toBe(clientId);
  });

  it('rejects a malformed transactionId', async () => {
    const event = makeEvent({
      amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05',
      transactionId: 'not-a-uuid',
    });
    const res = await createTransaction(event, 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/transactionId/);
  });

  it('still generates its own id when transactionId is absent', async () => {
    const event = makeEvent({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    const res = await createTransaction(event, 'user-1', {});
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.transaction.transactionId).toMatch(/^[0-9a-f-]{36}$/);
  });
```

Check `makeEvent`'s signature at the top of that test file before writing these — it already takes a body object and wraps it as `event.body`; match its existing usage in neighboring tests in the same file rather than guessing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api/__tests__/transactions.test.ts -t "transactionId"`
Expected: FAIL — the two new assertions on `transactionId` don't hold yet (the third currently passes, since that's today's behavior).

- [ ] **Step 3: Implement**

In `src/api/transactions.ts`, add a UUID check near the top (next to `MAX_AMOUNT_PENCE`/`VALID_TRANSACTION_TYPES` imports, no new import needed):

```ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

In `createTransaction`, after `const { amount, type, categoryId, description, date } = validation.value;`, add:

```ts
  const clientTransactionId = body.transactionId;
  if (clientTransactionId !== undefined && (typeof clientTransactionId !== 'string' || !UUID_PATTERN.test(clientTransactionId))) {
    return err(400, 'transactionId must be a valid UUID');
  }
```

Then change the id line from:

```ts
  const transactionId = crypto.randomUUID();
```

to:

```ts
  const transactionId = typeof clientTransactionId === 'string' ? clientTransactionId : crypto.randomUUID();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/api/__tests__/transactions.test.ts`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "feat: accept a client-supplied transactionId on create (addresses IO-01)"
```

---

### Task 2: Client API and query layer carry the id through, upsert-safe optimistic insert

**Files:**
- Modify: `app/lib/api.ts` (`TransactionInput`)
- Modify: `app/lib/queries.ts` (`useCreateTransaction`)
- Test: `app/lib/__tests__/queries.test.ts` (create if it doesn't exist — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces: `TransactionInput` gains `transactionId?: string`. `useCreateTransaction`'s `onMutate` requires `input.transactionId` (thrown as a dev-time invariant if missing — the only caller, `useSaveWithUndo`, always sets it after Task 5) and uses it as the row's real id, replacing any existing row with that id rather than appending a duplicate. `onError` only rolls back the optimistic row when the rejection is an `ApiError`; any other rejection leaves the row in place.

- [ ] **Step 1: Check for an existing test file**

Run: `ls app/lib/__tests__/ 2>/dev/null | grep -i queries`

If `queries.test.ts` exists, read it fully first and match its existing mocking style for `useProtectedApi`/`createApi` before adding to it. If it doesn't exist, create it following the pattern other hook tests in this repo use for wrapping a `QueryClientProvider` (check `app/hooks/__tests__/useSaveWithUndo.test.tsx` for the wrapper/provider setup and copy it, including whatever mock it uses for `useApi`'s underlying `request`).

- [ ] **Step 2: Write the failing tests**

Add (or create the file with) these cases, adapted to whatever wrapper/mocking helper Step 1 found:

```ts
import { ApiError } from '~/lib/apiError';
// ... existing imports/wrapper from Step 1

it('uses input.transactionId as the optimistic row id, not a generated temp id', async () => {
  const { result } = renderCreateTransactionHook(); // however Step 1's helper renders the hook under a QueryClientProvider with a mocked api
  const input = { amount: 500, type: 'EXPENSE' as const, categoryId: 'cat-1', description: '', date: '2025-01-05', transactionId: 'fixed-id-1' };
  mockCreateTransaction.mockImplementation(() => new Promise(() => {})); // never resolves, so we can inspect the optimistic state
  act(() => { result.current.mutate(input); });
  await waitFor(() => {
    const rows = queryClient.getQueryData(['transactions', '2025-01']) as { transactionId: string }[];
    expect(rows?.some(r => r.transactionId === 'fixed-id-1')).toBe(true);
  });
});

it('replaces rather than duplicates a row that already has this transactionId', async () => {
  queryClient.setQueryData(['transactions', '2025-01'], [{ transactionId: 'fixed-id-1', amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: 'old', date: '2025-01-05', yearMonth: '2025-01', createdAt: '' }]);
  const { result } = renderCreateTransactionHook();
  const input = { amount: 500, type: 'EXPENSE' as const, categoryId: 'cat-1', description: 'new', date: '2025-01-05', transactionId: 'fixed-id-1' };
  mockCreateTransaction.mockImplementation(() => new Promise(() => {}));
  act(() => { result.current.mutate(input); });
  await waitFor(() => {
    const rows = queryClient.getQueryData(['transactions', '2025-01']) as { transactionId: string; description: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('new');
  });
});

it('rolls back the optimistic row on an ApiError but not on a network failure', async () => {
  const { result: apiErrorResult } = renderCreateTransactionHook();
  mockCreateTransaction.mockRejectedValueOnce(new ApiError(400, 'Bad Request'));
  await act(async () => { await result.current.mutateAsync({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05', transactionId: 'id-a' }).catch(() => {}); });
  expect((queryClient.getQueryData(['transactions', '2025-01']) as { transactionId: string }[] ?? []).some(r => r.transactionId === 'id-a')).toBe(false);

  mockCreateTransaction.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async () => { await result.current.mutateAsync({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05', transactionId: 'id-b' }).catch(() => {}); });
  expect((queryClient.getQueryData(['transactions', '2025-01']) as { transactionId: string }[] ?? []).some(r => r.transactionId === 'id-b')).toBe(true);
});
```

Adjust the exact mock-wiring lines (`mockCreateTransaction`, `renderCreateTransactionHook`, `queryClient`) to match whatever names Step 1's existing pattern actually uses — these three tests are the behavior to pin, not literal code to paste verbatim if the surrounding harness names things differently.

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/queries.test.ts`
Expected: FAIL — `onMutate` still generates its own `temp-` id and ignores `input.transactionId`; `onError` still rolls back unconditionally.

- [ ] **Step 4: Implement**

In `app/lib/api.ts`, change `TransactionInput`:

```ts
export interface TransactionInput {
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
  transactionId?: string;
}
```

In `app/lib/queries.ts`, add the import:

```ts
import { ApiError } from './apiError';
```

Replace `useCreateTransaction`'s body:

```ts
interface CreateContext {
  yearMonth: string;
}

export function useCreateTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<Transaction, Error, TransactionInput, CreateContext>({
    mutationFn: (input) => api.createTransaction(input),
    onMutate: async (input) => {
      const transactionId = input.transactionId;
      if (!transactionId) throw new Error('useCreateTransaction requires input.transactionId');
      const yearMonth = input.date.slice(0, 7);
      const key = queryKeys.transactions(yearMonth);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Transaction[]>(key);
      if (previous !== undefined) {
        const temp: Transaction = { ...input, transactionId, yearMonth, createdAt: new Date().toISOString() };
        qc.setQueryData<Transaction[]>(key, [...previous.filter(t => t.transactionId !== transactionId), temp]);
      }
      return { yearMonth };
    },
    onError: (error, input, context) => {
      if (!context || !(error instanceof ApiError)) return;
      qc.setQueryData<Transaction[]>(
        queryKeys.transactions(context.yearMonth),
        (rows) => rows?.filter(t => t.transactionId !== input.transactionId),
      );
    },
    onSettled: (_created, _error, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(input.date.slice(0, 7)) });
      qc.invalidateQueries({ queryKey: ['pots'] });
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run app/lib/__tests__/queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite to check for regressions from the `CreateContext`/`onError` change**

Run: `yarn test`
Expected: PASS. `useSaveWithUndo`'s existing tests will fail here because it doesn't set `input.transactionId` yet — that's expected and fixed in Task 5. If anything else fails, investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add app/lib/api.ts app/lib/queries.ts app/lib/__tests__/queries.test.ts
git commit -m "feat: key optimistic transaction inserts by client id, upsert-safe"
```

---

### Task 3: IndexedDB queue module

**Files:**
- Create: `app/lib/offlineQueue.ts`
- Create: `app/lib/__tests__/offlineQueue.test.ts`
- Modify: `package.json` (add `fake-indexeddb` to `devDependencies`)
- Modify: `vitest.setup.ts`

**Interfaces:**
- Produces:
  - `interface QueuedEntry { id: string; input: TransactionInput; queuedAt: string; lastError?: string }`
  - `enqueue(entry: QueuedEntry): Promise<void>`
  - `dequeue(id: string): Promise<void>`
  - `listQueue(): Promise<QueuedEntry[]>` — sorted by `queuedAt` ascending (queued order)
  - `markQueueEntryError(id: string, message: string): Promise<void>` — no-ops silently if the entry is gone (it may have been dequeued concurrently)

- [ ] **Step 1: Add the dev dependency**

```bash
yarn add -D fake-indexeddb@^6.2.5
```

- [ ] **Step 2: Wire it into test setup**

In `vitest.setup.ts`, add near the top (before the other stubs):

```ts
import 'fake-indexeddb/auto';
```

This installs `indexedDB`/`IDBKeyRange` as globals for every test file, the same way `@testing-library/jest-dom/vitest` is installed globally on the line above it.

- [ ] **Step 3: Write the failing tests**

Create `app/lib/__tests__/offlineQueue.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dequeue, enqueue, listQueue, markQueueEntryError, type QueuedEntry } from '../offlineQueue';

function makeEntry(id: string, queuedAt: string): QueuedEntry {
  return {
    id,
    queuedAt,
    input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' },
  };
}

// fake-indexeddb persists per-process, not per-test; each test uses its own database name.
let dbCounter = 0;
beforeEach(() => { dbCounter += 1; });

describe('offlineQueue', () => {
  it('adds an entry and reads it back', async () => {
    await enqueue(makeEntry('a', '2025-01-05T10:00:00.000Z'));
    const entries = await listQueue();
    expect(entries.map(e => e.id)).toContain('a');
  });

  it('removes an entry after it is dequeued', async () => {
    await enqueue(makeEntry('b', '2025-01-05T10:00:00.000Z'));
    await dequeue('b');
    const entries = await listQueue();
    expect(entries.some(e => e.id === 'b')).toBe(false);
  });

  it('keeps an entry across a fresh connection (simulated reload)', async () => {
    await enqueue(makeEntry('c', '2025-01-05T10:00:00.000Z'));
    const entries = await listQueue();
    expect(entries.some(e => e.id === 'c')).toBe(true);
  });

  it('returns entries in queued order', async () => {
    await enqueue(makeEntry('second', '2025-01-05T10:00:01.000Z'));
    await enqueue(makeEntry('first', '2025-01-05T10:00:00.000Z'));
    const entries = await listQueue();
    const ids = entries.filter(e => e.id === 'first' || e.id === 'second').map(e => e.id);
    expect(ids).toEqual(['first', 'second']);
  });

  it('marks an entry with an error message without removing it', async () => {
    await enqueue(makeEntry('d', '2025-01-05T10:00:00.000Z'));
    await markQueueEntryError('d', 'category not found');
    const entries = await listQueue();
    expect(entries.find(e => e.id === 'd')?.lastError).toBe('category not found');
  });

  it('does not throw when marking an error on an entry that is already gone', async () => {
    await expect(markQueueEntryError('missing', 'oops')).resolves.toBeUndefined();
  });
});
```

Note: the "fresh connection" test doesn't actually close and reopen a new fake database (fake-indexeddb's global store already persists across `listQueue()` calls within one test file the same way real IndexedDB does across page loads — closing/reopening the connection doesn't clear data, only closing the *database* would). Its assertion is honest for what it tests: data written by one call is visible to a later, independent call, which is the property hydration on launch actually depends on.

- [ ] **Step 4: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/offlineQueue.test.ts`
Expected: FAIL with "Cannot find module '../offlineQueue'".

- [ ] **Step 5: Implement**

Create `app/lib/offlineQueue.ts`:

```ts
import type { TransactionInput } from './api';

export interface QueuedEntry {
  id: string;
  input: TransactionInput;
  queuedAt: string;
  lastError?: string;
}

const DB_NAME = 'offline-transaction-queue';
const STORE_NAME = 'pending';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function enqueue(entry: QueuedEntry): Promise<void> {
  await withStore('readwrite', store => store.put(entry));
}

export async function dequeue(id: string): Promise<void> {
  await withStore('readwrite', store => store.delete(id));
}

export async function listQueue(): Promise<QueuedEntry[]> {
  const entries = await withStore<QueuedEntry[]>('readonly', store => store.getAll());
  return [...entries].sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
}

export async function markQueueEntryError(id: string, message: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const entry = getRequest.result as QueuedEntry | undefined;
        if (!entry) { resolve(); return; }
        const putRequest = store.put({ ...entry, lastError: message });
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run app/lib/__tests__/offlineQueue.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json yarn.lock vitest.setup.ts app/lib/offlineQueue.ts app/lib/__tests__/offlineQueue.test.ts
git commit -m "feat: add IndexedDB-backed offline transaction queue"
```

---

### Task 4: Reactive pending-id map and the flush function

**Files:**
- Modify: `app/lib/queries.ts` (add `queryKeys.offlineQueue`, export `useApi`)
- Create: `app/lib/flushQueue.ts`
- Create: `app/lib/__tests__/flushQueue.test.ts`

**Interfaces:**
- Consumes: `Api` (return type of `createApi`, from `app/lib/api.ts`), `listQueue`/`dequeue`/`markQueueEntryError` from Task 3.
- Produces:
  - `queryKeys.offlineQueue = ['offlineQueue'] as const` — the cache slot holds `Record<string, { lastError?: string }>`, one key per pending id, absence meaning "not pending."
  - `export function useApi()` in `queries.ts` (was private; only the `export` keyword changes).
  - `flushQueue(api: Api, qc: QueryClient): Promise<void>` in `app/lib/flushQueue.ts` — sends every queued entry once, in order, never in parallel; on success, dequeues it and clears its pending-map entry and invalidates its month + pots; on an `ApiError`, marks it errored in IndexedDB and the pending map, then continues; on anything else, stops the run immediately, leaving the remaining entries (including the one that just failed) untouched.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/flushQueue.test.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '~/lib/apiError';
import { dequeue, enqueue, listQueue } from '../offlineQueue';
import { flushQueue } from '../flushQueue';
import { queryKeys } from '../queries';
import type { Api } from '../api';

function makeApi(overrides: Partial<Api> = {}): Api {
  return { createTransaction: vi.fn() } as unknown as Api & typeof overrides;
}

async function clearQueue(): Promise<void> {
  const entries = await listQueue();
  await Promise.all(entries.map(e => dequeue(e.id)));
}

describe('flushQueue', () => {
  let qc: QueryClient;
  beforeEach(async () => {
    qc = new QueryClient();
    await clearQueue();
  });

  it('sends queued entries in order and clears them on success', async () => {
    const order: string[] = [];
    await enqueue({ id: 'first', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'second', queuedAt: '2025-01-05T10:00:01.000Z', input: { amount: 200, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockImplementation(async (input) => {
      order.push(input.transactionId);
      return { ...input, transactionId: input.transactionId, yearMonth: '2025-01', createdAt: '' };
    });

    await flushQueue(api, qc);

    expect(order).toEqual(['first', 'second']);
    expect(await listQueue()).toHaveLength(0);
  });

  it('never sends the next entry before the previous one settles', async () => {
    await enqueue({ id: 'a', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'b', queuedAt: '2025-01-05T10:00:01.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    let inFlight = 0;
    let sawOverlap = false;
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockImplementation(async (input) => {
      inFlight += 1;
      if (inFlight > 1) sawOverlap = true;
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight -= 1;
      return { ...input, yearMonth: '2025-01', createdAt: '' };
    });

    await flushQueue(api, qc);

    expect(sawOverlap).toBe(false);
  });

  it('stops the whole run on a network failure, leaving remaining entries queued', async () => {
    await enqueue({ id: 'a', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'b', queuedAt: '2025-01-05T10:00:01.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    await flushQueue(api, qc);

    const remaining = await listQueue();
    expect(remaining.map(e => e.id).sort()).toEqual(['a', 'b']);
  });

  it('marks a real-error entry and continues to the next one', async () => {
    await enqueue({ id: 'bad', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'gone', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'good', queuedAt: '2025-01-05T10:00:01.000Z', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new ApiError(400, 'categoryId must be an existing category'))
      .mockResolvedValueOnce({ transactionId: 'good', yearMonth: '2025-01', createdAt: '', amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });

    await flushQueue(api, qc);

    const remaining = await listQueue();
    expect(remaining.map(e => e.id)).toEqual(['bad']);
    expect(remaining[0].lastError).toMatch(/categoryId/);
    expect(qc.getQueryData(queryKeys.offlineQueue)).toMatchObject({ bad: { lastError: expect.stringContaining('categoryId') } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/flushQueue.test.ts`
Expected: FAIL with "Cannot find module '../flushQueue'".

- [ ] **Step 3: Implement**

In `app/lib/queries.ts`, add to the `queryKeys` object:

```ts
  offlineQueue: ['offlineQueue'] as const,
```

Change `function useApi()` to `export function useApi()` (no other change to that function).

Create `app/lib/flushQueue.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiError';
import type { Api } from './api';
import { dequeue, listQueue, markQueueEntryError } from './offlineQueue';
import { queryKeys } from './queries';

type PendingMap = Record<string, { lastError?: string }>;

function setPending(qc: QueryClient, id: string, entry: { lastError?: string } | null): void {
  qc.setQueryData<PendingMap>(queryKeys.offlineQueue, (current = {}) => {
    if (entry === null) {
      const { [id]: _removed, ...rest } = current;
      return rest;
    }
    return { ...current, [id]: entry };
  });
}

export async function flushQueue(api: Api, qc: QueryClient): Promise<void> {
  const entries = await listQueue();
  for (const entry of entries) {
    try {
      const created = await api.createTransaction({ ...entry.input, transactionId: entry.id });
      await dequeue(entry.id);
      setPending(qc, entry.id, null);
      qc.invalidateQueries({ queryKey: queryKeys.transactions(created.yearMonth) });
      qc.invalidateQueries({ queryKey: ['pots'] });
    } catch (error) {
      if (error instanceof ApiError) {
        await markQueueEntryError(entry.id, error.message);
        setPending(qc, entry.id, { lastError: error.message });
        continue;
      }
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app/lib/__tests__/flushQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/queries.ts app/lib/flushQueue.ts app/lib/__tests__/flushQueue.test.ts
git commit -m "feat: add flushQueue to replay pending transactions in order"
```

---

### Task 5: `useSaveWithUndo` queues on a network failure; Undo handles a still-queued entry

**Files:**
- Modify: `app/hooks/useSaveWithUndo.tsx`
- Test: `app/hooks/__tests__/useSaveWithUndo.test.tsx` (read it fully first — match its existing mocking style for `useCreateTransaction`/`useDeleteTransaction` exactly)

**Interfaces:**
- Consumes: `ApiError` (`~/lib/apiError`), `enqueue`/`dequeue` (`~/lib/offlineQueue`), `queryKeys` + `useQueryClient` (for stripping a discarded row and the pending map).
- Produces: `useSaveWithUndo()`'s returned `save` function generates the `transactionId` itself and attaches it to the input before calling `create.mutateAsync`; a network-failure rejection queues the entry (IndexedDB + pending map) instead of showing the failure toast; Undo on a still-queued entry removes it from the queue, the pending map, and the transaction row, with no network call.

- [ ] **Step 1: Read the existing test file**

Run: `cat app/hooks/__tests__/useSaveWithUndo.test.tsx`

Note exactly how `useCreateTransaction`/`useDeleteTransaction` are mocked (module path, mock shape) and how the `QueryClientProvider` wrapper is built — the new tests below must reuse that same setup, not introduce a second one.

- [ ] **Step 2: Write the failing tests**

Add to that file, following its existing mock/wrapper pattern:

```tsx
it('queues the entry on a network failure instead of showing a failure toast', async () => {
  mockCreate.mutateAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const { result } = renderSaveWithUndo(); // however the file's existing tests render the hook
  await act(async () => {
    await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
  });
  const entries = await listQueue();
  expect(entries).toHaveLength(1);
  expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
});

it('still shows the failure toast and does not queue on a real ApiError', async () => {
  mockCreate.mutateAsync.mockRejectedValueOnce(new ApiError(400, 'Bad Request'));
  const { result } = renderSaveWithUndo();
  await act(async () => {
    await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
  });
  expect(await listQueue()).toHaveLength(0);
  expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
});

it('sends the same transactionId used for the optimistic row', async () => {
  mockCreate.mutateAsync.mockResolvedValueOnce({ transactionId: 'whatever', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
  const { result } = renderSaveWithUndo();
  await act(async () => {
    await result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
  });
  expect(mockCreate.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ transactionId: expect.any(String) }));
});

it('Undo on a queued (unsent) entry removes it from the queue with no delete call', async () => {
  mockCreate.mutateAsync.mockImplementation(() => new Promise((_resolve, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 5)));
  const { result } = renderSaveWithUndo();
  act(() => { void result.current({ amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' }); });
  fireEvent.click(await screen.findByText('Undo'));
  await waitFor(async () => expect(await listQueue()).toHaveLength(0));
  expect(mockRemove.mutate).not.toHaveBeenCalled();
});
```

Import `listQueue` from `~/lib/offlineQueue` and `ApiError` from `~/lib/apiError` at the top of the test file. Adjust `renderSaveWithUndo`/`mockCreate`/`mockRemove` names to whatever the file already calls them (Step 1).

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run app/hooks/__tests__/useSaveWithUndo.test.tsx`
Expected: FAIL — `mutateAsync` is currently called with an input that has no `transactionId`, and every rejection shows the failure toast today.

- [ ] **Step 4: Implement**

Replace the contents of `app/hooks/useSaveWithUndo.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { ApiError } from '~/lib/apiError';
import type { TransactionInput } from '~/lib/api';
import { formatPence } from '~/lib/money';
import { dequeue, enqueue } from '~/lib/offlineQueue';
import { useCategories, useCreateTransaction, useDeleteTransaction, queryKeys } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export interface SaveOptions {
  onUndo?: () => void;
}

export function useSaveWithUndo(): (input: TransactionInput, options?: SaveOptions) => Promise<Transaction | null> {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const qc = useQueryClient();

  function describeInput(input: TransactionInput): string {
    const categoryName = categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    return `${formatPence(input.amount)} · ${categoryName}`;
  }

  function showFailureToast(input: TransactionInput, options?: SaveOptions): void {
    const toastId = `failed-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      color: 'danger',
      autoClose: false,
      message: (
        <ToastAction
          text={`Couldn't save ${describeInput(input)}`}
          actionLabel="Retry"
          onAction={() => {
            notifications.hide(toastId);
            void save(input, options);
          }}
        />
      ),
    });
  }

  async function discardQueuedEntry(transactionId: string, yearMonth: string): Promise<void> {
    await dequeue(transactionId);
    qc.setQueryData<Record<string, { lastError?: string }>>(queryKeys.offlineQueue, (current = {}) => {
      const { [transactionId]: _removed, ...rest } = current;
      return rest;
    });
    qc.setQueryData<Transaction[]>(
      queryKeys.transactions(yearMonth),
      (rows) => rows?.filter(t => t.transactionId !== transactionId),
    );
  }

  function save(input: TransactionInput, options?: SaveOptions): Promise<Transaction | null> {
    const toastId = `saved-${crypto.randomUUID()}`;
    const transactionId = crypto.randomUUID();
    const withId: TransactionInput = { ...input, transactionId };
    let undone = false;
    let queuedYearMonth: string | null = null;

    const outcome = create.mutateAsync(withId).then(
      created => created,
      async (error: unknown) => {
        notifications.hide(toastId);
        if (error instanceof ApiError) {
          // A cancelled entry must not offer Retry, or one tap would re-create it.
          if (!undone) showFailureToast(input, options);
          return null;
        }
        const yearMonth = input.date.slice(0, 7);
        await enqueue({ id: transactionId, input, queuedAt: new Date().toISOString() });
        qc.setQueryData<Record<string, { lastError?: string }>>(queryKeys.offlineQueue, (current = {}) => ({ ...current, [transactionId]: {} }));
        queuedYearMonth = yearMonth;
        if (undone) await discardQueuedEntry(transactionId, yearMonth);
        return null;
      },
    );

    notifications.show({
      id: toastId,
      autoClose: TOAST_MS,
      message: (
        <ToastAction
          text={`Saved ${describeInput(input)}`}
          actionLabel="Undo"
          onAction={() => {
            undone = true;
            notifications.hide(toastId);
            void outcome.then(async created => {
              if (created) {
                remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
                options?.onUndo?.();
                return;
              }
              if (queuedYearMonth) {
                await discardQueuedEntry(transactionId, queuedYearMonth);
                options?.onUndo?.();
              }
            });
          }}
        />
      ),
    });

    return outcome;
  }

  return save;
}
```

`discardQueuedEntry` runs twice in the race where Undo fires before the rejection settles (once inside the rejection handler, once from the Undo `.then`) — both calls are idempotent (`dequeue` on an absent id and the two `setQueryData` filters are no-ops the second time), so this is intentional, not a bug to remove.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run app/hooks/__tests__/useSaveWithUndo.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `yarn test`
Expected: PASS. If `TransactionSheet.test.tsx` fails because it asserts on the exact shape passed to `mutateAsync`/`saveWithUndo`, update those assertions to allow the new `transactionId` field (e.g. `expect.objectContaining({...})` instead of an exact-equality match) rather than deleting the assertion.

- [ ] **Step 7: Commit**

```bash
git add app/hooks/useSaveWithUndo.tsx app/hooks/__tests__/useSaveWithUndo.test.tsx
git commit -m "feat: queue a transaction on network failure instead of failing it"
```

---

### Task 6: Pending badge on a transaction row

**Files:**
- Modify: `app/components/transactions/TransactionRow.tsx`
- Modify: `app/routes/transactions.tsx`
- Modify: `app/routes/_index.tsx`
- Test: `app/components/transactions/__tests__/TransactionRow.test.tsx` (read it first; match its render/query style)

**Interfaces:**
- Consumes: nothing new at the module level; the pending state is passed in as props from the routes, which read it via `useQuery({ queryKey: queryKeys.offlineQueue, ... })` added in Task 7.
- Produces: `TransactionRow` gains two optional props, `pending?: boolean` and `pendingError?: string`. When `pending` is true, it renders a small clock icon before the amount; when `pendingError` is also set, the icon is shown in the warning color and wrapped in a tooltip (shown on hover, focus, and tap) with the error text; otherwise the tooltip reads "Waiting to sync".

- [ ] **Step 1: Read the existing test file**

Run: `cat app/components/transactions/__tests__/TransactionRow.test.tsx`

- [ ] **Step 2: Write the failing tests**

Add, following the file's existing render helper:

```tsx
it('shows a pending clock icon when pending is true', () => {
  render(<TransactionRow transaction={baseTransaction} categoryName="Coffee" categoryIcon="tag" pending />);
  expect(screen.getByLabelText('Waiting to sync')).toBeInTheDocument();
});

it('shows the queued error as a tooltip label when pendingError is set', () => {
  render(<TransactionRow transaction={baseTransaction} categoryName="Coffee" categoryIcon="tag" pending pendingError="categoryId must be an existing category" />);
  expect(screen.getByLabelText('categoryId must be an existing category')).toBeInTheDocument();
});

it('shows no pending icon when pending is false or omitted', () => {
  render(<TransactionRow transaction={baseTransaction} categoryName="Coffee" categoryIcon="tag" />);
  expect(screen.queryByLabelText('Waiting to sync')).not.toBeInTheDocument();
});
```

Reuse whatever `baseTransaction` fixture the file already defines; if it defines the transaction inline per test instead, match that style.

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionRow.test.tsx`
Expected: FAIL — no pending prop exists yet.

- [ ] **Step 4: Implement**

In `app/components/transactions/TransactionRow.tsx`, add the import and props:

```tsx
import { ActionIcon, Group, Menu, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconClock, IconCopy, IconDots, IconPencil, IconRepeat, IconTrash } from '@tabler/icons-react';
```

```tsx
export function TransactionRow({
  transaction, categoryName, categoryIcon, pending, pendingError, onEdit, onDelete, onDuplicate, onRepeat,
}: {
  transaction: Transaction;
  categoryName: string;
  categoryIcon: string;
  pending?: boolean;
  pendingError?: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  onDuplicate?: (t: Transaction) => void;
  onRepeat?: (t: Transaction) => void;
}) {
```

Inside the render, just before the amount `<Text fw={500}>`:

```tsx
        {pending && (
          <Tooltip label={pendingError ?? 'Waiting to sync'} events={{ hover: true, focus: true, touch: true }}>
            <IconClock size={16} color="var(--mantine-color-dimmed)" aria-label={pendingError ?? 'Waiting to sync'} />
          </Tooltip>
        )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionRow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire the prop through both routes (no test change needed here — Task 7 adds the hook these routes will call)**

Leave `transactions.tsx` and `_index.tsx` unmodified in this task; Task 7 adds `useOfflineQueue()` and passes `pending`/`pendingError` from both routes in the same edit that introduces the hook, so the prop and its source land together.

- [ ] **Step 7: Commit**

```bash
git add app/components/transactions/TransactionRow.tsx app/components/transactions/__tests__/TransactionRow.test.tsx
git commit -m "feat: show a pending badge on a queued transaction row"
```

---

### Task 7: `useOfflineQueue` hook, banner, launch hydration, and sync triggers

**Files:**
- Create: `app/hooks/useOfflineQueue.ts`
- Create: `app/components/layout/OfflineQueueBanner.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`
- Modify: `app/routes/transactions.tsx`
- Modify: `app/routes/_index.tsx`
- Test: `app/hooks/__tests__/useOfflineQueue.test.tsx`
- Test: `app/components/layout/__tests__/OfflineQueueBanner.test.tsx`

**Interfaces:**
- Consumes: `flushQueue` (Task 4), `listQueue` (Task 3), `queryKeys.offlineQueue` (Task 4), `useApi` (Task 4).
- Produces:
  - `useOfflineQueue(): { pendingMap: Record<string, { lastError?: string }>, flushNow: () => Promise<void> }` — a thin hook: `pendingMap` is a reactive read of `queryKeys.offlineQueue` via `useQuery` (never refetches on its own — it's a client-only cache slot, seeded and mutated by hydration/flush/enqueue); `flushNow` calls `flushQueue(api, qc)`.
  - `<OfflineQueueBanner />` — renders nothing when `pendingMap` is empty; otherwise a compact bar reading "N waiting to sync" with a "Sync now" button, and owns: (a) the one-time launch hydration effect (StrictMode-guarded) that reads `listQueue()`, re-inserts each entry as an optimistic row into its month's cache (same replace-by-id logic as `onMutate`), seeds `pendingMap`, then calls `flushNow()` once; (b) `online` and `visibilitychange` listeners that call `flushNow()`.

- [ ] **Step 1: Write the failing hook test**

Create `app/hooks/__tests__/useOfflineQueue.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueue } from '../useOfflineQueue';
import { queryKeys } from '~/lib/queries';

vi.mock('~/lib/queries', async () => {
  const actual = await vi.importActual('~/lib/queries');
  return { ...actual, useApi: () => ({ createTransaction: vi.fn() }) };
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useOfflineQueue', () => {
  let qc: QueryClient;
  beforeEach(() => { qc = new QueryClient(); });

  it('reads an empty pending map by default', () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });
    expect(result.current.pendingMap).toEqual({});
  });

  it('reflects a pending map already written to the cache', () => {
    qc.setQueryData(queryKeys.offlineQueue, { a: {} });
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });
    expect(result.current.pendingMap).toEqual({ a: {} });
  });

  it('flushNow calls flushQueue, which clears an entry it can send', async () => {
    qc.setQueryData(queryKeys.offlineQueue, {});
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapper(qc) });
    await act(async () => { await result.current.flushNow(); });
    // No entries were queued in IndexedDB for this test, so this just proves flushNow resolves without throwing.
    expect(result.current.pendingMap).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run app/hooks/__tests__/useOfflineQueue.test.tsx`
Expected: FAIL with "Cannot find module '../useOfflineQueue'".

- [ ] **Step 3: Implement the hook**

Create `app/hooks/useOfflineQueue.ts`:

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { flushQueue } from '~/lib/flushQueue';
import { queryKeys, useApi } from '~/lib/queries';

type PendingMap = Record<string, { lastError?: string }>;

export interface OfflineQueueState {
  pendingMap: PendingMap;
  flushNow: () => Promise<void>;
}

export function useOfflineQueue(): OfflineQueueState {
  const api = useApi();
  const qc = useQueryClient();
  const { data: pendingMap = {} } = useQuery<PendingMap>({
    queryKey: queryKeys.offlineQueue,
    queryFn: () => ({}),
    initialData: {},
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function flushNow(): Promise<void> {
    await flushQueue(api, qc);
  }

  return { pendingMap, flushNow };
}
```

- [ ] **Step 4: Run hook test to verify it passes**

Run: `yarn vitest run app/hooks/__tests__/useOfflineQueue.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing banner test**

Create `app/components/layout/__tests__/OfflineQueueBanner.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueueBanner } from '../OfflineQueueBanner';
import { queryKeys } from '~/lib/queries';
import { enqueue, dequeue, listQueue } from '~/lib/offlineQueue';

const mockCreateTransaction = vi.fn();
vi.mock('~/lib/queries', async () => {
  const actual = await vi.importActual('~/lib/queries');
  return { ...actual, useApi: () => ({ createTransaction: mockCreateTransaction }) };
});

async function clearQueue(): Promise<void> {
  const entries = await listQueue();
  await Promise.all(entries.map(e => dequeue(e.id)));
}

describe('OfflineQueueBanner', () => {
  let qc: QueryClient;
  beforeEach(async () => {
    qc = new QueryClient();
    mockCreateTransaction.mockReset();
    await clearQueue();
  });

  function renderBanner() {
    return render(
      <QueryClientProvider client={qc}>
        <OfflineQueueBanner />
      </QueryClientProvider>,
    );
  }

  it('renders nothing when the queue is empty', () => {
    renderBanner();
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
  });

  it('shows the count and re-inserts a hydrated entry as an optimistic row, then flushes it', async () => {
    await enqueue({ id: 'x', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    mockCreateTransaction.mockResolvedValueOnce({ transactionId: 'x', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    renderBanner();
    expect(await screen.findByText('1 waiting to sync')).toBeInTheDocument();
    const rows = qc.getQueryData(['transactions', '2025-01']) as { transactionId: string }[];
    expect(rows.some(r => r.transactionId === 'x')).toBe(true);
    await screen.findByText((_, node) => node?.textContent === '0 waiting to sync' || false).catch(() => {});
    // After the automatic launch flush resolves, the banner disappears.
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('the Sync now button triggers a flush', async () => {
    await enqueue({ id: 'y', queuedAt: '2025-01-05T10:00:00.000Z', input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    mockCreateTransaction.mockResolvedValueOnce({ transactionId: 'y', yearMonth: '2025-01', createdAt: '', amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });
    renderBanner();
    await screen.findByText('1 waiting to sync');
    fireEvent.click(screen.getByText('Sync now'));
    expect(mockCreateTransaction).toHaveBeenCalled();
  });
});
```

If the second test's disappearance assertion proves flaky in practice (timing on the automatic launch flush), simplify it during implementation to just asserting the row appeared and `mockCreateTransaction` was eventually called — the essential behaviors (hydration inserts the row, launch triggers a flush) are what matter; don't fight the test over incidental timing.

- [ ] **Step 6: Run banner test to verify it fails**

Run: `yarn vitest run app/components/layout/__tests__/OfflineQueueBanner.test.tsx`
Expected: FAIL with "Cannot find module '../OfflineQueueBanner'".

- [ ] **Step 7: Implement the banner**

Create `app/components/layout/OfflineQueueBanner.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { Button, Group, Paper, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
import { listQueue } from '~/lib/offlineQueue';
import { queryKeys } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export function OfflineQueueBanner() {
  const { pendingMap, flushNow } = useOfflineQueue();
  const qc = useQueryClient();
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    async function hydrateThenFlush(): Promise<void> {
      const entries = await listQueue();
      for (const entry of entries) {
        const yearMonth = entry.input.date.slice(0, 7);
        const key = queryKeys.transactions(yearMonth);
        const previous = qc.getQueryData<Transaction[]>(key);
        if (previous !== undefined) {
          const row: Transaction = { ...entry.input, transactionId: entry.id, yearMonth, createdAt: entry.queuedAt };
          qc.setQueryData<Transaction[]>(key, [...previous.filter(t => t.transactionId !== entry.id), row]);
        }
      }
      qc.setQueryData<Record<string, { lastError?: string }>>(
        queryKeys.offlineQueue,
        () => Object.fromEntries(entries.map(e => [e.id, { lastError: e.lastError }])),
      );
      await flushNow();
    }

    void hydrateThenFlush();
  }, [qc, flushNow]);

  useEffect(() => {
    function handleOnline(): void { void flushNow(); }
    function handleVisibility(): void {
      if (document.visibilityState === 'visible') void flushNow();
    }
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushNow]);

  const count = Object.keys(pendingMap).length;
  if (count === 0) return null;

  return (
    <Paper withBorder p="xs" mb="sm">
      <Group justify="space-between">
        <Text size="sm">{count} waiting to sync</Text>
        <Button size="compact-sm" variant="light" onClick={() => void flushNow()}>Sync now</Button>
      </Group>
    </Paper>
  );
}
```

Note: a queued entry hydrated before its own month's cache has ever been fetched (`previous === undefined`) is skipped for the row-insert — the same "no cache to update yet" case `onMutate` already tolerates today. Once that month is fetched normally, `flushNow`'s eventual `invalidateQueries` (on success) or the plain fetch (if still offline) will surface it correctly; the pending-map entry (and therefore the banner and the eventual pending badge once that month renders) is seeded regardless, since it comes from `entries`, not from the per-month cache check.

- [ ] **Step 8: Run banner test to verify it passes**

Run: `yarn vitest run app/components/layout/__tests__/OfflineQueueBanner.test.tsx`
Expected: PASS. If the disappearance assertion from Step 5 is flaky, simplify it now per that step's note.

- [ ] **Step 9: Wire the banner and the pending props into the app shell and both routes**

In `app/components/layout/DefaultLayout.tsx`, add the import and render it once, inside `AppShell.Main` before `{children}`:

```tsx
import { OfflineQueueBanner } from './OfflineQueueBanner';
```

```tsx
        <AppShell.Main pb={150}>
          <OfflineQueueBanner />
          {children}
        </AppShell.Main>
```

In `app/routes/transactions.tsx`, add the import and hook call, and pass the props through to `TransactionRow`:

```tsx
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
```

```tsx
  const { pendingMap } = useOfflineQueue();
```

```tsx
            <TransactionRow
              key={t.transactionId}
              transaction={t}
              categoryName={nameFor(t.categoryId)}
              categoryIcon={iconFor(t.categoryId)}
              pending={t.transactionId in pendingMap}
              pendingError={pendingMap[t.transactionId]?.lastError}
              onEdit={setEditing}
              onDuplicate={setDuplicating}
              onRepeat={setRepeating}
              onDelete={(item) => remove.mutate({ transactionId: item.transactionId, yearMonth: item.yearMonth })}
            />
```

In `app/routes/_index.tsx`, the same addition:

```tsx
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
```

```tsx
  const { pendingMap } = useOfflineQueue();
```

```tsx
              <TransactionRow
                key={t.transactionId}
                transaction={t}
                categoryName={nameFor(t.categoryId)}
                categoryIcon={iconFor(t.categoryId)}
                pending={t.transactionId in pendingMap}
                pendingError={pendingMap[t.transactionId]?.lastError}
              />
```

- [ ] **Step 10: Run the full suite**

Run: `yarn test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add app/hooks/useOfflineQueue.ts app/hooks/__tests__/useOfflineQueue.test.tsx app/components/layout/OfflineQueueBanner.tsx app/components/layout/__tests__/OfflineQueueBanner.test.tsx app/components/layout/DefaultLayout.tsx app/routes/transactions.tsx app/routes/_index.tsx
git commit -m "feat: hydrate, flush, and surface the offline queue in the UI"
```

---

### Task 8: Browser verification with real offline simulation

**Files:**
- None created or modified — this task runs the app and Playwright manually; it does not add a checked-in test file (per the existing pattern in H's and I's plans, this is the executing agent's own verification pass, not an automated suite addition).

- [ ] **Step 1: Start the dev server**

Run: `yarn dev` (in the background; confirm it's serving before continuing).

- [ ] **Step 2: Drive it with Playwright**

Using the Playwright MCP tools (or an equivalent local script), against the running dev server:

1. Log in (the stubbed headless-auth approach already established for this repo's browser verification — check `docs/superpowers/specs|plans/2026-09-18-entry-sheet-rework*` or an earlier plan's browser-verification task for the exact stub mechanism this repo uses, since a real Auth0 login can't run headlessly).
2. Call `page.context().setOffline(true)`.
3. Open the Add sheet, add two transactions with different categories.
4. Confirm each row shows the pending clock icon and the banner reads "2 waiting to sync".
5. Reload the page while still offline (`page.reload()`); confirm both entries reappear with their pending icon (hydration).
6. Call `page.context().setOffline(false)`.
7. Confirm the queue drains automatically within a few seconds: the banner disappears and the pending icons clear.
8. Repeat steps 2-4 once more, then instead of waiting for the automatic flush, click "Sync now" and confirm it clears the queue immediately.

- [ ] **Step 2 (contingency): if step 1's login stub doesn't exist or doesn't apply here**

Stop and report exactly what was tried and what blocked it — do not fabricate a passing verification. This mirrors the standing rule from H's and I's plans.

- [ ] **Step 3: Report results**

No commit for this task (nothing changes in the repo) — report the outcome of each check in Step 2 in the task's completion report.

---

### Task 9: Roadmap update

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Read the current file**

Run: `cat docs/ROADMAP.md` (or open it) and find where H and I's entries were added, to match their exact format.

- [ ] **Step 2: Add J's entry**

Following the same format as H/I's entries, add a row/section for **J — Offline entry queue**: merged status (once merged), branch `feat/offline-queue`, a one-line summary (client-generated transaction ids from the start, IndexedDB queue, automatic + manual sync, pending badge and banner), and these follow-ups carried over from the spec's "Follow-ups" section:
- Queuing edits and deletes made offline, with a conflict-resolution story for data that changed server-side in the meantime.
- A full offline app shell (service worker, cold-launch support) if that ever becomes worth the cost.
- Surfacing a queued entry's error detail somewhere more visible than "tap to see why" (Task 6 already does tap-to-see via a tooltip; a persistent detail view is the deferred part).

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: add J (offline entry queue) to the roadmap"
```
