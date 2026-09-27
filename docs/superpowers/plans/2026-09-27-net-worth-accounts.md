# Net Worth and Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track real accounts (assets and liabilities) with hand-entered, dated balances, and show net worth over time on the Insights page from sub-project H.

**Architecture:** One new API resource, `Account`, storing a small embedded list of dated balance entries per account (the same shape F2 uses for a pot's auto-contribute list). Two pure functions, `balanceAsOf` and `netWorthAsOf`, mirrored server- and client-side, turn that history into "the balance right now" or "at the end of any month." A new Accounts page (reached from H's More sheet) manages accounts and their balances; a new section on H's Insights page shows net worth over the chosen span.

**Tech Stack:** React 19, React Router 8, Mantine 8.3.12, `@mantine/charts` 8.3.12 (already added by H), TanStack Query 5, Vitest 4 + Testing Library, AWS Lambda + DynamoDB, TypeScript strict, yarn.

**Spec:** `docs/superpowers/specs/2026-09-27-net-worth-accounts-design.md` (builds on H's spec, `docs/superpowers/specs/2026-09-27-spending-insights-design.md`, and plan, `docs/superpowers/plans/2026-09-27-spending-insights.md` — Tasks 3 and 4 of this plan modify files H's own plan creates or modifies; read H's plan first if anything here doesn't match what you find on disk, and trust what's actually committed over this plan's description of it).

## Execution notes for a cloud agent (start here if you have no prior context)

- Work on branch `feat/net-worth-accounts` (it already contains both specs and this plan, and is stacked on `feat/spending-insights`). Do not create another branch. **Do not open a pull request; do not mark any existing pull request ready for review.** Only push commits to this branch.
- Setup: `yarn install --frozen-lockfile` if `node_modules` is missing. Commands: `yarn test` (all tests), `yarn vitest run <path>` (one file), `yarn typecheck`. Both must be clean before every commit.
- Do the tasks in order. Commit after each task, then `git push origin feat/net-worth-accounts`. If a step cannot be completed after two honest attempts, stop, commit what is green, push, and say exactly what blocked you.
- Follow TDD: write the failing test, run it and see it fail for the expected reason, implement, then see it pass. Record the real failing output in your notes.
- Do not edit any file a task does not list. Do not weaken or delete an existing test to get green; only change a test where the plan says the behaviour changes. Never make unrelated formatting changes.
- Task 7 is a real-browser verification that changes no repo files; its scratch files go outside the repo. If a browser cannot be installed in your environment, say so precisely and skip it; the controller will run it.
- Commit trailers: use the trailer lines your harness gives you; if it gives none, end each message with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Global Constraints

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for every new input; AUTH-01/AUTH-04 unchanged — every route stays behind the existing JWT check, scoped to the caller's partition); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging (`git add <files>`).
- Every account is `kind: 'ASSET' | 'LIABILITY'`, fixed at creation. `type` is `'CASH' | 'SAVINGS' | 'INVESTMENT'` for an asset, `'CREDIT_CARD' | 'LOAN'` for a liability, and must always match `kind`.
- A liability's balance is stored and entered as a positive "amount owed"; it is *subtracted* when summing net worth, never stored negative.
- A balance history is a list of `{ date: 'YYYY-MM-DD', pence: number }`, capped at 500 entries. Appending an entry for a date that already exists **replaces** it; any other date is inserted keeping the list sorted by date. Money values are always integer pence, capped at the existing shared `MAX_AMOUNT_PENCE` (`src/api/constants.ts` / `app/lib/money.ts`).
- No infra, IAM or dependency changes; `@mantine/charts` is already a dependency once H's Task 4 has landed.
- Update `docs/ROADMAP.md` (Task 8): add I's status and follow-ups.

## Review Focus

1. `balanceAsOf`/`netWorthAsOf` for a date before any entry exists returns 0, not an error or the earliest entry's value.
2. Appending a balance for a date that already has an entry replaces it rather than creating a second point for the same day; appending a backdated entry inserts it in the correct position, not at the end.
3. A `type` that doesn't match the account's `kind` is rejected on both create and update — `CREDIT_CARD` on an asset, `CASH` on a liability, and so on — before any DynamoDB write.
4. `kind` cannot be changed once an account exists (only `PUT` fields are `name`/`type`); an attempt to send `kind` on update is simply ignored, not silently accepted as a change.
5. Net worth on Insights must correctly subtract liabilities, not add them — a single liability with no assets must show as a **negative** net worth, and the summary text must make the sign obvious (a minus sign, or equivalent), not just a smaller positive number.

---

### Task 1: Accounts API

**Files:**
- Modify: `src/api/types.ts`, `src/api/constants.ts`, `src/api/db.ts`, `src/api/pots.ts`, `api-handler.ts`
- Create: `src/api/accounts.ts`, `src/api/__tests__/accounts.test.ts`

**Interfaces:**
- Produces (`src/api/types.ts`): `type AccountKind = 'ASSET' | 'LIABILITY'`; `type AccountType = 'CASH' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT_CARD' | 'LOAN'`; `interface BalanceEntry { date: string; pence: number }`; `interface Account { accountId: string; name: string; kind: AccountKind; type: AccountType; balances: BalanceEntry[]; createdAt: string }`.
- Produces (`src/api/constants.ts`): `ASSET_TYPES = new Set(['CASH', 'SAVINGS', 'INVESTMENT'])`; `LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN'])`; `MAX_BALANCE_ENTRIES = 500`.
- Produces (`src/api/db.ts`): `accountSk(accountId: string): string` returning `` `ACCOUNT#${accountId}` ``.
- Produces (`src/api/pots.ts`): `queryOne` becomes exported (add the `export` keyword only — same reasoning H's Task 1 used for `queryAll`: it stays in `pots.ts` because its `docClient` closure only resolves correctly through a live import binding, not through a module mocked and re-spread elsewhere).
- Produces (`src/api/accounts.ts`): `applyBalanceEntry(entries: BalanceEntry[], date: string, pence: number): BalanceEntry[]`; `balanceAsOf(entries: BalanceEntry[], date: string): number`; `getAccounts`, `createAccount`, `updateAccount`, `deleteAccount`, `addBalance` — each `(event, userId, params) => Promise<ApiResponse>`.
- Routes: `GET /api/accounts`, `POST /api/accounts`, `PUT /api/accounts/{accountId}`, `DELETE /api/accounts/{accountId}`, `POST /api/accounts/{accountId}/balances`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/__tests__/accounts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  accountSk: (accountId: string) => `ACCOUNT#${accountId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
  PutCommand: vi.fn(function (i: unknown) { return i; }),
  DeleteCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { applyBalanceEntry, balanceAsOf, getAccounts, createAccount, updateAccount, deleteAccount, addBalance } from '../accounts';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { BalanceEntry } from '../types';

function event(body?: unknown, params?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: params,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

function account(overrides: Partial<Record<string, unknown>> = {}) {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

interface Store {
  accounts?: unknown[];
  accountById?: unknown[];
}

function useStore(store: Store): void {
  mockSend.mockImplementation(async (command: Record<string, any>) => {
    if (command.Item) return {};
    if (command.Key) return {};
    const values = command.ExpressionAttributeValues as Record<string, string>;
    if (values[':sk']) return { Items: store.accountById ?? [] };
    return { Items: store.accounts ?? [] };
  });
}

beforeEach(() => {
  mockSend.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
});

afterEach(() => { vi.useRealTimers(); });

describe('applyBalanceEntry', () => {
  const entries: BalanceEntry[] = [{ date: '2026-08-01', pence: 1000 }, { date: '2026-09-01', pence: 2000 }];

  it('inserts a new date in sorted order', () => {
    expect(applyBalanceEntry(entries, '2026-08-15', 1500)).toEqual([
      { date: '2026-08-01', pence: 1000 }, { date: '2026-08-15', pence: 1500 }, { date: '2026-09-01', pence: 2000 },
    ]);
  });

  it('replaces an entry with the same date instead of duplicating it', () => {
    expect(applyBalanceEntry(entries, '2026-08-01', 1200)).toEqual([
      { date: '2026-08-01', pence: 1200 }, { date: '2026-09-01', pence: 2000 },
    ]);
  });

  it('starts a new list from empty', () => {
    expect(applyBalanceEntry([], '2026-09-01', 500)).toEqual([{ date: '2026-09-01', pence: 500 }]);
  });
});

describe('balanceAsOf', () => {
  const entries: BalanceEntry[] = [{ date: '2026-07-01', pence: 1000 }, { date: '2026-09-01', pence: 3000 }];

  it('is 0 before the first entry', () => {
    expect(balanceAsOf(entries, '2026-06-30')).toBe(0);
  });

  it('is the last entry at or before the date', () => {
    expect(balanceAsOf(entries, '2026-07-01')).toBe(1000);
    expect(balanceAsOf(entries, '2026-08-15')).toBe(1000);
    expect(balanceAsOf(entries, '2026-12-31')).toBe(3000);
  });

  it('is 0 for an account with no entries', () => {
    expect(balanceAsOf([], '2026-09-15')).toBe(0);
  });
});

describe('getAccounts', () => {
  it('returns every account for the caller', async () => {
    useStore({ accounts: [account({ accountId: 'acc-1' }), account({ accountId: 'acc-2', kind: 'LIABILITY', type: 'LOAN' })] });
    const res = await getAccounts(event(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).accounts).toHaveLength(2);
  });

  it('is scoped to the caller', async () => {
    useStore({ accounts: [] });
    await getAccounts(event(), 'user-42', {});
    expect(mockSend.mock.calls[0][0].ExpressionAttributeValues[':pk']).toBe('USER#user-42');
  });
});

describe('createAccount', () => {
  it('creates an asset account', async () => {
    useStore({});
    const res = await createAccount(event({ name: 'Lloyds', kind: 'ASSET', type: 'CASH' }), 'user-1', {});
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.account).toMatchObject({ name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [] });
  });

  it.each([
    ['missing name', { kind: 'ASSET', type: 'CASH' }],
    ['blank name', { name: '  ', kind: 'ASSET', type: 'CASH' }],
    ['invalid kind', { name: 'X', kind: 'SPARE', type: 'CASH' }],
    ['type does not match kind (liability type on an asset)', { name: 'X', kind: 'ASSET', type: 'LOAN' }],
    ['type does not match kind (asset type on a liability)', { name: 'X', kind: 'LIABILITY', type: 'CASH' }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await createAccount(event(body), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('updateAccount', () => {
  it('renames and changes the type within the same kind', async () => {
    useStore({ accountById: [account({ type: 'CASH' })] });
    const res = await updateAccount(event({ name: 'Lloyds current', type: 'SAVINGS' }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).account).toMatchObject({ name: 'Lloyds current', type: 'SAVINGS', kind: 'ASSET' });
  });

  it('ignores a kind sent in the body rather than changing it', async () => {
    useStore({ accountById: [account({ kind: 'ASSET', type: 'CASH' })] });
    const res = await updateAccount(event({ name: 'Lloyds', type: 'CASH', kind: 'LIABILITY' }), 'user-1', { accountId: 'acc-1' });
    expect(JSON.parse(res.body).account.kind).toBe('ASSET');
  });

  it('returns 400 when the new type does not match the existing kind', async () => {
    useStore({ accountById: [account({ kind: 'ASSET' })] });
    const res = await updateAccount(event({ name: 'Lloyds', type: 'LOAN' }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a missing account', async () => {
    useStore({ accountById: [] });
    const res = await updateAccount(event({ name: 'X', type: 'CASH' }), 'user-1', { accountId: 'acc-missing' });
    expect(res.statusCode).toBe(404);
  });
});

describe('deleteAccount', () => {
  it('deletes and returns 204', async () => {
    useStore({});
    const res = await deleteAccount(event(), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(204);
  });
});

describe('addBalance', () => {
  const valid = { date: '2026-09-15', pence: 250000 };

  it('appends a balance entry', async () => {
    useStore({ accountById: [account({ balances: [{ date: '2026-08-01', pence: 200000 }] })] });
    const res = await addBalance(event(valid), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).account.balances).toEqual([{ date: '2026-08-01', pence: 200000 }, valid]);
  });

  it.each([
    ['missing date', { pence: 100 }],
    ['malformed date', { date: '2026-9-15', pence: 100 }],
    ['date too far ahead', { date: '2026-09-17', pence: 100 }],
    ['zero pence', { date: '2026-09-15', pence: 0 }],
    ['fractional pence', { date: '2026-09-15', pence: 100.5 }],
    ['pence over the cap', { date: '2026-09-15', pence: 1_000_000_001 }],
  ])('returns 400 for %s', async (_label, body) => {
    useStore({ accountById: [account()] });
    const res = await addBalance(event(body), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a date one day ahead of the server', async () => {
    useStore({ accountById: [account()] });
    const res = await addBalance(event({ date: '2026-09-16', pence: 100 }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for a missing account', async () => {
    useStore({ accountById: [] });
    const res = await addBalance(event(valid), 'user-1', { accountId: 'acc-missing' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when the entry would push the history over the cap', async () => {
    const full: BalanceEntry[] = Array.from({ length: 500 }, (_, i) => ({
      date: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, pence: 100,
    }));
    useStore({ accountById: [account({ balances: full })] });
    const res = await addBalance(event({ date: '2026-09-15', pence: 999 }), 'user-1', { accountId: 'acc-1' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api/__tests__/accounts.test.ts`
Expected: FAIL (module `../accounts` does not exist).

- [ ] **Step 3: Implement**

`src/api/types.ts`: append

```ts
export type AccountKind = 'ASSET' | 'LIABILITY';
export type AccountType = 'CASH' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT_CARD' | 'LOAN';

export interface BalanceEntry {
  date: string;
  pence: number;
}

export interface Account {
  accountId: string;
  name: string;
  kind: AccountKind;
  type: AccountType;
  balances: BalanceEntry[];
  createdAt: string;
}
```

`src/api/constants.ts`: append

```ts
export const ASSET_TYPES = new Set(['CASH', 'SAVINGS', 'INVESTMENT']);
export const LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN']);
export const MAX_BALANCE_ENTRIES = 500;
```

`src/api/db.ts`: append `export const accountSk = (accountId: string): string => \`ACCOUNT#${accountId}\`;` on one line, matching the file's existing style.

`src/api/pots.ts`: change `async function queryOne(` to `export async function queryOne(`. Nothing else in that file changes.

Create `src/api/accounts.ts`:

```ts
import { PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, accountSk } from './db';
import { queryAll, queryOne } from './pots';
import { ASSET_TYPES, LIABILITY_TYPES, MAX_AMOUNT_PENCE, MAX_BALANCE_ENTRIES, SECURITY_HEADERS } from './constants';
import type { Account, AccountKind, AccountType, ApiResponse, BalanceEntry } from './types';
import { ok, err } from './http';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAME_MAX_LENGTH = 50;

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function tomorrowIso(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + 1);
  return now.toISOString().slice(0, 10);
}

function isValidPence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_AMOUNT_PENCE;
}

function typesFor(kind: AccountKind): Set<string> {
  return kind === 'ASSET' ? ASSET_TYPES : LIABILITY_TYPES;
}

export function applyBalanceEntry(entries: BalanceEntry[], date: string, pence: number): BalanceEntry[] {
  const withoutDate = entries.filter(entry => entry.date !== date);
  return [...withoutDate, { date, pence }].sort((a, b) => a.date.localeCompare(b.date));
}

export function balanceAsOf(entries: BalanceEntry[], date: string): number {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let pence = 0;
  for (const entry of sorted) {
    if (entry.date > date) break;
    pence = entry.pence;
  }
  return pence;
}

export async function getAccounts(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const items = await queryAll(userId, 'ACCOUNT#');
  return ok({ accounts: items as unknown as Account[] });
}

export async function createAccount(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { name, kind, type } = body;
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > NAME_MAX_LENGTH) {
    return err(400, `name must be a non-empty string of at most ${NAME_MAX_LENGTH} characters`);
  }
  if (kind !== 'ASSET' && kind !== 'LIABILITY') {
    return err(400, 'kind must be ASSET or LIABILITY');
  }
  if (typeof type !== 'string' || !typesFor(kind).has(type)) {
    return err(400, `type must match kind: ${[...typesFor(kind)].join(', ')}`);
  }

  const accountId = crypto.randomUUID();
  const account: Account = {
    accountId,
    name: name.trim(),
    kind,
    type: type as AccountType,
    balances: [],
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: accountSk(accountId), ...account },
  }));

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ account }) };
}
```

(Add `SECURITY_HEADERS` to this file's import from `./constants`, alongside `ASSET_TYPES`, `LIABILITY_TYPES`, `MAX_AMOUNT_PENCE` and `MAX_BALANCE_ENTRIES` — the same shape `createCategory` in `src/api/categories.ts` returns on success.)

Continue `src/api/accounts.ts` with:

```ts
export async function updateAccount(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { accountId } = params;
  if (!accountId) {
    return err(400, 'accountId is required');
  }

  const existingItem = await queryOne(userId, accountSk(accountId));
  if (!existingItem) {
    return err(404, 'Account not found');
  }
  const existing = existingItem as unknown as Account;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { name, type } = body;
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > NAME_MAX_LENGTH) {
    return err(400, `name must be a non-empty string of at most ${NAME_MAX_LENGTH} characters`);
  }
  if (typeof type !== 'string' || !typesFor(existing.kind).has(type)) {
    return err(400, `type must match the account's existing kind: ${[...typesFor(existing.kind)].join(', ')}`);
  }

  const account: Account = { ...existing, name: name.trim(), type: type as AccountType };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: accountSk(accountId), ...account },
  }));

  return ok({ account });
}

export async function deleteAccount(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { accountId } = params;
  if (!accountId) {
    return err(400, 'accountId is required');
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: accountSk(accountId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}

export async function addBalance(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { accountId } = params;
  if (!accountId) {
    return err(400, 'accountId is required');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { date, pence } = body;
  if (!isValidDate(date) || date > tomorrowIso()) {
    return err(400, 'date must be a YYYY-MM-DD date, at most one day ahead of today');
  }
  if (!isValidPence(pence)) {
    return err(400, `pence must be a positive integer, at most ${MAX_AMOUNT_PENCE}`);
  }

  const existingItem = await queryOne(userId, accountSk(accountId));
  if (!existingItem) {
    return err(404, 'Account not found');
  }
  const existing = existingItem as unknown as Account;

  const balances = applyBalanceEntry(existing.balances ?? [], date, pence);
  if (balances.length > MAX_BALANCE_ENTRIES) {
    return err(400, `an account can have at most ${MAX_BALANCE_ENTRIES} balance entries`);
  }

  const account: Account = { ...existing, balances };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: accountSk(accountId), ...account },
  }));

  return ok({ account });
}
```

In `api-handler.ts`: add `import { getAccounts, createAccount, updateAccount, deleteAccount, addBalance } from './src/api/accounts';` next to the other API imports, and add the routes after the pots routes:

```ts
router.get('/api/accounts', getAccounts);
router.post('/api/accounts', createAccount);
router.put('/api/accounts/{accountId}', updateAccount);
router.delete('/api/accounts/{accountId}', deleteAccount);
router.post('/api/accounts/{accountId}/balances', addBalance);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/api` then `yarn typecheck`
Expected: PASS (existing `pots.test.ts` unaffected, since only an `export` keyword was added to `queryOne`), clean.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/constants.ts src/api/db.ts src/api/pots.ts src/api/accounts.ts src/api/__tests__/accounts.test.ts api-handler.ts
git commit -m "feat: add an accounts API with dated balance history"
git push origin feat/net-worth-accounts
```

---

### Task 2: Client data layer

**Files:**
- Modify: `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`
- Create: `app/lib/accounts.ts`, `app/lib/__tests__/accounts.test.ts`

**Interfaces:**
- Produces (`app/lib/types.ts`): `AccountKind`, `AccountType`, `BalanceEntry`, `Account` — identical shapes to `src/api/types.ts`'s.
- Produces (`app/lib/api.ts`): `getAccounts(): Promise<Account[]>`; `createAccount(input: { name: string; kind: AccountKind; type: AccountType }): Promise<Account>`; `updateAccount(accountId: string, input: { name: string; type: AccountType }): Promise<Account>`; `deleteAccount(accountId: string): Promise<void>`; `addBalance(accountId: string, input: { date: string; pence: number }): Promise<Account>`.
- Produces (`app/lib/queries.ts`): `queryKeys.accounts`; `useAccounts()`; `useCreateAccount()`; `useUpdateAccount()`; `useDeleteAccount()`; `useAddBalance()`.
- Produces (`app/lib/accounts.ts`): `balanceAsOf(entries: BalanceEntry[], date: string): number`; `netWorthAsOf(accounts: Account[], date: string): number`; `monthEndIso(yearMonth: string): string`; `ASSET_TYPE_OPTIONS: { value: AccountType; label: string }[]`; `LIABILITY_TYPE_OPTIONS: { value: AccountType; label: string }[]`; `typeOptionsForKind(kind: AccountKind): { value: AccountType; label: string }[]`; `accountTypeLabel(type: AccountType): string`.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/accounts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { accountTypeLabel, balanceAsOf, monthEndIso, netWorthAsOf, typeOptionsForKind } from '../accounts';
import type { Account, BalanceEntry } from '../types';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '', ...overrides };
}

describe('balanceAsOf', () => {
  const entries: BalanceEntry[] = [{ date: '2026-07-01', pence: 1000 }, { date: '2026-09-01', pence: 3000 }];

  it('is 0 before the first entry and 0 with no entries', () => {
    expect(balanceAsOf(entries, '2026-06-01')).toBe(0);
    expect(balanceAsOf([], '2026-09-01')).toBe(0);
  });

  it('is the last entry at or before the date', () => {
    expect(balanceAsOf(entries, '2026-08-01')).toBe(1000);
    expect(balanceAsOf(entries, '2026-09-01')).toBe(3000);
  });
});

describe('netWorthAsOf', () => {
  it('sums assets and subtracts liabilities', () => {
    const accounts = [
      account({ accountId: 'a', kind: 'ASSET', balances: [{ date: '2026-09-01', pence: 500000 }] }),
      account({ accountId: 'b', kind: 'LIABILITY', type: 'CREDIT_CARD', balances: [{ date: '2026-09-01', pence: 20000 }] }),
    ];
    expect(netWorthAsOf(accounts, '2026-09-15')).toBe(480000);
  });

  it('goes negative when liabilities exceed assets', () => {
    const accounts = [account({ kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 100000 }] })];
    expect(netWorthAsOf(accounts, '2026-09-15')).toBe(-100000);
  });

  it('is 0 for no accounts', () => {
    expect(netWorthAsOf([], '2026-09-15')).toBe(0);
  });
});

describe('monthEndIso', () => {
  it('gives the last calendar day of the month', () => {
    expect(monthEndIso('2026-02')).toBe('2026-02-28');
    expect(monthEndIso('2026-04')).toBe('2026-04-30');
  });
});

describe('typeOptionsForKind', () => {
  it('offers the three asset types for ASSET', () => {
    expect(typeOptionsForKind('ASSET').map(o => o.value)).toEqual(['CASH', 'SAVINGS', 'INVESTMENT']);
  });

  it('offers the two liability types for LIABILITY', () => {
    expect(typeOptionsForKind('LIABILITY').map(o => o.value)).toEqual(['CREDIT_CARD', 'LOAN']);
  });
});

describe('accountTypeLabel', () => {
  it.each([
    ['CASH', 'Cash'], ['SAVINGS', 'Savings'], ['INVESTMENT', 'Investment'],
    ['CREDIT_CARD', 'Credit card'], ['LOAN', 'Loan'],
  ] as const)('%s -> %s', (type, label) => {
    expect(accountTypeLabel(type)).toBe(label);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/accounts.test.ts`
Expected: FAIL (`../accounts` does not exist).

- [ ] **Step 3: Implement**

`app/lib/types.ts`: append the same four type/interface declarations as `src/api/types.ts` in Task 1 (`AccountKind`, `AccountType`, `BalanceEntry`, `Account`) — copy them verbatim.

Create `app/lib/accounts.ts`:

```ts
import { lastDayOfMonth } from './months';
import type { Account, AccountKind, AccountType, BalanceEntry } from './types';

export function balanceAsOf(entries: BalanceEntry[], date: string): number {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let pence = 0;
  for (const entry of sorted) {
    if (entry.date > date) break;
    pence = entry.pence;
  }
  return pence;
}

export function netWorthAsOf(accounts: Account[], date: string): number {
  return accounts.reduce((sum, account) => {
    const balance = balanceAsOf(account.balances, date);
    return account.kind === 'LIABILITY' ? sum - balance : sum + balance;
  }, 0);
}

export function monthEndIso(yearMonth: string): string {
  return `${yearMonth}-${String(lastDayOfMonth(yearMonth)).padStart(2, '0')}`;
}

export const ASSET_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'INVESTMENT', label: 'Investment' },
];

export const LIABILITY_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'LOAN', label: 'Loan' },
];

export function typeOptionsForKind(kind: AccountKind): { value: AccountType; label: string }[] {
  return kind === 'ASSET' ? ASSET_TYPE_OPTIONS : LIABILITY_TYPE_OPTIONS;
}

export function accountTypeLabel(type: AccountType): string {
  return [...ASSET_TYPE_OPTIONS, ...LIABILITY_TYPE_OPTIONS].find(option => option.value === type)?.label ?? type;
}
```

`app/lib/api.ts`: extend the type import with `Account, AccountKind, AccountType`, and add inside the object `createApi` returns, after the pots section:

```ts
    getAccounts: async (): Promise<Account[]> => {
      const res = await request('/api/accounts') as { accounts: Account[] };
      return res.accounts;
    },
    createAccount: async (input: { name: string; kind: AccountKind; type: AccountType }): Promise<Account> => {
      const res = await request('/api/accounts', { method: 'POST', body: JSON.stringify(input) }) as { account: Account };
      return res.account;
    },
    updateAccount: async (accountId: string, input: { name: string; type: AccountType }): Promise<Account> => {
      const res = await request(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }) as { account: Account };
      return res.account;
    },
    deleteAccount: async (accountId: string): Promise<void> => {
      await request(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    },
    addBalance: async (accountId: string, input: { date: string; pence: number }): Promise<Account> => {
      const res = await request(`/api/accounts/${encodeURIComponent(accountId)}/balances`, {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { account: Account };
      return res.account;
    },
```

`app/lib/queries.ts`: add `accounts: ['accounts'] as const,` to `queryKeys`, and add:

```ts
export function useAccounts() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => api.getAccounts(),
    enabled,
  });
}

export function useCreateAccount() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; kind: Account['kind']; type: Account['type'] }) => api.createAccount(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export function useUpdateAccount() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accountId: string; input: { name: string; type: Account['type'] } }) =>
      api.updateAccount(vars.accountId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export function useDeleteAccount() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.deleteAccount(accountId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export function useAddBalance() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accountId: string; input: { date: string; pence: number } }) =>
      api.addBalance(vars.accountId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}
```

(Add `Account` to the existing type import from `./types` in `queries.ts` if it is not already imported.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/lib/types.ts app/lib/api.ts app/lib/queries.ts app/lib/accounts.ts app/lib/__tests__/accounts.test.ts
git commit -m "feat: add the accounts data layer"
git push origin feat/net-worth-accounts
```

---

### Task 3: Navigation — add Accounts to the More sheet

**Files:**
- Modify: `app/components/layout/MoreSheet.tsx`, `app/components/layout/__tests__/MoreSheet.test.tsx`

**Interfaces:**
- Consumes: `MORE_ITEMS` (already exported by `MoreSheet.tsx` from H's Task 3 — read the file first; if its shape differs from what is shown here, follow what is actually on disk).

- [ ] **Step 1: Write the failing test**

Add to `app/components/layout/__tests__/MoreSheet.test.tsx`, inside `describe('MoreSheet')`:

```tsx
  it('lists Accounts after Insights', () => {
    renderSheet();
    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run app/components/layout/__tests__/MoreSheet.test.tsx`
Expected: FAIL (no "Accounts" link).

- [ ] **Step 3: Implement**

In `app/components/layout/MoreSheet.tsx`: add `IconWallet` to the `@tabler/icons-react` import, and add `{ to: '/accounts', label: 'Accounts', Icon: IconWallet },` as the last entry of `MORE_ITEMS`, after the Insights entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean. (`app/routes/accounts.tsx` does not exist until Task 4 — no test clicks through to it yet, so this is fine.)

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/MoreSheet.tsx app/components/layout/__tests__/MoreSheet.test.tsx
git commit -m "feat: add Accounts to the More sheet"
git push origin feat/net-worth-accounts
```

---

### Task 4: Accounts page — list, totals, create, delete

**Files:**
- Create: `app/components/accounts/AccountRow.tsx`, `app/components/accounts/__tests__/AccountRow.test.tsx`, `app/routes/accounts.tsx`, `app/routes/__tests__/accounts.test.tsx`

**Interfaces:**
- Consumes: `useAccounts`, `useCreateAccount`, `useDeleteAccount` (`~/lib/queries`); `balanceAsOf`, `typeOptionsForKind`, `accountTypeLabel` (`~/lib/accounts`); `formatPence` (`~/lib/money`); `todayIso` (`~/lib/months`).
- Produces: `AccountRow({ account, onOpen, onDelete }: { account: Account; onOpen: () => void; onDelete: () => void })`. Route `/accounts`.

- [ ] **Step 1: Write the failing tests**

Create `app/components/accounts/__tests__/AccountRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { AccountRow } from '../AccountRow';
import type { Account } from '~/lib/types';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [{ date: '2026-09-01', pence: 250000 }], createdAt: '', ...overrides };
}

function renderRow(data: Account = account()) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(<MantineProvider><AccountRow account={data} onOpen={onOpen} onDelete={onDelete} /></MantineProvider>);
  return { onOpen, onDelete };
}

describe('AccountRow', () => {
  it('shows the name, type and current balance', () => {
    renderRow();
    expect(screen.getByText('Lloyds')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('£2,500.00')).toBeInTheDocument();
  });

  it('shows £0.00 for an account with no balance entries yet', () => {
    renderRow(account({ balances: [] }));
    expect(screen.getByText('£0.00')).toBeInTheDocument();
  });

  it('opens the account when the row is tapped', async () => {
    const { onOpen } = renderRow();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Lloyds history' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('asks to delete the account from its menu', async () => {
    const { onDelete } = renderRow();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions for Lloyds' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

Create `app/routes/__tests__/accounts.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Account } from '~/lib/types';

const state = vi.hoisted(() => ({
  accounts: [] as Account[],
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useAccounts: () => ({ data: state.accounts, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateAccount: () => ({ mutate: state.create, isPending: false }),
  useDeleteAccount: () => ({ mutate: state.remove, isPending: false }),
}));

import Accounts from '../accounts';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [{ date: '2026-09-01', pence: 250000 }], createdAt: '', ...overrides };
}

function renderPage() {
  return render(<MantineProvider><Accounts /></MantineProvider>);
}

beforeEach(() => {
  state.accounts = [];
  state.create.mockReset();
  state.remove.mockReset();
});

describe('Accounts page', () => {
  it('shows total assets, total liabilities and net worth', () => {
    state.accounts = [
      account({ accountId: 'a', kind: 'ASSET', balances: [{ date: '2026-09-01', pence: 500000 }] }),
      account({ accountId: 'b', kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 100000 }] }),
    ];
    renderPage();
    expect(screen.getByText('£5,000.00')).toBeInTheDocument();
    expect(screen.getByText('£1,000.00')).toBeInTheDocument();
    expect(screen.getByText('£4,000.00')).toBeInTheDocument();
  });

  it('groups accounts under Assets and Liabilities, omitting an empty group', () => {
    state.accounts = [account({ accountId: 'a', kind: 'ASSET' })];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Liabilities' })).not.toBeInTheDocument();
  });

  it('shows an empty state with no accounts', () => {
    renderPage();
    expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  });

  it('creates a new account with the type scoped to the chosen kind', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Name'), 'Trading 212');
    await user.click(screen.getByLabelText('Kind'));
    await user.click(await screen.findByRole('option', { name: 'Liability', hidden: true }));
    await user.click(screen.getByLabelText('Type'));
    expect(screen.queryByRole('option', { name: 'Cash', hidden: true })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'Loan', hidden: true }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Trading 212', kind: 'LIABILITY', type: 'LOAN' });
  });

  it('asks for confirmation before deleting, naming the account', async () => {
    state.accounts = [account({ name: 'Premium Bonds' })];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Actions for Premium Bonds' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete account' });
    expect(within(dialog).getByText("Delete Premium Bonds? This can't be undone.")).toBeInTheDocument();
    expect(state.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(state.remove).toHaveBeenCalledWith('acc-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/accounts app/routes/__tests__/accounts.test.tsx`
Expected: FAIL (`AccountRow` and `../accounts` do not exist).

- [ ] **Step 3: Implement**

Create `app/components/accounts/AccountRow.tsx`:

```tsx
import { ActionIcon, Card, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import { accountTypeLabel, balanceAsOf } from '~/lib/accounts';
import { todayIso } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { Account } from '~/lib/types';

export function AccountRow({ account, onOpen, onDelete }: { account: Account; onOpen: () => void; onDelete: () => void }) {
  const balance = balanceAsOf(account.balances, todayIso());

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" wrap="nowrap" align="center">
        <UnstyledButton onClick={onOpen} aria-label={`Open ${account.name} history`} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={500}>{account.name}</Text>
          <Text size="xs" c="dimmed">{accountTypeLabel(account.type)}</Text>
        </UnstyledButton>
        <Text fw={700}>{formatPence(balance)}</Text>
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" aria-label={`Actions for ${account.name}`}><IconDots size={16} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={onDelete}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Card>
  );
}
```

Create `app/routes/accounts.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { AccountRow } from '~/components/accounts/AccountRow';
import { balanceAsOf, netWorthAsOf, typeOptionsForKind } from '~/lib/accounts';
import { todayIso } from '~/lib/months';
import { formatPence } from '~/lib/money';
import { useAccounts, useCreateAccount, useDeleteAccount } from '~/lib/queries';
import type { Account, AccountKind, AccountType } from '~/lib/types';

function AccountsContent() {
  const accounts = useAccounts();
  const create = useCreateAccount();
  const remove = useDeleteAccount();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('ASSET');
  const [type, setType] = useState<AccountType>('CASH');
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  if (accounts.error) {
    return (
      <Alert color="danger" title="Could not load accounts">
        <Button onClick={() => accounts.refetch()}>Try again</Button>
      </Alert>
    );
  }
  if (accounts.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = accounts.data ?? [];
  const today = todayIso();
  const assets = all.filter(a => a.kind === 'ASSET');
  const liabilities = all.filter(a => a.kind === 'LIABILITY');
  const totalAssets = netWorthAsOf(assets, today);
  const totalLiabilities = liabilities.reduce((sum, account) => sum + balanceAsOf(account.balances, today), 0);
  const netWorth = totalAssets - totalLiabilities;

  return (
    <Stack>
      <Title order={3}>Accounts</Title>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Text>Assets: {formatPence(totalAssets)}</Text>
        <Text>Liabilities: {formatPence(totalLiabilities)}</Text>
        <Text fw={700}>Net worth: {formatPence(netWorth)}</Text>
      </SimpleGrid>

      <Group align="flex-end">
        <TextInput label="Name" placeholder="e.g. Lloyds" style={{ flex: 1, minWidth: 160 }}
          value={name} onChange={e => setName(e.currentTarget.value)} />
        <Select
          label="Kind"
          data={[{ value: 'ASSET', label: 'Asset' }, { value: 'LIABILITY', label: 'Liability' }]}
          value={kind}
          onChange={v => {
            const next = v as AccountKind;
            setKind(next);
            setType(typeOptionsForKind(next)[0].value);
          }}
          allowDeselect={false}
        />
        <Select label="Type" data={typeOptionsForKind(kind)} value={type}
          onChange={v => { if (v) setType(v as AccountType); }} allowDeselect={false} />
        <Button
          disabled={name.trim() === ''}
          loading={create.isPending}
          onClick={() => {
            create.mutate({ name: name.trim(), kind, type });
            setName('');
          }}
        >
          Add
        </Button>
      </Group>

      {all.length === 0 && <Text c="dimmed">No accounts yet. Add one above.</Text>}

      {assets.length > 0 && (
        <div>
          <Title order={5} mt="md" mb="xs">Assets</Title>
          {assets.map(account => (
            <AccountRow key={account.accountId} account={account} onOpen={() => {}} onDelete={() => setPendingDelete(account)} />
          ))}
        </div>
      )}

      {liabilities.length > 0 && (
        <div>
          <Title order={5} mt="md" mb="xs">Liabilities</Title>
          {liabilities.map(account => (
            <AccountRow key={account.accountId} account={account} onOpen={() => {}} onDelete={() => setPendingDelete(account)} />
          ))}
        </div>
      )}

      <Modal opened={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete account" centered>
        <Stack>
          <Text>Delete {pendingDelete?.name}? This can't be undone.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button color="danger" onClick={() => {
              if (!pendingDelete) return;
              remove.mutate(pendingDelete.accountId);
              setPendingDelete(null);
            }}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default function Accounts() {
  return (
    <DefaultLayout>
      <AccountsContent />
    </DefaultLayout>
  );
}
```

**Note:** `onOpen={() => {}}` above is a deliberate placeholder for this task only — Task 5 replaces both instances with a real handler that opens the history sheet, and adds the state and sheet component that make it work. Do not treat the empty handler as final; it exists so this task's own tests (which only exercise the Actions menu and the create/delete flow, not the row-tap-to-open behaviour) pass without Task 5's code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/accounts/AccountRow.tsx app/components/accounts/__tests__/AccountRow.test.tsx app/routes/accounts.tsx app/routes/__tests__/accounts.test.tsx
git commit -m "feat: add the Accounts page with totals, create and delete"
git push origin feat/net-worth-accounts
```

---

### Task 5: Update-balance form and account history sheet

**Files:**
- Create: `app/components/accounts/UpdateBalanceSheet.tsx`, `app/components/accounts/__tests__/UpdateBalanceSheet.test.tsx`, `app/components/accounts/AccountHistorySheet.tsx`, `app/components/accounts/__tests__/AccountHistorySheet.test.tsx`
- Modify: `app/components/accounts/AccountRow.tsx`, `app/components/accounts/__tests__/AccountRow.test.tsx`, `app/routes/accounts.tsx`, `app/routes/__tests__/accounts.test.tsx`

**Interfaces:**
- Consumes: `useAddBalance` (`~/lib/queries`); `parsePounds`, `formatPence` (`~/lib/money`); `todayIso`, `formatShortDate` (`~/lib/months`); `LineChart` (`@mantine/charts`).
- Produces: `UpdateBalanceSheet({ account, onClose }: { account: Account | null; onClose: () => void })`; `AccountHistorySheet({ account, onClose, onUpdate }: { account: Account | null; onClose: () => void; onUpdate: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `app/components/accounts/__tests__/UpdateBalanceSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { UpdateBalanceSheet } from '../UpdateBalanceSheet';
import type { Account } from '~/lib/types';

const save = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('~/lib/queries', () => ({ useAddBalance: () => ({ mutate: save.mutate, isPending: false }) }));

const account: Account = { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '' };

function renderSheet(data: Account | null = account) {
  const onClose = vi.fn();
  render(<MantineProvider><UpdateBalanceSheet account={data} onClose={onClose} /></MantineProvider>);
  return onClose;
}

beforeEach(() => { save.mutate.mockReset(); });

describe('UpdateBalanceSheet', () => {
  it('renders nothing without an account', () => {
    renderSheet(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults the date to today', () => {
    renderSheet();
    expect(screen.getByLabelText('Date')).toHaveValue(expect.stringContaining('/'));
  });

  it('saves the entered amount and date', async () => {
    const user = userEvent.setup();
    const onClose = renderSheet();
    await user.type(screen.getByLabelText('Balance'), '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(save.mutate).toHaveBeenCalledWith(
      { accountId: 'acc-1', input: { date: expect.any(String), pence: 250000 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    save.mutate.mock.calls[0][1].onSuccess();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and does not save for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText('Balance'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an error when the save fails', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText('Balance'), '100');
    save.mutate.mockImplementation((_vars, options) => options.onError(new Error('boom')));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

Create `app/components/accounts/__tests__/AccountHistorySheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { AccountHistorySheet } from '../AccountHistorySheet';
import type { Account } from '~/lib/types';

function account(overrides: Partial<Account> = {}): Account {
  return {
    accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH',
    balances: [{ date: '2026-08-01', pence: 200000 }, { date: '2026-09-01', pence: 250000 }],
    createdAt: '', ...overrides,
  };
}

function renderSheet(data: Account | null) {
  const onClose = vi.fn();
  const onUpdate = vi.fn();
  render(<MantineProvider><AccountHistorySheet account={data} onClose={onClose} onUpdate={onUpdate} /></MantineProvider>);
  return { onClose, onUpdate };
}

describe('AccountHistorySheet', () => {
  it('renders nothing without an account', () => {
    renderSheet(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the current balance and every entry newest first', () => {
    renderSheet(account());
    const dialog = screen.getByRole('dialog', { name: 'Lloyds' });
    expect(dialog).toHaveTextContent('£2,500.00');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('£2,500.00');
    expect(rows[1]).toHaveTextContent('£2,000.00');
  });

  it('shows a message instead of a table when there is no history', () => {
    renderSheet(account({ balances: [] }));
    expect(screen.getByText('No balance history yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('opens the update form when Update is tapped', async () => {
    renderSheet(account());
    const { onUpdate } = renderSheet(account());
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Update' })[1]);
    expect(onUpdate).toHaveBeenCalled();
  });
});
```

Add to `app/components/accounts/__tests__/AccountRow.test.tsx`:

```tsx
  it('opens the update form from its own button, separately from opening history', async () => {
    const onUpdate = vi.fn();
    const onOpen = vi.fn();
    render(<MantineProvider><AccountRow account={account()} onOpen={onOpen} onDelete={vi.fn()} onUpdate={onUpdate} /></MantineProvider>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update Lloyds' }));
    expect(onUpdate).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
```

Update `app/routes/__tests__/accounts.test.tsx`'s create-account test's mock to also include `useAddBalance: () => ({ mutate: vi.fn(), isPending: false })` in the `~/lib/queries` mock (it will be needed once the page renders the new sheets), and add:

```tsx
  it('opens the history sheet when a row is tapped, and the update sheet from its own button', async () => {
    state.accounts = [account()];
    const user = renderInsightsStyleUser();
    await user.click(screen.getByRole('button', { name: 'Open Lloyds history' }));
    expect(await screen.findByRole('dialog', { name: 'Lloyds' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));

    await user.click(screen.getByRole('button', { name: 'Update Lloyds' }));
    expect(await screen.findByLabelText('Balance')).toBeInTheDocument();
  });
```

(Add a small helper near the top of the file: `function renderInsightsStyleUser() { renderPage(); return userEvent.setup(); }` — the name mirrors the convention used elsewhere in this codebase for a "render then get a user" helper; call it whatever reads best in this file as long as it renders the page and returns a `userEvent` instance.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/accounts app/routes/__tests__/accounts.test.tsx`
Expected: FAIL (`UpdateBalanceSheet`/`AccountHistorySheet` do not exist; `AccountRow` has no `onUpdate` prop yet).

- [ ] **Step 3: Implement**

Create `app/components/accounts/UpdateBalanceSheet.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, Group, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { parsePounds } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useAddBalance } from '~/lib/queries';
import type { Account } from '~/lib/types';

export function UpdateBalanceSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const save = useAddBalance();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!account) return;
    const parsed = parsePounds(amount);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    save.mutate(
      { accountId: account.accountId, input: { date, pence: parsed.pence } },
      { onSuccess: onClose, onError: () => setError('Could not save. Try again.') },
    );
  }

  return (
    <ResponsiveSheet opened={account !== null} onClose={onClose} title={account ? `Update ${account.name}` : 'Update balance'}>
      {account && (
        <form onSubmit={submit}>
          <Stack gap="sm">
            <DateInput label="Date" valueFormat="DD/MM/YYYY" value={date} onChange={value => setDate(value ?? todayIso())} />
            <TextInput label="Balance" placeholder="0.00" leftSection="£" inputMode="decimal"
              value={amount} onChange={e => setAmount(e.currentTarget.value)} />
            {error && <Alert color="danger" role="alert">{error}</Alert>}
            <Group justify="flex-end">
              <Button type="submit" loading={save.isPending}>Save</Button>
            </Group>
          </Stack>
        </form>
      )}
    </ResponsiveSheet>
  );
}
```

(This follows `PotHistorySheet.tsx`'s settings-form pattern exactly: a labelled `TextInput` for the amount with no `error` prop of its own, and a separate `Alert` with `role="alert"` below the fields for the save-time error message — read that file if anything here is ambiguous.)

Create `app/components/accounts/AccountHistorySheet.tsx`:

```tsx
import { LineChart } from '@mantine/charts';
import { Button, Group, Stack, Table, Text } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { balanceAsOf } from '~/lib/accounts';
import { formatPence } from '~/lib/money';
import { formatShortDate, todayIso } from '~/lib/months';
import type { Account } from '~/lib/types';

export function AccountHistorySheet({
  account, onClose, onUpdate,
}: {
  account: Account | null;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const entries = account ? [...account.balances].reverse() : [];
  const balance = account ? balanceAsOf(account.balances, todayIso()) : 0;

  return (
    <ResponsiveSheet opened={account !== null} onClose={onClose} title={account?.name ?? 'Account'}>
      {account && (
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed">Balance</Text>
              <Text fw={700} size="xl">{formatPence(balance)}</Text>
            </div>
            <Button size="compact-sm" onClick={onUpdate}>Update</Button>
          </Group>

          {account.balances.length === 0 ? (
            <Text c="dimmed" size="sm">No balance history yet.</Text>
          ) : (
            <>
              <LineChart
                h={160}
                data={account.balances.map(entry => ({ date: formatShortDate(entry.date), Balance: entry.pence }))}
                dataKey="date"
                series={[{ name: 'Balance', color: 'teal.6' }]}
                valueFormatter={formatPence}
                withDots={false}
              />
              <Table>
                <Table.Thead>
                  <Table.Tr><Table.Th>Date</Table.Th><Table.Th>Balance</Table.Th></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {entries.map(entry => (
                    <Table.Tr key={entry.date}>
                      <Table.Td>{formatShortDate(entry.date)}</Table.Td>
                      <Table.Td>{formatPence(entry.pence)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
```

Update `app/components/accounts/AccountRow.tsx`: add `onUpdate: () => void;` to the props type, destructure it, and add an "Update" button next to the balance, before the Menu:

```tsx
        <Button size="compact-sm" variant="light" onClick={onUpdate} aria-label={`Update ${account.name}`}>Update</Button>
```

(Add `Button` to the existing `@mantine/core` import.)

In `app/routes/accounts.tsx`: import `UpdateBalanceSheet` and `AccountHistorySheet`; add state `const [openAccount, setOpenAccount] = useState<Account | null>(null);` and `const [updatingAccount, setUpdatingAccount] = useState<Account | null>(null);`. Change both `AccountRow` usages' `onOpen={() => {}}` to `onOpen={() => setOpenAccount(account)}` and add `onUpdate={() => setUpdatingAccount(account)}`. Render, after the delete `Modal`:

```tsx
      <AccountHistorySheet
        account={openAccount}
        onClose={() => setOpenAccount(null)}
        onUpdate={() => { setUpdatingAccount(openAccount); setOpenAccount(null); }}
      />
      <UpdateBalanceSheet account={updatingAccount} onClose={() => setUpdatingAccount(null)} />
```

`openAccount`/`updatingAccount` hold stale data once `accounts` refetches after a mutation (the object reference from the list at open time). This is acceptable for this plan (the sheet closes on a successful update, so it is short-lived), but note it in your self-review as a candidate follow-up rather than silently fixing it with more state than the plan asks for.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/accounts/UpdateBalanceSheet.tsx app/components/accounts/__tests__/UpdateBalanceSheet.test.tsx app/components/accounts/AccountHistorySheet.tsx app/components/accounts/__tests__/AccountHistorySheet.test.tsx app/components/accounts/AccountRow.tsx app/components/accounts/__tests__/AccountRow.test.tsx app/routes/accounts.tsx app/routes/__tests__/accounts.test.tsx
git commit -m "feat: add balance updates and account history"
git push origin feat/net-worth-accounts
```

---

### Task 6: Net worth on Insights

**Files:**
- Create: `app/components/insights/NetWorth.tsx`, `app/components/insights/__tests__/NetWorth.test.tsx`
- Modify: `app/routes/insights.tsx`, `app/routes/__tests__/insights.test.tsx`

**Interfaces:**
- Consumes: `useAccounts` (`~/lib/queries`); `netWorthAsOf`, `monthEndIso` (`~/lib/accounts`); `monthsInPeriod` (`~/lib/insights`, from H); `LineChart` (`@mantine/charts`); `formatPence` (`~/lib/money`); `formatMonthLabel` (`~/lib/months`).
- Produces: `NetWorth({ accounts, months }: { accounts: Account[]; months: string[] })`.

**Before starting:** read `app/routes/insights.tsx` as it exists on disk right now. H's plan (Tasks 4–6) builds this file up section by section (span control, summary row, group breakdown, monthly trend, biggest movers, targets, pots), each ending with `<Title order={5} mt="md">...</Title>` followed by its section's component. This task assumes H's Task 6 has landed and the file ends with the Pots section. If H's work on this branch's ancestor is not yet at that point, treat the file as it actually is: add the Net worth section as the **last** section, after whatever the file currently ends with, following the exact same `<Title order={5} mt="md">Heading</Title>` plus component pattern the file already uses for every other section.

- [ ] **Step 1: Write the failing tests**

Create `app/components/insights/__tests__/NetWorth.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { NetWorth } from '../NetWorth';
import type { Account } from '~/lib/types';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'a', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '', ...overrides };
}

describe('NetWorth', () => {
  it('shows the current net worth and a change since the start of the span', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ balances: [{ date: '2026-07-01', pence: 100000 }, { date: '2026-09-15', pence: 150000 }] }),
    ]} months={['2026-07', '2026-08', '2026-09']} /></MantineProvider>);
    expect(screen.getByText('£1,500.00')).toBeInTheDocument();
    expect(screen.getByText('+£500.00')).toBeInTheDocument();
  });

  it('shows a negative net worth clearly when liabilities exceed assets', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 50000 }] }),
    ]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText('−£500.00')).toBeInTheDocument();
  });

  it('shows a message instead of a chart with no accounts', () => {
    render(<MantineProvider><NetWorth accounts={[]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  });
});
```

Add to `app/routes/__tests__/insights.test.tsx`: extend the `~/lib/queries` mock with `useAccounts: () => ({ data: data.accounts, isLoading: false, error: null, refetch: vi.fn() })`, add `accounts: [] as unknown[]` to the hoisted `data` object and reset it to `[]` in `beforeEach`, and add:

```tsx
  it('shows the Net worth section', () => {
    data.accounts = [{ accountId: 'a', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [{ date: '2026-09-01', pence: 100000 }], createdAt: '' }];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Net worth' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/insights/__tests__/NetWorth.test.tsx app/routes/__tests__/insights.test.tsx`
Expected: FAIL (`NetWorth` does not exist; the route test has no Net worth heading).

- [ ] **Step 3: Implement**

Create `app/components/insights/NetWorth.tsx`:

```tsx
import { LineChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import { monthEndIso, netWorthAsOf } from '~/lib/accounts';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { Account } from '~/lib/types';

function formatSigned(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : `+${formatPence(pence)}`;
}

export function NetWorth({ accounts, months }: { accounts: Account[]; months: string[] }) {
  if (accounts.length === 0) {
    return <Text c="dimmed" size="sm">No accounts yet. Add one on the Accounts page.</Text>;
  }

  const trend = months.map(yearMonth => ({
    yearMonth,
    netWorth: netWorthAsOf(accounts, monthEndIso(yearMonth)),
  }));
  const current = trend[trend.length - 1]?.netWorth ?? 0;
  const start = netWorthAsOf(accounts, monthEndIso(months[0]));

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={700} size="lg" c={current < 0 ? 'danger' : undefined}>{current < 0 ? `−${formatPence(-current)}` : formatPence(current)}</Text>
        <Text size="sm" c={current - start >= 0 ? 'teal' : 'red'}>{formatSigned(current - start)}</Text>
      </Group>
      <LineChart
        h={180}
        data={trend.map(row => ({ month: formatMonthLabel(row.yearMonth), 'Net worth': row.netWorth }))}
        dataKey="month"
        series={[{ name: 'Net worth', color: 'teal.6' }]}
        valueFormatter={formatPence}
        withDots={false}
      />
    </Stack>
  );
}
```

In `app/routes/insights.tsx`: add `import { NetWorth } from '~/components/insights/NetWorth';` and `import { useAccounts } from '~/lib/queries';`. Add `const accounts = useAccounts();` alongside the page's other data hooks. Render, as the last section of the page (after whatever section the file currently ends with — see this task's note above):

```tsx
      <Title order={5} mt="md">Net worth</Title>
      <NetWorth accounts={accounts.data ?? []} months={monthsInPeriod(current)} />
```

`accounts` must not gate the page's shared loading/error state (the same rule H's Pots section follows for `usePots`) — if `accounts.isLoading` or `accounts.error` is true, the section simply has nothing to show yet; do not add it to the page's existing `if (... .isLoading)` or `if (... .error)` conditions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/insights/NetWorth.tsx app/components/insights/__tests__/NetWorth.test.tsx app/routes/insights.tsx app/routes/__tests__/insights.test.tsx
git commit -m "feat: show net worth on the Insights page"
git push origin feat/net-worth-accounts
```

---

### Task 7: Real-browser verification (no repo changes)

**Files:** none in the repo. Scratch files and screenshots go in a scratch directory outside the repo.

- [ ] **Step 1: Build and serve, sign in, stub the API**

Follow the recipe already recorded from F1/F2/G/H: install `playwright` in the scratch directory and use its Chromium; run `yarn dev`; seed the Auth0 React SDK's `localStorage` cache for a dummy client/audience so `isAuthenticated` is true; stub `/api/*` with canned JSON, including `/api/accounts` returning at least one asset and one liability, each with a few dated balance entries spanning several months, and stubbing `POST`/`PUT`/`DELETE` on `/api/accounts*` to echo a plausible response.

- [ ] **Step 2: Verify the Accounts page**

At 390px and 1280px: the totals line, the Assets and Liabilities groups, creating an account with the type list correctly scoped to the chosen kind, tapping a row opens its history sheet with a real chart and table, the Update button opens the smaller balance form separately from the history sheet, and deleting asks for confirmation naming the account.

- [ ] **Step 3: Verify Net worth on Insights**

At both widths: the Net worth section shows a current figure, a change indicator, and a real chart; with the stubbed liability larger than the stubbed assets, confirm the figure renders with a visible minus sign, not just a smaller number; the section does not block the rest of the page from rendering if `/api/accounts` is deliberately made to fail in one pass.

- [ ] **Step 4: Report**

Write `REPORT.md` in the scratch directory with a pass/fail per check above, screenshot names, and any defect found. Paste the same summary into your final message. If you could not run a browser, say exactly what you tried and skip this task.

---

### Task 8: Roadmap and docs

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Update the roadmap**

In `docs/ROADMAP.md`:
- If the H row is not already marked merged (check first — H may have merged before this task runs), leave it as-is; this task only adds I.
- Change the I row to `Implemented on `feat/net-worth-accounts` (PR pending). Spec: `superpowers/specs/2026-09-27-net-worth-accounts-design.md`, plan: `superpowers/plans/2026-09-27-net-worth-accounts.md``.
- Add a `## I: Net worth and accounts` section, in the same Built / Decisions / Follow-ups structure as the other sections:
  - **Built:** an accounts API (`GET/POST /api/accounts`, `PUT/DELETE /api/accounts/{accountId}`, `POST /api/accounts/{accountId}/balances`) storing dated balance entries per account; an Accounts page (More sheet) listing assets and liabilities with totals, per-account history and a trend chart, and hand-entered balance updates; a Net worth section on the Insights page.
  - **Decisions:** balances are manually entered, dated points, never auto-fetched (see `docs/DECISIONS.md`'s bank-sync entry); every account is a fixed Asset or Liability, with a small fixed type list per kind; a liability is entered as a positive amount owed and subtracted when computing net worth; net worth is a stock figure on its own section, not folded into the flow-based summary row.
  - **Follow-ups:** attaching accounts to transactions so balances are derived rather than entered; multi-currency; a finer breakdown than the asset/liability split; reminders to update a stale account; the `openAccount`/`updatingAccount` stale-reference note from Task 5.

- [ ] **Step 2: Verify**

Run: `yarn test && yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: record net worth and accounts in the roadmap"
git push origin feat/net-worth-accounts
```

## Verification after all tasks (controller, not a task)

- `yarn test`, `yarn typecheck`; review the Task 7 report and screenshots.
- Whole-branch review on the most capable model, then the SECURITY.md pre-PR checklist (IO-01 for the accounts API), then hand the PR back for merge — noting that this branch should be rebased onto `main` once both F2→G→H have merged ahead of it, since it was stacked on H's still-open branch.
