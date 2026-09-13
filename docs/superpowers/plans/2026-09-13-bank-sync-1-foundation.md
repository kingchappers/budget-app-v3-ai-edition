# Bank Sync 1 — Sync Foundation & Enable Banking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import booked GBP transactions from Enable Banking into a review inbox on a schedule and on demand, and let the user confirm or ignore them into the existing budget.

**Architecture:** A new bank worker Lambda (`sync-handler.ts`) owns the Enable Banking private key and all bank calls. It runs `runSync` (platform-agnostic, in `src/sync/`) every 6 hours and executes a small set of validated commands invoked by the existing API Lambda. Data lives in the existing DynamoDB single table; duplicate prevention is a permanent `SEEN#` marker written in the same transaction as each inbox item.

**Tech Stack:** TypeScript, Node 24 Lambda, DynamoDB (`@aws-sdk/lib-dynamodb`), `@aws-sdk/client-lambda`, `@aws-sdk/client-secrets-manager`, `jsonwebtoken`, Vitest, React 19 + React Router 8 + Mantine 8 + TanStack Query, OpenTofu.

**Spec:** `docs/superpowers/specs/2026-09-13-bank-sync-1-foundation-design.md` (build order: `docs/superpowers/plans/2026-09-13-bank-sync-build-order.md`)

## Global Constraints

- Amounts are positive integer pence everywhere; never parse money with floating point.
- GBP accounts and transactions only; country allowlist `['GB']`.
- Booked transactions only (`transaction_status=BOOK`).
- Sync window: `from = max(startDate, date(lastSyncedAt) − 5 days)`, `to = today`.
- Lock stale after 10 minutes; skip an account if under 60 s remain before the deadline; connection `ERROR` at 3 consecutive failed runs.
- Manual sync: 409 while `RUNNING` (started < 10 min ago), 429 if finished < 5 min ago.
- Pending auth TTL 15 minutes; consent requested = `min(bank maximum, 180 days)`.
- Transaction descriptions: control characters stripped, whitespace collapsed, max 200 chars.
- Worker Lambda: timeout 300 s, memory 256 MB, async retries 0, schedule `rate(6 hours)`.
- Log groups: 14-day retention. Logs are JSON with ids, counts, error types and durations only — never codes, states, session ids, tokens, secrets, amounts, descriptions, account numbers or request/response bodies (AUTH-06, SEC-06, LOG-04).
- Every new API route validates input with exact key allowlists (IO-01/02/07) and derives `userId` only from the verified JWT `sub` (AUTH-04).
- No new third-party runtime libraries beyond `@aws-sdk/client-lambda` and `@aws-sdk/client-secrets-manager`.
- TDD for every task: failing test first, then implementation. `yarn test` and `yarn typecheck` pass at every commit.
- Conventional commits; end each commit message with the session attribution lines configured for this repo.

## Deviations From the Spec (update the spec in Task 23)

1. **The worker owns pending-auth persistence.** The API validates HTTP input and forwards; the worker generates `state`, writes/reads `BANKAUTH#`, and writes connections. This keeps all bank-flow state changes in one place.
2. **`ConnectedAccount.dedupeId`** (the first-seen `accountUid`) is used for dedupe keys, so a bank issuing new account ids on reconnect does not re-import the 5-day overlap as duplicates.
3. **Custom log group names** (`/${app_name}/lambda/{static,api,worker}`) set via Lambda `logging_config`, so fresh deployments and the existing deployment both work without importing the auto-created `/aws/lambda/*` groups.
4. **`app_base_url` defaults to the API Gateway invoke URL** when left empty.
5. **Frontend tests exist** (Vitest `app` project with jsdom and Testing Library); new UI logic gets tests.
6. **`consecutiveFailures` increments at most once per connection per run.**
7. **Worker IAM also needs `dynamodb:BatchWriteItem`** (bulk delete of pending items on disconnect).

## File Map

**Create — sync core (`src/sync/`)**
- `types.ts` — shared sync types
- `errors.ts` — `ProviderError`, classification
- `amount.ts` — `parseAmountToPence`
- `window.ts` — `syncWindow`, `addDays`
- `txnKey.ts` — `deriveTxnKeys`
- `accounts.ts` — `matchAccounts`
- `chunk.ts` — `chunk`
- `log.ts` — `Logger`, `jsonLogger`
- `store.ts` — `SyncStore` interface
- `stores/dynamoSyncStore.ts` — DynamoDB `SyncStore`
- `providers/enableBankingNormalise.ts` — raw transaction → `ProviderTransaction`
- `providers/enableBankingClient.ts` — JWT source + HTTP client
- `providers/enableBanking.ts` — Enable Banking provider + connect API
- `runSync.ts` — sync algorithm
- `commands.ts` — worker command parsing and execution
- `secrets.ts` — load Enable Banking credentials
- `__tests__/fakes.ts` — `FakeSyncStore`, `FakeProvider`, builders

**Create — API (`src/api/`)**
- `body.ts` — JSON body and validation helpers
- `dynamoErrors.ts` — DynamoDB error helpers
- `worker.ts` — invoke the worker Lambda
- `banks.ts` — `/api/banks/*`, `/api/sync*`
- `inbox.ts` — `/api/inbox*`

**Create — other**
- `sync-handler.ts` — worker Lambda entry
- `infra/sync-lambda.tf` — worker, secret, schedule, invoke permission
- `infra/logs.tf` — log groups
- Frontend: `app/lib/apiError.ts`, `app/lib/transactionTypes.ts`, `app/lib/banks.ts`, `app/lib/sync.ts`, `app/lib/bankCallback.ts`, `app/components/banks/{BankCallback,ConnectBankModal,ConnectionCard,SyncNowButton,AttentionBanner}.tsx`, `app/components/inbox/InboxRow.tsx`, `app/routes/{banks,banks.callback,inbox}.tsx`

**Modify**
- `src/api/types.ts`, `src/api/db.ts`, `src/api/transactions.ts`, `api-handler.ts`
- `scripts/build-api-handler.cjs`, `package.json`, `.gitignore`
- `infra/lambda.tf`, `infra/api-lambda.tf`, `infra/dynamodb.tf`, `infra/variables.tf`
- `app/hooks/useProtectedApi.ts`, `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`, `app/components/layout/DefaultLayout.tsx`, `app/components/transactions/TransactionSheet.tsx`

---

## Phase A — Pure sync core

### Task 1: Validation helpers, sync types and provider errors

**Files:**
- Create: `src/api/body.ts`, `src/sync/errors.ts`, `src/sync/types.ts`
- Modify: `src/api/types.ts`
- Test: `src/api/__tests__/body.test.ts`, `src/sync/__tests__/errors.test.ts`

**Interfaces:**
- Produces: `isRecord`, `hasOnlyKeys`, `parseJsonBody`, `UUID_RE`, `DATE_RE` (body.ts); `ProviderError`, `ProviderErrorType`, `classifyHttpStatus`, `classifyProviderError` (errors.ts); all types in `src/sync/types.ts`; optional `source`/`bankRef` on `Transaction`.

- [ ] **Step 1: Write the failing tests**

`src/api/__tests__/body.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { hasOnlyKeys, isRecord, parseJsonBody, UUID_RE, DATE_RE } from '../body';

const event = (body?: string) => ({ body } as unknown as APIGatewayProxyEventV2);

describe('isRecord', () => {
  it('accepts plain objects and rejects arrays, null and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('hasOnlyKeys', () => {
  it('requires every required key', () => {
    expect(hasOnlyKeys({ a: 1 }, ['a', 'b'])).toBe(false);
  });

  it('rejects keys outside required and optional', () => {
    expect(hasOnlyKeys({ a: 1, c: 2 }, ['a'], ['b'])).toBe(false);
  });

  it('accepts required plus optional keys', () => {
    expect(hasOnlyKeys({ a: 1, b: 2 }, ['a'], ['b'])).toBe(true);
  });
});

describe('parseJsonBody', () => {
  it('returns the object for a JSON object body', () => {
    expect(parseJsonBody(event('{"a":1}'))).toEqual({ a: 1 });
  });

  it('treats a missing body as an empty object', () => {
    expect(parseJsonBody(event(undefined))).toEqual({});
  });

  it('returns null for invalid JSON or non-object JSON', () => {
    expect(parseJsonBody(event('{nope'))).toBeNull();
    expect(parseJsonBody(event('[1]'))).toBeNull();
  });
});

describe('patterns', () => {
  it('matches UUIDs and ISO dates', () => {
    expect(UUID_RE.test('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
    expect(DATE_RE.test('2026-09-13')).toBe(true);
    expect(DATE_RE.test('13/09/2026')).toBe(false);
  });
});
```

`src/sync/__tests__/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ProviderError, classifyHttpStatus, classifyProviderError } from '../errors';

describe('classifyHttpStatus', () => {
  it.each([
    [401, 'EXPIRED'],
    [403, 'EXPIRED'],
    [429, 'RATE_LIMITED'],
    [500, 'TRANSIENT'],
    [503, 'TRANSIENT'],
    [400, 'INVALID_RESPONSE'],
    [404, 'INVALID_RESPONSE'],
  ])('maps %i to %s', (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });
});

describe('classifyProviderError', () => {
  it('returns the type of a ProviderError', () => {
    expect(classifyProviderError(new ProviderError('RATE_LIMITED', 'slow down'))).toBe('RATE_LIMITED');
  });

  it('treats any other error as transient', () => {
    expect(classifyProviderError(new TypeError('fetch failed'))).toBe('TRANSIENT');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api/__tests__/body.test.ts src/sync/__tests__/errors.test.ts`
Expected: FAIL — cannot resolve `../body` and `../errors`.

- [ ] **Step 3: Implement**

`src/api/body.ts`:
```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => key in value) && Object.keys(value).every(key => allowed.has(key));
}

export function parseJsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(event.body || '{}');
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
```

`src/sync/errors.ts`:
```ts
export type ProviderErrorType = 'EXPIRED' | 'RATE_LIMITED' | 'TRANSIENT' | 'INVALID_RESPONSE';

export class ProviderError extends Error {
  readonly type: ProviderErrorType;

  constructor(type: ProviderErrorType, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.type = type;
  }
}

export function classifyHttpStatus(status: number): ProviderErrorType {
  if (status === 401 || status === 403) return 'EXPIRED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'TRANSIENT';
  return 'INVALID_RESPONSE';
}

export function classifyProviderError(error: unknown): ProviderErrorType {
  return error instanceof ProviderError ? error.type : 'TRANSIENT';
}
```

`src/sync/types.ts`:
```ts
import type { TransactionType } from '../api/types';
import type { ProviderErrorType } from './errors';

export type ProviderId = 'enable-banking';
export type Direction = 'IN' | 'OUT';
export type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'ERROR';
export type SeenOutcome = 'PENDING' | 'CONFIRMED' | 'IGNORED';

export interface PsuContext {
  ipAddress: string;
  userAgent: string;
}

export interface ConnectedAccount {
  accountUid: string;
  dedupeId: string;
  displayName: string;
  last4: string;
  currency: string;
  startDate: string;
  lastSyncedAt?: string;
}

interface ConnectionBase {
  connectionId: string;
  displayName: string;
  status: ConnectionStatus;
  consecutiveFailures: number;
  lastError?: { type: ProviderErrorType; at: string };
  accounts: ConnectedAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface EnableBankingConnection extends ConnectionBase {
  provider: 'enable-banking';
  auth: { sessionId: string; consentValidUntil: string };
}

export type Connection = EnableBankingConnection;

export interface ProviderTransaction {
  entryReference: string | null;
  amountPence: number;
  direction: Direction;
  bookingDate: string;
  description: string;
  currency: string;
  fallbackBasis: string;
}

export interface SyncWindow {
  from: string;
  to: string;
}

export interface FetchContext {
  psu?: PsuContext;
  deadline: number;
}

export interface BankProvider {
  id: ProviderId;
  fetchTransactions(
    connection: Connection,
    account: ConnectedAccount,
    window: SyncWindow,
    ctx: FetchContext,
  ): Promise<ProviderTransaction[]>;
}

export interface InboxItem {
  txnKey: string;
  amount: number;
  direction: Direction;
  suggestedType: Extract<TransactionType, 'INCOME' | 'EXPENSE'>;
  description: string;
  bookingDate: string;
  connectionId: string;
  accountUid: string;
  importedAt: string;
  suggestion?: { type: TransactionType; categoryId: string; ruleId: string };
}

export interface PendingAuth {
  state: string;
  aspspName: string;
  aspspCountry: string;
  startDate: string;
  connectionId?: string;
  expiresAt: number;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  failedAccounts: number;
  partial: boolean;
}

export interface SyncStatus {
  state: 'IDLE' | 'RUNNING';
  startedAt?: string;
  finishedAt?: string;
  lastResult?: SyncResult;
}
```

`src/api/types.ts` — add to `Transaction` after `createdAt: string;`:
```ts
  source?: 'MANUAL' | 'BANK';
  bankRef?: { connectionId: string; accountUid: string; txnKey: string };
```

- [ ] **Step 4: Run tests and typecheck**

Run: `yarn vitest run src/api/__tests__/body.test.ts src/sync/__tests__/errors.test.ts && yarn typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/body.ts src/api/types.ts src/sync/errors.ts src/sync/types.ts src/api/__tests__/body.test.ts src/sync/__tests__/errors.test.ts
git commit -m "feat(sync): add sync types, provider errors and body helpers"
```

---

### Task 2: Amount parsing and sync window

**Files:**
- Create: `src/sync/amount.ts`, `src/sync/window.ts`
- Test: `src/sync/__tests__/amount.test.ts`, `src/sync/__tests__/window.test.ts`

**Interfaces:**
- Consumes: `ConnectedAccount`, `SyncWindow` from Task 1.
- Produces: `parseAmountToPence(input: string): number | null`; `addDays(date: string, days: number): string`; `syncWindow(account: ConnectedAccount, today: string): SyncWindow`; `OVERLAP_DAYS = 5`.

- [ ] **Step 1: Write the failing tests**

`src/sync/__tests__/amount.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseAmountToPence } from '../amount';

describe('parseAmountToPence', () => {
  it.each([
    ['12.34', 1234],
    ['12.3', 1230],
    ['12', 1200],
    ['0.01', 1],
    ['0.00', 0],
  ])('parses %s as %i pence', (input, expected) => {
    expect(parseAmountToPence(input)).toBe(expected);
  });

  it.each(['12.345', '1e3', '', 'abc', '-5.00', '12.', '.5', ' 12'])('rejects %j', input => {
    expect(parseAmountToPence(input)).toBeNull();
  });
});
```

`src/sync/__tests__/window.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { addDays, syncWindow } from '../window';
import type { ConnectedAccount } from '../types';

const account = (overrides: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
  accountUid: 'acc-1', dedupeId: 'acc-1', displayName: 'Current', last4: '1234',
  currency: 'GBP', startDate: '2026-09-01', ...overrides,
});

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-03-02', -5)).toBe('2026-02-25');
  });
});

describe('syncWindow', () => {
  it('starts at startDate on the first sync', () => {
    expect(syncWindow(account(), '2026-09-13')).toEqual({ from: '2026-09-01', to: '2026-09-13' });
  });

  it('overlaps five days before the last sync', () => {
    const w = syncWindow(account({ lastSyncedAt: '2026-09-12T18:00:00.000Z' }), '2026-09-13');
    expect(w).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('never starts before startDate', () => {
    const w = syncWindow(account({ lastSyncedAt: '2026-09-03T00:00:00.000Z' }), '2026-09-13');
    expect(w.from).toBe('2026-09-01');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/sync/__tests__/amount.test.ts src/sync/__tests__/window.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/sync/amount.ts`:
```ts
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

export function parseAmountToPence(input: string): number | null {
  if (!DECIMAL_RE.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
```

`src/sync/window.ts`:
```ts
import type { ConnectedAccount, SyncWindow } from './types';

export const OVERLAP_DAYS = 5;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function syncWindow(account: ConnectedAccount, today: string): SyncWindow {
  if (!account.lastSyncedAt) return { from: account.startDate, to: today };
  const overlapStart = addDays(account.lastSyncedAt.slice(0, 10), -OVERLAP_DAYS);
  return { from: overlapStart > account.startDate ? overlapStart : account.startDate, to: today };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/sync/__tests__/amount.test.ts src/sync/__tests__/window.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/amount.ts src/sync/window.ts src/sync/__tests__/amount.test.ts src/sync/__tests__/window.test.ts
git commit -m "feat(sync): parse decimal amounts to pence and compute sync windows"
```

---

### Task 3: Dedupe keys and account matching

**Files:**
- Create: `src/sync/txnKey.ts`, `src/sync/accounts.ts`, `src/sync/chunk.ts`
- Test: `src/sync/__tests__/txnKey.test.ts`, `src/sync/__tests__/accounts.test.ts`

**Interfaces:**
- Consumes: `ProviderTransaction`, `ConnectedAccount` from Task 1.
- Produces: `deriveTxnKeys(provider: string, dedupeId: string, transactions: ProviderTransaction[]): string[]` (32 lowercase hex chars each, same order as input); `SessionAccount = Pick<ConnectedAccount, 'accountUid' | 'displayName' | 'last4' | 'currency'>`; `matchAccounts(existing: ConnectedAccount[], incoming: SessionAccount[], today: string): ConnectedAccount[]`; `chunk<T>(items: T[], size: number): T[][]`.

- [ ] **Step 1: Write the failing tests**

`src/sync/__tests__/txnKey.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveTxnKeys } from '../txnKey';
import type { ProviderTransaction } from '../types';

function txn(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  const base = {
    entryReference: null, amountPence: 350, direction: 'OUT' as const,
    bookingDate: '2026-09-10', description: 'COFFEE SHOP', currency: 'GBP',
  };
  const t = { ...base, ...overrides };
  return { ...t, fallbackBasis: [t.bookingDate, t.amountPence, t.direction, t.description].join('|') };
}

describe('deriveTxnKeys', () => {
  it('produces 32 hex character keys', () => {
    const [key] = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1' })]);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same entry reference', () => {
    const a = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1' })]);
    const b = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1', description: 'changed' })]);
    expect(a).toEqual(b);
  });

  it('gives identical-looking same-day transactions distinct keys', () => {
    const keys = deriveTxnKeys('enable-banking', 'acc-1', [txn(), txn()]);
    expect(new Set(keys).size).toBe(2);
  });

  it('produces the same set of keys regardless of API order', () => {
    const coffee = txn();
    const lunch = txn({ amountPence: 899, description: 'LUNCH' });
    const forward = deriveTxnKeys('enable-banking', 'acc-1', [coffee, lunch, coffee]);
    const shuffled = deriveTxnKeys('enable-banking', 'acc-1', [coffee, coffee, lunch]);
    expect([...forward].sort()).toEqual([...shuffled].sort());
  });

  it('keeps the first key when a second identical transaction appears in a later sync', () => {
    const [first] = deriveTxnKeys('enable-banking', 'acc-1', [txn()]);
    const later = deriveTxnKeys('enable-banking', 'acc-1', [txn(), txn()]);
    expect(later).toContain(first);
  });

  it('isolates accounts', () => {
    const a = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1' })]);
    const b = deriveTxnKeys('enable-banking', 'acc-2', [txn({ entryReference: 'ref-1' })]);
    expect(a).not.toEqual(b);
  });
});
```

`src/sync/__tests__/accounts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { matchAccounts } from '../accounts';
import type { ConnectedAccount } from '../types';

const existing: ConnectedAccount = {
  accountUid: 'old-uid', dedupeId: 'old-uid', displayName: 'Current Account', last4: '1234',
  currency: 'GBP', startDate: '2026-06-01', lastSyncedAt: '2026-09-10T00:00:00.000Z',
};

describe('matchAccounts', () => {
  it('keeps history for an account with the same uid', () => {
    const [result] = matchAccounts([existing], [{ ...existing }], '2026-09-13');
    expect(result).toMatchObject({ accountUid: 'old-uid', dedupeId: 'old-uid', startDate: '2026-06-01' });
  });

  it('matches a new uid by last4 and name and keeps the original dedupeId', () => {
    const incoming = { accountUid: 'new-uid', displayName: 'Current Account', last4: '1234', currency: 'GBP' };
    const [result] = matchAccounts([existing], [incoming], '2026-09-13');
    expect(result).toEqual({ ...incoming, dedupeId: 'old-uid', startDate: '2026-06-01', lastSyncedAt: existing.lastSyncedAt });
  });

  it('treats unmatched accounts as new from today', () => {
    const incoming = { accountUid: 'other', displayName: 'Savings', last4: '9999', currency: 'GBP' };
    const [result] = matchAccounts([existing], [incoming], '2026-09-13');
    expect(result).toEqual({ ...incoming, dedupeId: 'other', startDate: '2026-09-13' });
  });

  it('does not match on an empty last4', () => {
    const blank = { ...existing, last4: '' };
    const incoming = { accountUid: 'new-uid', displayName: 'Current Account', last4: '', currency: 'GBP' };
    const [result] = matchAccounts([blank], [incoming], '2026-09-13');
    expect(result.dedupeId).toBe('new-uid');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/sync/__tests__/txnKey.test.ts src/sync/__tests__/accounts.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/sync/txnKey.ts`:
```ts
import { createHash } from 'node:crypto';
import type { ProviderTransaction } from './types';

const KEY_LENGTH = 32;

function hashParts(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, KEY_LENGTH);
}

export function deriveTxnKeys(provider: string, dedupeId: string, transactions: ProviderTransaction[]): string[] {
  const occurrences = new Map<string, number>();
  return transactions.map(t => {
    if (t.entryReference) return hashParts([provider, dedupeId, 'ref', t.entryReference]);
    const n = occurrences.get(t.fallbackBasis) ?? 0;
    occurrences.set(t.fallbackBasis, n + 1);
    return hashParts([provider, dedupeId, 'fallback', t.fallbackBasis, String(n)]);
  });
}
```

`src/sync/accounts.ts`:
```ts
import type { ConnectedAccount } from './types';

export type SessionAccount = Pick<ConnectedAccount, 'accountUid' | 'displayName' | 'last4' | 'currency'>;

function findMatch(existing: ConnectedAccount[], account: SessionAccount): ConnectedAccount | undefined {
  return existing.find(e => e.accountUid === account.accountUid)
    ?? existing.find(e => e.last4 !== '' && e.last4 === account.last4 && e.displayName === account.displayName);
}

export function matchAccounts(existing: ConnectedAccount[], incoming: SessionAccount[], today: string): ConnectedAccount[] {
  return incoming.map(account => {
    const match = findMatch(existing, account);
    if (!match) return { ...account, dedupeId: account.accountUid, startDate: today };
    const merged: ConnectedAccount = { ...account, dedupeId: match.dedupeId, startDate: match.startDate };
    if (match.lastSyncedAt) merged.lastSyncedAt = match.lastSyncedAt;
    return merged;
  });
}
```

`src/sync/chunk.ts`:
```ts
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/sync/__tests__/txnKey.test.ts src/sync/__tests__/accounts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/txnKey.ts src/sync/accounts.ts src/sync/chunk.ts src/sync/__tests__/txnKey.test.ts src/sync/__tests__/accounts.test.ts
git commit -m "feat(sync): derive order-independent dedupe keys and match reconnected accounts"
```

---

### Task 4: Enable Banking transaction normaliser and logger

**Files:**
- Create: `src/sync/providers/enableBankingNormalise.ts`, `src/sync/log.ts`
- Test: `src/sync/__tests__/enableBankingNormalise.test.ts`

**Interfaces:**
- Consumes: `isRecord` (Task 1), `parseAmountToPence` (Task 2), `ProviderError`, `ProviderTransaction`.
- Produces: `sanitiseDescription(raw: string): string`; `normaliseEbTransaction(raw: unknown, startDate: string): ProviderTransaction | null` (returns `null` for skipped items, throws `ProviderError('INVALID_RESPONSE')` for malformed ones); `Logger`, `LogFields`, `jsonLogger`.

- [ ] **Step 1: Write the failing test**

`src/sync/__tests__/enableBankingNormalise.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normaliseEbTransaction, sanitiseDescription } from '../providers/enableBankingNormalise';
import { ProviderError } from '../errors';

function raw(overrides: Record<string, unknown> = {}) {
  return {
    entry_reference: 'ref-1',
    transaction_amount: { amount: '12.34', currency: 'GBP' },
    credit_debit_indicator: 'DBIT',
    booking_date: '2026-09-10',
    remittance_information: ['TESCO STORES 1234'],
    creditor: { name: 'Tesco' },
    status: 'BOOK',
    ...overrides,
  };
}

describe('sanitiseDescription', () => {
  it('strips control characters, collapses whitespace and trims', () => {
    expect(sanitiseDescription('  TESCO \u0007\n  STORES\t\u007F ')).toBe('TESCO STORES');
  });

  it('caps length at 200 characters', () => {
    expect(sanitiseDescription('x'.repeat(250))).toHaveLength(200);
  });
});

describe('normaliseEbTransaction', () => {
  it('maps a debit to an OUT transaction in pence', () => {
    expect(normaliseEbTransaction(raw(), '2026-09-01')).toEqual({
      entryReference: 'ref-1',
      amountPence: 1234,
      direction: 'OUT',
      bookingDate: '2026-09-10',
      description: 'TESCO STORES 1234',
      currency: 'GBP',
      fallbackBasis: '2026-09-10|1234|OUT|TESCO STORES 1234',
    });
  });

  it('maps a credit to IN and falls back to the debtor name', () => {
    const t = normaliseEbTransaction(
      raw({ credit_debit_indicator: 'CRDT', remittance_information: [], debtor: { name: 'ACME LTD' } }),
      '2026-09-01',
    );
    expect(t).toMatchObject({ direction: 'IN', description: 'ACME LTD' });
  });

  it('uses a generic description when nothing else is available', () => {
    const t = normaliseEbTransaction(raw({ remittance_information: null, creditor: null }), '2026-09-01');
    expect(t?.description).toBe('Bank transaction');
  });

  it('treats an empty entry reference as missing', () => {
    expect(normaliseEbTransaction(raw({ entry_reference: '' }), '2026-09-01')?.entryReference).toBeNull();
  });

  it('accepts a negative amount string because direction comes from the indicator', () => {
    const t = normaliseEbTransaction(raw({ transaction_amount: { amount: '-12.34', currency: 'GBP' } }), '2026-09-01');
    expect(t?.amountPence).toBe(1234);
  });

  it('falls back to value_date when booking_date is missing', () => {
    const t = normaliseEbTransaction(raw({ booking_date: null, value_date: '2026-09-11' }), '2026-09-01');
    expect(t?.bookingDate).toBe('2026-09-11');
  });

  it('skips non-GBP transactions', () => {
    expect(normaliseEbTransaction(raw({ transaction_amount: { amount: '5.00', currency: 'EUR' } }), '2026-09-01')).toBeNull();
  });

  it('skips transactions booked before the start date', () => {
    expect(normaliseEbTransaction(raw({ booking_date: '2026-08-31' }), '2026-09-01')).toBeNull();
  });

  it('skips zero-value transactions', () => {
    expect(normaliseEbTransaction(raw({ transaction_amount: { amount: '0.00', currency: 'GBP' } }), '2026-09-01')).toBeNull();
  });

  it.each([
    ['missing amount object', { transaction_amount: undefined }],
    ['unknown indicator', { credit_debit_indicator: 'X' }],
    ['bad date', { booking_date: '10/09/2026', value_date: undefined }],
    ['non-decimal amount', { transaction_amount: { amount: '1e3', currency: 'GBP' } }],
  ])('rejects %s as an invalid response', (_label, overrides) => {
    expect(() => normaliseEbTransaction(raw(overrides), '2026-09-01')).toThrow(ProviderError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/enableBankingNormalise.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/sync/log.ts`:
```ts
export type LogFields = Record<string, string | number | boolean>;
export type Logger = (event: string, fields: LogFields) => void;

export const jsonLogger: Logger = (event, fields) => {
  console.log(JSON.stringify({ event, ...fields }));
};
```

`src/sync/providers/enableBankingNormalise.ts`:
```ts
import { isRecord, DATE_RE } from '../../api/body';
import { parseAmountToPence } from '../amount';
import { ProviderError } from '../errors';
import type { Direction, ProviderTransaction } from '../types';

const DESCRIPTION_MAX = 200;
const FALLBACK_DESCRIPTION = 'Bank transaction';

export function sanitiseDescription(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DESCRIPTION_MAX);
}

function partyName(value: unknown): string {
  return isRecord(value) && typeof value.name === 'string' ? value.name : '';
}

function remittanceText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((part): part is string => typeof part === 'string').join(' ');
}

function invalid(reason: string): ProviderError {
  return new ProviderError('INVALID_RESPONSE', `Enable Banking transaction ${reason}`);
}

export function normaliseEbTransaction(raw: unknown, startDate: string): ProviderTransaction | null {
  if (!isRecord(raw) || !isRecord(raw.transaction_amount)) throw invalid('is missing transaction_amount');

  const { amount, currency } = raw.transaction_amount;
  const indicator = raw.credit_debit_indicator;
  const bookingDate = typeof raw.booking_date === 'string' ? raw.booking_date : raw.value_date;

  if (typeof amount !== 'string' || typeof currency !== 'string') throw invalid('has a malformed amount');
  if (indicator !== 'CRDT' && indicator !== 'DBIT') throw invalid('has an unknown credit_debit_indicator');
  if (typeof bookingDate !== 'string' || !DATE_RE.test(bookingDate)) throw invalid('has no valid booking date');

  if (currency !== 'GBP' || bookingDate < startDate) return null;

  const amountPence = parseAmountToPence(amount.startsWith('-') ? amount.slice(1) : amount);
  if (amountPence === null) throw invalid('amount is not a decimal');
  if (amountPence === 0) return null;

  const direction: Direction = indicator === 'CRDT' ? 'IN' : 'OUT';
  const counterparty = direction === 'OUT' ? partyName(raw.creditor) : partyName(raw.debtor);
  const description = sanitiseDescription(remittanceText(raw.remittance_information))
    || sanitiseDescription(counterparty)
    || FALLBACK_DESCRIPTION;
  const entryReference = typeof raw.entry_reference === 'string' && raw.entry_reference !== ''
    ? raw.entry_reference
    : null;

  return {
    entryReference,
    amountPence,
    direction,
    bookingDate,
    description,
    currency,
    fallbackBasis: [bookingDate, amountPence, direction, description].join('|'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/sync/__tests__/enableBankingNormalise.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/log.ts src/sync/providers/enableBankingNormalise.ts src/sync/__tests__/enableBankingNormalise.test.ts
git commit -m "feat(sync): normalise Enable Banking transactions"
```

---

## Phase B — Storage

### Task 5: SyncStore interface and DynamoDB implementation

**Files:**
- Create: `src/sync/store.ts`, `src/sync/stores/dynamoSyncStore.ts`, `src/api/dynamoErrors.ts`
- Modify: `src/api/db.ts`
- Test: `src/sync/__tests__/dynamoSyncStore.test.ts`, `src/api/__tests__/dynamoErrors.test.ts`

**Interfaces:**
- Consumes: types from Task 1, `chunk` from Task 3.
- Produces:
  - `db.ts` key helpers: `bankConnSk(connectionId)`, `bankAuthSk(state)`, `inboxSk(bookingDate, txnKey)`, `seenSk(txnKey)`, `SYNC_STATUS_SK`, `SYSTEM_PK`, `connUserSk(userId)`.
  - `isConditionalCheckFailure(error: unknown): boolean`; `isCancelledByCondition(error: unknown, index: number): boolean`.
  - `SyncStore` (below) and `createDynamoSyncStore(): SyncStore`.

- [ ] **Step 1: Write the failing tests**

`src/api/__tests__/dynamoErrors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isCancelledByCondition, isConditionalCheckFailure } from '../dynamoErrors';

const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra });

describe('isConditionalCheckFailure', () => {
  it('recognises ConditionalCheckFailedException', () => {
    expect(isConditionalCheckFailure(named('ConditionalCheckFailedException'))).toBe(true);
    expect(isConditionalCheckFailure(named('ValidationException'))).toBe(false);
  });
});

describe('isCancelledByCondition', () => {
  const cancelled = named('TransactionCanceledException', {
    CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
  });

  it('checks the cancellation reason at the given index', () => {
    expect(isCancelledByCondition(cancelled, 1)).toBe(true);
    expect(isCancelledByCondition(cancelled, 0)).toBe(false);
  });

  it('is false for other errors', () => {
    expect(isCancelledByCondition(new Error('boom'), 0)).toBe(false);
  });
});
```

`src/sync/__tests__/dynamoSyncStore.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../../api/db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  bankConnSk: (id: string) => `BANKCONN#${id}`,
  bankAuthSk: (state: string) => `BANKAUTH#${state}`,
  inboxSk: (date: string, key: string) => `INBOX#${date}#${key}`,
  seenSk: (key: string) => `SEEN#${key}`,
  SYNC_STATUS_SK: 'SYNCSTATUS',
  SYSTEM_PK: 'SYSTEM',
  connUserSk: (userId: string) => `CONNUSER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  const passthrough = (name: string) => vi.fn(function (input: object) { return { __command: name, ...input }; });
  return {
    BatchGetCommand: passthrough('BatchGet'),
    BatchWriteCommand: passthrough('BatchWrite'),
    DeleteCommand: passthrough('Delete'),
    GetCommand: passthrough('Get'),
    PutCommand: passthrough('Put'),
    QueryCommand: passthrough('Query'),
    TransactWriteCommand: passthrough('TransactWrite'),
    UpdateCommand: passthrough('Update'),
  };
});

import { createDynamoSyncStore } from '../stores/dynamoSyncStore';
import type { InboxItem } from '../types';

const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra });

const item: InboxItem = {
  txnKey: 'a'.repeat(32), amount: 1234, direction: 'OUT', suggestedType: 'EXPENSE',
  description: 'TESCO', bookingDate: '2026-09-10', connectionId: 'conn-1',
  accountUid: 'acc-1', importedAt: '2026-09-13T12:00:00.000Z',
};

describe('dynamoSyncStore', () => {
  const store = createDynamoSyncStore();
  beforeEach(() => { mockSend.mockReset(); });

  describe('acquireLock', () => {
    it('conditionally sets RUNNING unless a fresh lock is held', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(store.acquireLock('u1', '2026-09-13T12:00:00.000Z', '2026-09-13T11:50:00.000Z')).resolves.toBe(true);
      const input = mockSend.mock.calls[0][0];
      expect(input.Key).toEqual({ PK: 'USER#u1', SK: 'SYNCSTATUS' });
      expect(input.ConditionExpression).toBe('attribute_not_exists(#state) OR #state <> :running OR startedAt < :stale');
      expect(input.ExpressionAttributeValues[':stale']).toBe('2026-09-13T11:50:00.000Z');
    });

    it('returns false when the condition fails', async () => {
      mockSend.mockRejectedValueOnce(named('ConditionalCheckFailedException'));
      await expect(store.acquireLock('u1', 'now', 'stale')).resolves.toBe(false);
    });
  });

  describe('importItem', () => {
    it('writes the seen marker with attribute_not_exists and the inbox item in one transaction', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(store.importItem('u1', item)).resolves.toBe('IMPORTED');
      const [seen, inbox] = mockSend.mock.calls[0][0].TransactItems;
      expect(seen.Put.Item).toMatchObject({ PK: 'USER#u1', SK: `SEEN#${item.txnKey}`, outcome: 'PENDING' });
      expect(seen.Put.ConditionExpression).toBe('attribute_not_exists(SK)');
      expect(inbox.Put.Item).toMatchObject({ PK: 'USER#u1', SK: `INBOX#2026-09-10#${item.txnKey}`, amount: 1234 });
    });

    it('reports ALREADY_SEEN when the seen marker condition cancels the transaction', async () => {
      mockSend.mockRejectedValueOnce(named('TransactionCanceledException', {
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      }));
      await expect(store.importItem('u1', item)).resolves.toBe('ALREADY_SEEN');
    });
  });

  describe('filterUnseen', () => {
    it('removes keys that already have a seen marker', async () => {
      mockSend.mockResolvedValueOnce({ Responses: { 'test-table': [{ SK: 'SEEN#k1' }] } });
      const unseen = await store.filterUnseen('u1', ['k1', 'k2']);
      expect([...unseen]).toEqual(['k2']);
      expect(mockSend.mock.calls[0][0].RequestItems['test-table'].Keys).toEqual([
        { PK: 'USER#u1', SK: 'SEEN#k1' },
        { PK: 'USER#u1', SK: 'SEEN#k2' },
      ]);
    });

    it('makes no request for an empty key list', async () => {
      await store.filterUnseen('u1', []);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('getPendingAuth', () => {
    it('returns null once expiresAt has passed even if TTL has not deleted the item', async () => {
      mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#u1', SK: 'BANKAUTH#s', state: 's', expiresAt: 1000 } });
      await expect(store.getPendingAuth('u1', 's', 1_000_000)).resolves.toBeNull();
    });

    it('returns the auth without table keys while valid', async () => {
      mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#u1', SK: 'BANKAUTH#s', state: 's', expiresAt: 2000 } });
      await expect(store.getPendingAuth('u1', 's', 1_000_000)).resolves.toEqual({ state: 's', expiresAt: 2000 });
    });
  });

  describe('replaceConnectionIfUnchanged', () => {
    const connection = {
      connectionId: 'c1', provider: 'enable-banking' as const, displayName: 'Lloyds', status: 'ACTIVE' as const,
      consecutiveFailures: 0, accounts: [], createdAt: 't0', updatedAt: 't2',
      auth: { sessionId: 's', consentValidUntil: '2027-01-01T00:00:00.000Z' }, lastError: undefined,
    };

    it('puts conditionally on the previous updatedAt and drops undefined fields', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(store.replaceConnectionIfUnchanged('u1', connection, 't1')).resolves.toBe(true);
      const input = mockSend.mock.calls[0][0];
      expect(input.ConditionExpression).toBe('updatedAt = :expected');
      expect(input.ExpressionAttributeValues).toEqual({ ':expected': 't1' });
      expect('lastError' in input.Item).toBe(false);
    });

    it('returns false when the connection changed', async () => {
      mockSend.mockRejectedValueOnce(named('ConditionalCheckFailedException'));
      await expect(store.replaceConnectionIfUnchanged('u1', connection, 't1')).resolves.toBe(false);
    });
  });

  describe('deletePendingItemsForConnection', () => {
    it('deletes matching inbox items and their seen markers', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ SK: 'INBOX#2026-09-10#k1', txnKey: 'k1', connectionId: 'c1' }] })
        .mockResolvedValueOnce({});
      await expect(store.deletePendingItemsForConnection('u1', 'c1')).resolves.toBe(1);
      const requests = mockSend.mock.calls[1][0].RequestItems['test-table'];
      expect(requests).toEqual([
        { DeleteRequest: { Key: { PK: 'USER#u1', SK: 'INBOX#2026-09-10#k1' } } },
        { DeleteRequest: { Key: { PK: 'USER#u1', SK: 'SEEN#k1' } } },
      ]);
    });
  });

  describe('listSyncUserIds', () => {
    it('reads the SYSTEM registry across pages', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ SK: 'CONNUSER#a' }], LastEvaluatedKey: { PK: 'SYSTEM', SK: 'CONNUSER#a' } })
        .mockResolvedValueOnce({ Items: [{ SK: 'CONNUSER#b' }] });
      await expect(store.listSyncUserIds()).resolves.toEqual(['a', 'b']);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api/__tests__/dynamoErrors.test.ts src/sync/__tests__/dynamoSyncStore.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/api/db.ts` — append:
```ts
export const bankConnSk = (connectionId: string): string => `BANKCONN#${connectionId}`;
export const bankAuthSk = (state: string): string => `BANKAUTH#${state}`;
export const inboxSk = (bookingDate: string, txnKey: string): string => `INBOX#${bookingDate}#${txnKey}`;
export const seenSk = (txnKey: string): string => `SEEN#${txnKey}`;
export const SYNC_STATUS_SK = 'SYNCSTATUS';
export const SYSTEM_PK = 'SYSTEM';
export const connUserSk = (userId: string): string => `CONNUSER#${userId}`;
```

`src/api/dynamoErrors.ts`:
```ts
export function isConditionalCheckFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export function isCancelledByCondition(error: unknown, index: number): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return false;
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return reasons?.[index]?.Code === 'ConditionalCheckFailed';
}
```

`src/sync/store.ts`:
```ts
import type { Connection, InboxItem, PendingAuth, SyncResult, SyncStatus } from './types';

export interface SyncStore {
  listSyncUserIds(): Promise<string[]>;
  registerSyncUser(userId: string, nowIso: string): Promise<void>;
  unregisterSyncUser(userId: string): Promise<void>;

  acquireLock(userId: string, nowIso: string, staleBeforeIso: string): Promise<boolean>;
  releaseLock(userId: string, nowIso: string, result: SyncResult): Promise<void>;
  getSyncStatus(userId: string): Promise<SyncStatus | null>;

  listConnections(userId: string): Promise<Connection[]>;
  getConnection(userId: string, connectionId: string): Promise<Connection | null>;
  putConnection(userId: string, connection: Connection): Promise<void>;
  replaceConnectionIfUnchanged(userId: string, connection: Connection, expectedUpdatedAt: string): Promise<boolean>;
  deleteConnection(userId: string, connectionId: string): Promise<void>;

  putPendingAuth(userId: string, auth: PendingAuth): Promise<void>;
  getPendingAuth(userId: string, state: string, nowMs: number): Promise<PendingAuth | null>;
  deletePendingAuth(userId: string, state: string): Promise<void>;

  filterUnseen(userId: string, txnKeys: string[]): Promise<Set<string>>;
  importItem(userId: string, item: InboxItem): Promise<'IMPORTED' | 'ALREADY_SEEN'>;
  deletePendingItemsForConnection(userId: string, connectionId: string): Promise<number>;
}
```

`src/sync/stores/dynamoSyncStore.ts`:
```ts
import {
  BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand,
  QueryCommand, TransactWriteCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import {
  docClient, TABLE, pk, bankAuthSk, bankConnSk, connUserSk, inboxSk, seenSk, SYNC_STATUS_SK, SYSTEM_PK,
} from '../../api/db';
import { isCancelledByCondition, isConditionalCheckFailure } from '../../api/dynamoErrors';
import { chunk } from '../chunk';
import type { SyncStore } from '../store';
import type { Connection, InboxItem, PendingAuth, SyncResult, SyncStatus } from '../types';

const BATCH_GET_SIZE = 100;
const BATCH_WRITE_SIZE = 25;
const MAX_UNPROCESSED_RETRIES = 5;

type Key = { PK: string; SK: string };

function withoutKeys<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as T;
}

function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function queryAll(input: QueryCommandInput): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...(result.Items ?? []));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function deleteKeys(keys: Key[]): Promise<void> {
  for (const batch of chunk(keys, BATCH_WRITE_SIZE)) {
    let requests: Record<string, unknown>[] = batch.map(Key => ({ DeleteRequest: { Key } }));
    for (let attempt = 0; requests.length > 0; attempt++) {
      if (attempt > MAX_UNPROCESSED_RETRIES) throw new Error('DynamoDB left unprocessed deletes after retries');
      const result = await docClient.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests } }));
      requests = (result.UnprocessedItems?.[TABLE] ?? []) as Record<string, unknown>[];
    }
  }
}

export function createDynamoSyncStore(): SyncStore {
  return {
    async listSyncUserIds() {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': SYSTEM_PK, ':prefix': 'CONNUSER#' },
      });
      return items.map(item => String(item.SK).slice('CONNUSER#'.length));
    },

    async registerSyncUser(userId, nowIso) {
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: SYSTEM_PK, SK: connUserSk(userId), createdAt: nowIso },
      }));
    },

    async unregisterSyncUser(userId) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: SYSTEM_PK, SK: connUserSk(userId) } }));
    },

    async acquireLock(userId, nowIso, staleBeforeIso) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk(userId), SK: SYNC_STATUS_SK },
          UpdateExpression: 'SET #state = :running, startedAt = :now',
          ConditionExpression: 'attribute_not_exists(#state) OR #state <> :running OR startedAt < :stale',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':running': 'RUNNING', ':now': nowIso, ':stale': staleBeforeIso },
        }));
        return true;
      } catch (error) {
        if (isConditionalCheckFailure(error)) return false;
        throw error;
      }
    },

    async releaseLock(userId, nowIso, result: SyncResult) {
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk(userId), SK: SYNC_STATUS_SK },
        UpdateExpression: 'SET #state = :idle, finishedAt = :now, lastResult = :result',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':idle': 'IDLE', ':now': nowIso, ':result': result },
      }));
    },

    async getSyncStatus(userId) {
      const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: SYNC_STATUS_SK } }));
      return result.Item ? withoutKeys<SyncStatus>(result.Item) : null;
    },

    async listConnections(userId) {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'BANKCONN#' },
      });
      return items.map(item => withoutKeys<Connection>(item));
    },

    async getConnection(userId, connectionId) {
      const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankConnSk(connectionId) } }));
      return result.Item ? withoutKeys<Connection>(result.Item) : null;
    },

    async putConnection(userId, connection) {
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: pk(userId), SK: bankConnSk(connection.connectionId), ...withoutUndefined(connection) },
      }));
    },

    async replaceConnectionIfUnchanged(userId, connection, expectedUpdatedAt) {
      try {
        await docClient.send(new PutCommand({
          TableName: TABLE,
          Item: { PK: pk(userId), SK: bankConnSk(connection.connectionId), ...withoutUndefined(connection) },
          ConditionExpression: 'updatedAt = :expected',
          ExpressionAttributeValues: { ':expected': expectedUpdatedAt },
        }));
        return true;
      } catch (error) {
        if (isConditionalCheckFailure(error)) return false;
        throw error;
      }
    },

    async deleteConnection(userId, connectionId) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankConnSk(connectionId) } }));
    },

    async putPendingAuth(userId, auth: PendingAuth) {
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: pk(userId), SK: bankAuthSk(auth.state), ...withoutUndefined(auth) },
      }));
    },

    async getPendingAuth(userId, state, nowMs) {
      const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankAuthSk(state) } }));
      if (!result.Item || Number(result.Item.expiresAt) <= Math.floor(nowMs / 1000)) return null;
      return withoutKeys<PendingAuth>(result.Item);
    },

    async deletePendingAuth(userId, state) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankAuthSk(state) } }));
    },

    async filterUnseen(userId, txnKeys) {
      const unseen = new Set(txnKeys);
      for (const batch of chunk([...unseen], BATCH_GET_SIZE)) {
        let keys: Key[] = batch.map(txnKey => ({ PK: pk(userId), SK: seenSk(txnKey) }));
        for (let attempt = 0; keys.length > 0; attempt++) {
          if (attempt > MAX_UNPROCESSED_RETRIES) throw new Error('DynamoDB left unprocessed reads after retries');
          const result = await docClient.send(new BatchGetCommand({
            RequestItems: { [TABLE]: { Keys: keys, ProjectionExpression: 'SK' } },
          }));
          for (const found of result.Responses?.[TABLE] ?? []) {
            unseen.delete(String(found.SK).slice('SEEN#'.length));
          }
          keys = (result.UnprocessedKeys?.[TABLE]?.Keys ?? []) as Key[];
        }
      }
      return unseen;
    },

    async importItem(userId, item: InboxItem) {
      try {
        await docClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: { PK: pk(userId), SK: seenSk(item.txnKey), outcome: 'PENDING', firstSeenAt: item.importedAt },
                ConditionExpression: 'attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: TABLE,
                Item: { PK: pk(userId), SK: inboxSk(item.bookingDate, item.txnKey), ...withoutUndefined(item) },
              },
            },
          ],
        }));
        return 'IMPORTED';
      } catch (error) {
        if (isCancelledByCondition(error, 0)) return 'ALREADY_SEEN';
        throw error;
      }
    },

    async deletePendingItemsForConnection(userId, connectionId) {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'connectionId = :connectionId',
        ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'INBOX#', ':connectionId': connectionId },
      });
      const keys = items.flatMap(found => [
        { PK: pk(userId), SK: String(found.SK) },
        { PK: pk(userId), SK: seenSk(String(found.txnKey)) },
      ]);
      await deleteKeys(keys);
      return items.length;
    },
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `yarn vitest run src/api/__tests__/dynamoErrors.test.ts src/sync/__tests__/dynamoSyncStore.test.ts && yarn test && yarn typecheck`
Expected: PASS — including the existing API tests, which mock `../db` and are unaffected by the new exports.

- [ ] **Step 5: Commit**

```bash
git add src/api/db.ts src/api/dynamoErrors.ts src/sync/store.ts src/sync/stores/dynamoSyncStore.ts src/api/__tests__/dynamoErrors.test.ts src/sync/__tests__/dynamoSyncStore.test.ts
git commit -m "feat(sync): add SyncStore with DynamoDB implementation"
```

---

## Phase C — Enable Banking

### Task 6: Enable Banking JWT source and HTTP client

**Files:**
- Create: `src/sync/providers/enableBankingClient.ts`
- Test: `src/sync/__tests__/enableBankingClient.test.ts`

**Interfaces:**
- Consumes: `ProviderError`, `classifyHttpStatus` (Task 1), `PsuContext`.
- Produces:
  - `EbCredentials { applicationId: string; privateKeyPem: string }`
  - `createJwtSource(credentials: EbCredentials, nowMs: () => number): () => string`
  - `EbClient { get(path, query?, psu?): Promise<unknown>; post(path, body, psu?): Promise<unknown>; delete(path): Promise<void> }`
  - `createEbClient(options: { jwt: () => string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): EbClient`
  - `EB_API_BASE`, `PSU_IP_HEADER`, `PSU_USER_AGENT_HEADER`

- [ ] **Step 1: Confirm PSU header names**

Open the Enable Banking API reference (https://enablebanking.com/docs/api/reference/) and find the headers used to mark a request as user-present on `GET /accounts/{account_id}/transactions`. The plan assumes `Psu-Ip-Address` and `Psu-User-Agent`. If the reference differs, use its names in the constants below and in the test, and note it in Task 22's spec update.

- [ ] **Step 2: Write the failing test**

`src/sync/__tests__/enableBankingClient.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decode, verify } from 'jsonwebtoken';
import { createEbClient, createJwtSource, PSU_IP_HEADER, PSU_USER_AGENT_HEADER } from '../providers/enableBankingClient';
import { ProviderError } from '../errors';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const credentials = { applicationId: '11111111-1111-4111-8111-111111111111', privateKeyPem: privateKey };

describe('createJwtSource', () => {
  it('signs an RS256 JWT with the application id as kid and a one-hour lifetime', () => {
    const now = 1_760_000_000_000;
    const token = createJwtSource(credentials, () => now)();
    const payload = verify(token, publicKey, { algorithms: ['RS256'] }) as Record<string, number | string>;
    const header = decode(token, { complete: true })?.header;
    expect(header?.kid).toBe(credentials.applicationId);
    expect(payload.iss).toBe('enablebanking.com');
    expect(payload.aud).toBe('api.enablebanking.com');
    expect(payload.iat).toBe(now / 1000);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(3600);
  });

  it('reuses the token until five minutes before expiry', () => {
    let now = 1_760_000_000_000;
    const jwt = createJwtSource(credentials, () => now);
    const first = jwt();
    now += 54 * 60_000;
    expect(jwt()).toBe(first);
    now += 2 * 60_000;
    expect(jwt()).not.toBe(first);
  });
});

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('createEbClient', () => {
  const sleep = vi.fn(async () => {});

  it('sends the bearer token, query and PSU headers', async () => {
    const fetchImpl = vi.fn(async () => response(200, { ok: true }));
    const client = createEbClient({ jwt: () => 'jwt-1', fetchImpl, sleep });
    await expect(client.get('/aspsps', { country: 'GB' }, { ipAddress: '203.0.113.5', userAgent: 'Firefox' })).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.enablebanking.com/aspsps?country=GB');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-1');
    expect(headers[PSU_IP_HEADER]).toBe('203.0.113.5');
    expect(headers[PSU_USER_AGENT_HEADER]).toBe('Firefox');
  });

  it('posts JSON bodies', async () => {
    const fetchImpl = vi.fn(async () => response(200, { session_id: 's' }));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await client.post('/sessions', { code: 'abc' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"code":"abc"}');
  });

  it('retries transient failures twice with backoff then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/aspsps')).resolves.toEqual({ ok: true });
    expect(sleep.mock.calls.slice(-2)).toEqual([[1000], [4000]]);
  });

  it('gives up after three transient failures', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/aspsps')).rejects.toMatchObject({ type: 'TRANSIENT' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry an expired consent', async () => {
    const fetchImpl = vi.fn(async () => response(401));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/accounts/x/transactions')).rejects.toMatchObject({ type: 'EXPIRED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON bodies as invalid responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.get('/aspsps')).rejects.toBeInstanceOf(ProviderError);
  });

  it('never puts the request path in error messages', async () => {
    const fetchImpl = vi.fn(async () => response(404));
    const client = createEbClient({ jwt: () => 'jwt', fetchImpl, sleep });
    await expect(client.delete('/sessions/secret-session-id')).rejects.not.toThrow(/secret-session-id/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/enableBankingClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/sync/providers/enableBankingClient.ts`:
```ts
import { sign } from 'jsonwebtoken';
import { ProviderError, classifyHttpStatus } from '../errors';
import type { PsuContext } from '../types';

export const EB_API_BASE = 'https://api.enablebanking.com';
export const PSU_IP_HEADER = 'Psu-Ip-Address';
export const PSU_USER_AGENT_HEADER = 'Psu-User-Agent';

const JWT_LIFETIME_S = 3600;
const JWT_REFRESH_MARGIN_S = 300;
const RETRY_DELAYS_MS = [1000, 4000];

export interface EbCredentials {
  applicationId: string;
  privateKeyPem: string;
}

export function createJwtSource(credentials: EbCredentials, nowMs: () => number): () => string {
  let cached: { token: string; exp: number } | null = null;
  return () => {
    const now = Math.floor(nowMs() / 1000);
    if (cached && cached.exp - now > JWT_REFRESH_MARGIN_S) return cached.token;
    const exp = now + JWT_LIFETIME_S;
    const token = sign(
      { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp },
      credentials.privateKeyPem,
      { algorithm: 'RS256', keyid: credentials.applicationId },
    );
    cached = { token, exp };
    return token;
  };
}

export interface EbClient {
  get(path: string, query?: Record<string, string>, psu?: PsuContext): Promise<unknown>;
  post(path: string, body: unknown, psu?: PsuContext): Promise<unknown>;
  delete(path: string): Promise<void>;
}

export interface EbClientOptions {
  jwt: () => string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestSpec {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  psu?: PsuContext;
}

export function createEbClient(options: EbClientOptions): EbClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  async function attempt(spec: RequestSpec): Promise<unknown> {
    const url = new URL(spec.path, EB_API_BASE);
    for (const [key, value] of Object.entries(spec.query ?? {})) url.searchParams.set(key, value);

    const headers: Record<string, string> = { Authorization: `Bearer ${options.jwt()}`, Accept: 'application/json' };
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.psu) {
      headers[PSU_IP_HEADER] = spec.psu.ipAddress;
      headers[PSU_USER_AGENT_HEADER] = spec.psu.userAgent;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      });
    } catch {
      throw new ProviderError('TRANSIENT', `Enable Banking ${spec.method} request failed to connect`);
    }

    if (!response.ok) {
      throw new ProviderError(classifyHttpStatus(response.status), `Enable Banking ${spec.method} returned HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('INVALID_RESPONSE', `Enable Banking ${spec.method} returned a non-JSON body`);
    }
  }

  async function send(spec: RequestSpec): Promise<unknown> {
    for (let attemptIndex = 0; ; attemptIndex++) {
      try {
        return await attempt(spec);
      } catch (error) {
        const retryable = error instanceof ProviderError && error.type === 'TRANSIENT';
        if (!retryable || attemptIndex >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attemptIndex]);
      }
    }
  }

  return {
    get: (path, query, psu) => send({ method: 'GET', path, query, psu }),
    post: (path, body, psu) => send({ method: 'POST', path, body, psu }),
    delete: async path => { await send({ method: 'DELETE', path }); },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run src/sync/__tests__/enableBankingClient.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sync/providers/enableBankingClient.ts src/sync/__tests__/enableBankingClient.test.ts
git commit -m "feat(sync): add Enable Banking JWT source and retrying HTTP client"
```

---

### Task 7: Enable Banking provider

**Files:**
- Create: `src/sync/providers/enableBanking.ts`
- Test: `src/sync/__tests__/enableBanking.test.ts`

**Interfaces:**
- Consumes: `EbClient` (Task 6), `normaliseEbTransaction` (Task 4), `SessionAccount` (Task 3), `isRecord`.
- Produces:
  - `EbBank { name: string; country: string; logo: string; maximumConsentValiditySeconds: number }`
  - `EbSession { sessionId: string; consentValidUntil: string; accounts: SessionAccount[] }`
  - `EnableBankingApi extends BankProvider` with `listBanks(country: string): Promise<EbBank[]>`, `startAuth(input: StartAuthInput): Promise<string>`, `completeAuth(code: string, psu: PsuContext): Promise<EbSession>`, `endSession(sessionId: string): Promise<void>`
  - `StartAuthInput { aspspName: string; country: string; state: string; redirectUrl: string; validUntil: string; psu: PsuContext }`
  - `createEnableBankingProvider(client: EbClient): EnableBankingApi`
  - `isAllowedAuthUrl(value: string): boolean`
  - `MAX_TRANSACTION_PAGES = 50`, `DEFAULT_CONSENT_SECONDS = 90 * 24 * 60 * 60`

- [ ] **Step 1: Confirm response shapes against the sandbox**

With the sandbox application from build-order task 0.4, call `GET /aspsps?country=GB`, `POST /auth` and `POST /sessions` once (e.g. from a scratch script using Task 6's client) and confirm: `aspsps[].maximum_consent_validity` is in **seconds**; `POST /auth` returns `url` on an `enablebanking.com` host; session `accounts[]` has `uid`, `currency`, optional `name`/`product`, and `account_id.iban` or `account_id.other.identification`. Adjust the parser and fixtures below if any differ, and record differences for Task 22. Do not commit real responses.

- [ ] **Step 2: Write the failing test**

`src/sync/__tests__/enableBanking.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createEnableBankingProvider, isAllowedAuthUrl, MAX_TRANSACTION_PAGES } from '../providers/enableBanking';
import type { EbClient } from '../providers/enableBankingClient';
import type { ConnectedAccount, EnableBankingConnection } from '../types';

const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };

function fakeClient(overrides: Partial<EbClient> = {}): EbClient {
  return { get: vi.fn(), post: vi.fn(), delete: vi.fn(), ...overrides };
}

const account: ConnectedAccount = {
  accountUid: 'acc/1', dedupeId: 'acc/1', displayName: 'Current', last4: '1234', currency: 'GBP', startDate: '2026-09-01',
};
const connection: EnableBankingConnection = {
  connectionId: 'c1', provider: 'enable-banking', displayName: 'Lloyds', status: 'ACTIVE', consecutiveFailures: 0,
  accounts: [account], auth: { sessionId: 's1', consentValidUntil: '2027-01-01T00:00:00.000Z' },
  createdAt: 't', updatedAt: 't',
};

const booked = (ref: string) => ({
  entry_reference: ref, transaction_amount: { amount: '1.00', currency: 'GBP' },
  credit_debit_indicator: 'DBIT', booking_date: '2026-09-10', remittance_information: ['SHOP'],
});

describe('isAllowedAuthUrl', () => {
  it.each([
    ['https://tilisy.enablebanking.com/welcome?x=1', true],
    ['https://enablebanking.com/auth', true],
    ['http://tilisy.enablebanking.com/', false],
    ['https://enablebanking.com.evil.example/', false],
    ['https://evilenablebanking.com/', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isAllowedAuthUrl(url)).toBe(expected);
  });
});

describe('listBanks', () => {
  it('maps ASPSPs and defaults a missing consent validity to 90 days', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        aspsps: [
          { name: 'Lloyds Bank', country: 'GB', logo: 'https://x/logo.png', maximum_consent_validity: 15552000 },
          { name: 'Other', country: 'GB' },
        ],
      })),
    });
    const banks = await createEnableBankingProvider(client).listBanks('GB');
    expect(client.get).toHaveBeenCalledWith('/aspsps', { country: 'GB' });
    expect(banks).toEqual([
      { name: 'Lloyds Bank', country: 'GB', logo: 'https://x/logo.png', maximumConsentValiditySeconds: 15552000 },
      { name: 'Other', country: 'GB', logo: '', maximumConsentValiditySeconds: 7776000 },
    ]);
  });
});

describe('startAuth', () => {
  it('posts the authorisation request and returns the url', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ url: 'https://tilisy.enablebanking.com/a' })) });
    const url = await createEnableBankingProvider(client).startAuth({
      aspspName: 'Lloyds Bank', country: 'GB', state: 'state-1', redirectUrl: 'https://app.example/banks/callback',
      validUntil: '2027-03-01T00:00:00.000Z', psu,
    });
    expect(url).toBe('https://tilisy.enablebanking.com/a');
    expect(client.post).toHaveBeenCalledWith('/auth', {
      access: { valid_until: '2027-03-01T00:00:00.000Z' },
      aspsp: { name: 'Lloyds Bank', country: 'GB' },
      state: 'state-1',
      redirect_url: 'https://app.example/banks/callback',
      psu_type: 'personal',
    }, psu);
  });
});

describe('completeAuth', () => {
  it('maps the session and derives display names and last4', async () => {
    const client = fakeClient({
      post: vi.fn(async () => ({
        session_id: 'sess-1',
        access: { valid_until: '2027-03-01T00:00:00.000Z' },
        accounts: [
          { uid: 'u1', currency: 'GBP', name: 'Classic', account_id: { iban: 'GB33 BUKB 2020 1555 5555 55' } },
          { uid: 'u2', currency: 'GBP', product: 'Saver', account_id: { other: { identification: '30963212345678' } } },
          { uid: 'u3', currency: 'EUR' },
        ],
      })),
    });
    const session = await createEnableBankingProvider(client).completeAuth('code-1', psu);
    expect(client.post).toHaveBeenCalledWith('/sessions', { code: 'code-1' }, psu);
    expect(session).toEqual({
      sessionId: 'sess-1',
      consentValidUntil: '2027-03-01T00:00:00.000Z',
      accounts: [
        { accountUid: 'u1', displayName: 'Classic', last4: '5555', currency: 'GBP' },
        { accountUid: 'u2', displayName: 'Saver', last4: '5678', currency: 'GBP' },
        { accountUid: 'u3', displayName: 'Account', last4: '', currency: 'EUR' },
      ],
    });
  });

  it('rejects a malformed session', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ accounts: [] })) });
    await expect(createEnableBankingProvider(client).completeAuth('code', psu)).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});

describe('fetchTransactions', () => {
  it('follows continuation keys and normalises every page', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ transactions: [booked('a')], continuation_key: 'next' })
      .mockResolvedValueOnce({ transactions: [booked('b')] });
    const provider = createEnableBankingProvider(fakeClient({ get }));
    const result = await provider.fetchTransactions(connection, account, { from: '2026-09-01', to: '2026-09-13' }, { psu, deadline: 0 });
    expect(result.map(t => t.entryReference)).toEqual(['a', 'b']);
    expect(get).toHaveBeenNthCalledWith(1, '/accounts/acc%2F1/transactions',
      { date_from: '2026-09-01', date_to: '2026-09-13', transaction_status: 'BOOK' }, psu);
    expect(get.mock.calls[1][1]).toMatchObject({ continuation_key: 'next' });
  });

  it('fails rather than silently truncating after the page cap', async () => {
    const get = vi.fn(async () => ({ transactions: [], continuation_key: 'again' }));
    const provider = createEnableBankingProvider(fakeClient({ get }));
    await expect(provider.fetchTransactions(connection, account, { from: '2026-09-01', to: '2026-09-13' }, { deadline: 0 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
    expect(get).toHaveBeenCalledTimes(MAX_TRANSACTION_PAGES);
  });

  it('rejects a response without a transactions array', async () => {
    const provider = createEnableBankingProvider(fakeClient({ get: vi.fn(async () => ({})) }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: 0 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});

describe('endSession', () => {
  it('deletes the session with an encoded id', async () => {
    const client = fakeClient();
    await createEnableBankingProvider(client).endSession('s/1');
    expect(client.delete).toHaveBeenCalledWith('/sessions/s%2F1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/enableBanking.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/sync/providers/enableBanking.ts`:
```ts
import { isRecord } from '../../api/body';
import type { SessionAccount } from '../accounts';
import { ProviderError } from '../errors';
import type { BankProvider, PsuContext, ProviderTransaction } from '../types';
import type { EbClient } from './enableBankingClient';
import { normaliseEbTransaction } from './enableBankingNormalise';

export const MAX_TRANSACTION_PAGES = 50;
export const DEFAULT_CONSENT_SECONDS = 90 * 24 * 60 * 60;
const AUTH_HOST = 'enablebanking.com';

export interface EbBank {
  name: string;
  country: string;
  logo: string;
  maximumConsentValiditySeconds: number;
}

export interface EbSession {
  sessionId: string;
  consentValidUntil: string;
  accounts: SessionAccount[];
}

export interface StartAuthInput {
  aspspName: string;
  country: string;
  state: string;
  redirectUrl: string;
  validUntil: string;
  psu: PsuContext;
}

export interface EnableBankingApi extends BankProvider {
  listBanks(country: string): Promise<EbBank[]>;
  startAuth(input: StartAuthInput): Promise<string>;
  completeAuth(code: string, psu: PsuContext): Promise<EbSession>;
  endSession(sessionId: string): Promise<void>;
}

export function isAllowedAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === AUTH_HOST || url.hostname.endsWith(`.${AUTH_HOST}`));
  } catch {
    return false;
  }
}

function invalid(what: string): ProviderError {
  return new ProviderError('INVALID_RESPONSE', `Enable Banking ${what} has an unexpected shape`);
}

function lastFour(accountId: unknown): string {
  if (!isRecord(accountId)) return '';
  const other = isRecord(accountId.other) ? accountId.other.identification : undefined;
  const identifier = typeof accountId.iban === 'string' ? accountId.iban : other;
  return typeof identifier === 'string' ? identifier.replace(/\s/g, '').slice(-4) : '';
}

function parseSessionAccount(raw: unknown): SessionAccount {
  if (!isRecord(raw) || typeof raw.uid !== 'string' || typeof raw.currency !== 'string') throw invalid('session account');
  const name = typeof raw.name === 'string' && raw.name ? raw.name : undefined;
  const product = typeof raw.product === 'string' && raw.product ? raw.product : undefined;
  return { accountUid: raw.uid, displayName: name ?? product ?? 'Account', last4: lastFour(raw.account_id), currency: raw.currency };
}

export function createEnableBankingProvider(client: EbClient): EnableBankingApi {
  return {
    id: 'enable-banking',

    async listBanks(country) {
      const response = await client.get('/aspsps', { country });
      if (!isRecord(response) || !Array.isArray(response.aspsps)) throw invalid('ASPSP list');
      return response.aspsps.filter(isRecord).flatMap(bank => {
        if (typeof bank.name !== 'string' || typeof bank.country !== 'string') return [];
        return [{
          name: bank.name,
          country: bank.country,
          logo: typeof bank.logo === 'string' ? bank.logo : '',
          maximumConsentValiditySeconds: typeof bank.maximum_consent_validity === 'number'
            ? bank.maximum_consent_validity
            : DEFAULT_CONSENT_SECONDS,
        }];
      });
    },

    async startAuth(input) {
      const response = await client.post('/auth', {
        access: { valid_until: input.validUntil },
        aspsp: { name: input.aspspName, country: input.country },
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: 'personal',
      }, input.psu);
      if (!isRecord(response) || typeof response.url !== 'string') throw invalid('authorisation response');
      return response.url;
    },

    async completeAuth(code, psu) {
      const response = await client.post('/sessions', { code }, psu);
      if (
        !isRecord(response)
        || typeof response.session_id !== 'string'
        || !isRecord(response.access)
        || typeof response.access.valid_until !== 'string'
        || !Array.isArray(response.accounts)
      ) {
        throw invalid('session');
      }
      return {
        sessionId: response.session_id,
        consentValidUntil: response.access.valid_until,
        accounts: response.accounts.map(parseSessionAccount),
      };
    },

    async endSession(sessionId) {
      await client.delete(`/sessions/${encodeURIComponent(sessionId)}`);
    },

    async fetchTransactions(_connection, account, window, ctx) {
      const results: ProviderTransaction[] = [];
      let continuationKey: string | undefined;
      for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
        const query: Record<string, string> = { date_from: window.from, date_to: window.to, transaction_status: 'BOOK' };
        if (continuationKey) query.continuation_key = continuationKey;
        const response = await client.get(`/accounts/${encodeURIComponent(account.accountUid)}/transactions`, query, ctx.psu);
        if (!isRecord(response) || !Array.isArray(response.transactions)) throw invalid('transactions response');
        for (const raw of response.transactions) {
          const transaction = normaliseEbTransaction(raw, account.startDate);
          if (transaction) results.push(transaction);
        }
        continuationKey = typeof response.continuation_key === 'string' && response.continuation_key
          ? response.continuation_key
          : undefined;
        if (!continuationKey) return results;
      }
      throw new ProviderError('INVALID_RESPONSE', `Enable Banking returned more than ${MAX_TRANSACTION_PAGES} pages`);
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run src/sync/__tests__/enableBanking.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sync/providers/enableBanking.ts src/sync/__tests__/enableBanking.test.ts
git commit -m "feat(sync): add Enable Banking provider for banks, auth, sessions and transactions"
```

---

## Phase D — Sync algorithm

### Task 8: runSync with in-memory fakes

**Files:**
- Create: `src/sync/runSync.ts`, `src/sync/__tests__/fakes.ts`
- Test: `src/sync/__tests__/runSync.test.ts`

**Interfaces:**
- Consumes: `SyncStore` (Task 5), `BankProvider` and types (Task 1), `syncWindow` (Task 2), `deriveTxnKeys` (Task 3), `classifyProviderError`, `Logger` (Task 4).
- Produces:
  - `RunSyncDeps { store: SyncStore; providers: Record<ProviderId, BankProvider>; now: () => number; deadline: number; log: Logger }`
  - `UserSyncOutcome = SyncResult | 'LOCKED' | 'FAILED'`
  - `runSync(deps: RunSyncDeps, userIds: string[], psu?: PsuContext): Promise<Record<string, UserSyncOutcome>>`
  - `toInboxItem(transaction: ProviderTransaction, txnKey: string, connectionId: string, accountUid: string, importedAt: string): InboxItem`
  - `LOCK_STALE_MS`, `MIN_ACCOUNT_BUDGET_MS`, `ERROR_THRESHOLD`
  - Test helpers in `fakes.ts`: `FakeSyncStore`, `FakeProvider`, `makeTxn`, `makeAccount`, `makeConnection` (also used by Task 9)

- [ ] **Step 1: Write the fakes**

`src/sync/__tests__/fakes.ts`:
```ts
import type { SyncStore } from '../store';
import type {
  BankProvider, ConnectedAccount, Connection, EnableBankingConnection, FetchContext, InboxItem,
  PendingAuth, ProviderTransaction, PsuContext, SeenOutcome, SyncResult, SyncStatus, SyncWindow,
} from '../types';

const key = (userId: string, id: string) => `${userId}|${id}`;

export class FakeSyncStore implements SyncStore {
  users = new Set<string>();
  statuses = new Map<string, SyncStatus>();
  connections = new Map<string, Connection>();
  pendingAuths = new Map<string, PendingAuth>();
  seen = new Map<string, SeenOutcome>();
  inbox = new Map<string, InboxItem>();

  async listSyncUserIds() { return [...this.users]; }
  async registerSyncUser(userId: string) { this.users.add(userId); }
  async unregisterSyncUser(userId: string) { this.users.delete(userId); }

  async acquireLock(userId: string, nowIso: string, staleBeforeIso: string) {
    const current = this.statuses.get(userId);
    if (current?.state === 'RUNNING' && current.startedAt && current.startedAt >= staleBeforeIso) return false;
    this.statuses.set(userId, { ...current, state: 'RUNNING', startedAt: nowIso });
    return true;
  }

  async releaseLock(userId: string, nowIso: string, result: SyncResult) {
    const current = this.statuses.get(userId);
    this.statuses.set(userId, { ...current, state: 'IDLE', finishedAt: nowIso, lastResult: { ...result } });
  }

  async getSyncStatus(userId: string) { return this.statuses.get(userId) ?? null; }

  async listConnections(userId: string) {
    return [...this.connections.entries()]
      .filter(([k]) => k.startsWith(`${userId}|`))
      .map(([, c]) => structuredClone(c));
  }

  async getConnection(userId: string, connectionId: string) {
    const found = this.connections.get(key(userId, connectionId));
    return found ? structuredClone(found) : null;
  }

  async putConnection(userId: string, connection: Connection) {
    this.connections.set(key(userId, connection.connectionId), structuredClone(connection));
  }

  async replaceConnectionIfUnchanged(userId: string, connection: Connection, expectedUpdatedAt: string) {
    const current = this.connections.get(key(userId, connection.connectionId));
    if (!current || current.updatedAt !== expectedUpdatedAt) return false;
    this.connections.set(key(userId, connection.connectionId), structuredClone(connection));
    return true;
  }

  async deleteConnection(userId: string, connectionId: string) {
    this.connections.delete(key(userId, connectionId));
  }

  async putPendingAuth(userId: string, auth: PendingAuth) { this.pendingAuths.set(key(userId, auth.state), { ...auth }); }

  async getPendingAuth(userId: string, state: string, nowMs: number) {
    const found = this.pendingAuths.get(key(userId, state));
    return found && found.expiresAt > Math.floor(nowMs / 1000) ? { ...found } : null;
  }

  async deletePendingAuth(userId: string, state: string) { this.pendingAuths.delete(key(userId, state)); }

  async filterUnseen(userId: string, txnKeys: string[]) {
    return new Set(txnKeys.filter(txnKey => !this.seen.has(key(userId, txnKey))));
  }

  async importItem(userId: string, item: InboxItem) {
    const k = key(userId, item.txnKey);
    if (this.seen.has(k)) return 'ALREADY_SEEN' as const;
    this.seen.set(k, 'PENDING');
    this.inbox.set(k, structuredClone(item));
    return 'IMPORTED' as const;
  }

  async deletePendingItemsForConnection(userId: string, connectionId: string) {
    let deleted = 0;
    for (const [k, item] of this.inbox) {
      if (!k.startsWith(`${userId}|`) || item.connectionId !== connectionId) continue;
      this.inbox.delete(k);
      this.seen.delete(k);
      deleted += 1;
    }
    return deleted;
  }

  inboxFor(userId: string): InboxItem[] {
    return [...this.inbox.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, item]) => item);
  }

  connectionFor(userId: string, connectionId: string): Connection | undefined {
    return this.connections.get(key(userId, connectionId));
  }
}

export type ScriptedResponse = ProviderTransaction[] | Error;

export class FakeProvider implements BankProvider {
  readonly id = 'enable-banking' as const;
  readonly calls: { accountUid: string; window: SyncWindow; psu?: PsuContext }[] = [];
  private readonly scripts = new Map<string, ScriptedResponse[]>();

  script(accountUid: string, ...responses: ScriptedResponse[]): this {
    this.scripts.set(accountUid, responses);
    return this;
  }

  async fetchTransactions(_connection: Connection, account: ConnectedAccount, window: SyncWindow, ctx: FetchContext) {
    this.calls.push({ accountUid: account.accountUid, window, psu: ctx.psu });
    const next = this.scripts.get(account.accountUid)?.shift() ?? [];
    if (next instanceof Error) throw next;
    return next.map(t => ({ ...t }));
  }
}

export function makeTxn(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  const t = {
    entryReference: 'ref-1', amountPence: 1234, direction: 'OUT' as const,
    bookingDate: '2026-09-10', description: 'TESCO STORES', currency: 'GBP', ...overrides,
  };
  return { ...t, fallbackBasis: overrides.fallbackBasis ?? [t.bookingDate, t.amountPence, t.direction, t.description].join('|') };
}

export function makeAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  const accountUid = overrides.accountUid ?? 'acc-1';
  return {
    accountUid, dedupeId: accountUid, displayName: 'Current Account', last4: '1234',
    currency: 'GBP', startDate: '2026-09-01', ...overrides,
  };
}

export function makeConnection(overrides: Partial<EnableBankingConnection> = {}): EnableBankingConnection {
  return {
    connectionId: '11111111-1111-4111-8111-111111111111',
    provider: 'enable-banking',
    displayName: 'Lloyds Bank',
    status: 'ACTIVE',
    consecutiveFailures: 0,
    accounts: [makeAccount()],
    auth: { sessionId: 'session-1', consentValidUntil: '2027-03-01T00:00:00.000Z' },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing test**

`src/sync/__tests__/runSync.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSync, LOCK_STALE_MS } from '../runSync';
import type { RunSyncDeps } from '../runSync';
import { ProviderError } from '../errors';
import { FakeProvider, FakeSyncStore, makeAccount, makeConnection, makeTxn } from './fakes';

const USER = 'auth0|user-1';
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

let store: FakeSyncStore;
let provider: FakeProvider;
let clock: number;

function deps(overrides: Partial<RunSyncDeps> = {}): RunSyncDeps {
  return {
    store, providers: { 'enable-banking': provider }, now: () => clock,
    deadline: NOW + 300_000, log: vi.fn(), ...overrides,
  };
}

beforeEach(async () => {
  store = new FakeSyncStore();
  provider = new FakeProvider();
  clock = NOW;
});

describe('runSync imports', () => {
  it('writes new transactions to the inbox with a type suggested from direction', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [makeTxn({ entryReference: 'a' }), makeTxn({ entryReference: 'b', direction: 'IN' })]);

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toEqual({ imported: 2, skipped: 0, failedAccounts: 0, partial: false });
    expect(store.inboxFor(USER).map(i => i.suggestedType).sort()).toEqual(['EXPENSE', 'INCOME']);
  });

  it('does not duplicate transactions across runs', async () => {
    await store.putConnection(USER, makeConnection());
    const batch = [makeTxn({ entryReference: 'a' }), makeTxn({ entryReference: 'b' })];
    provider.script('acc-1', batch, batch);

    await runSync(deps(), [USER]);
    clock += 6 * 3_600_000;
    const second = await runSync(deps(), [USER]);

    expect(store.inboxFor(USER)).toHaveLength(2);
    expect(second[USER]).toMatchObject({ imported: 0, skipped: 2 });
  });

  it('uses startDate first and a five-day overlap afterwards', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [], []);

    await runSync(deps(), [USER]);
    await runSync(deps(), [USER]);

    expect(provider.calls[0].window).toEqual({ from: '2026-09-01', to: '2026-09-13' });
    expect(provider.calls[1].window).toEqual({ from: '2026-09-08', to: '2026-09-13' });
  });

  it('passes PSU context to the provider for manual syncs', async () => {
    await store.putConnection(USER, makeConnection());
    const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };

    await runSync(deps(), [USER], psu);

    expect(provider.calls[0].psu).toEqual(psu);
  });

  it('counts a seen-marker conflict from a concurrent run as skipped', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [makeTxn({ entryReference: 'a' })]);
    vi.spyOn(store, 'filterUnseen').mockImplementation(async (_u, keys) => new Set(keys));
    vi.spyOn(store, 'importItem').mockResolvedValue('ALREADY_SEEN');

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toMatchObject({ imported: 0, skipped: 1 });
  });
});

describe('runSync failures', () => {
  it('keeps lastSyncedAt when an account fails and still syncs other accounts', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('TRANSIENT', 'down')).script('acc-2', [makeTxn()]);

    const results = await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(results[USER]).toMatchObject({ imported: 1, failedAccounts: 1 });
    expect(saved.accounts.find(a => a.accountUid === 'acc-1')?.lastSyncedAt).toBeUndefined();
    expect(saved.accounts.find(a => a.accountUid === 'acc-2')?.lastSyncedAt).toBe(iso(NOW));
  });

  it('increments consecutive failures once per run and marks ERROR at the threshold', async () => {
    await store.putConnection(USER, makeConnection({
      consecutiveFailures: 2,
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('TRANSIENT', 'down')).script('acc-2', new ProviderError('TRANSIENT', 'down'));

    await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(saved.consecutiveFailures).toBe(3);
    expect(saved.status).toBe('ERROR');
    expect(saved.lastError).toEqual({ type: 'TRANSIENT', at: iso(NOW) });
  });

  it('resets an ERROR connection after a successful account sync', async () => {
    await store.putConnection(USER, makeConnection({ status: 'ERROR', consecutiveFailures: 3, lastError: { type: 'TRANSIENT', at: 'x' } }));
    provider.script('acc-1', []);

    await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(saved).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0 });
    expect(saved.lastError).toBeUndefined();
  });

  it('marks the connection EXPIRED and skips its remaining accounts', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('EXPIRED', 'revoked'));

    await runSync(deps(), [USER]);

    expect(store.connectionFor(USER, makeConnection().connectionId)?.status).toBe('EXPIRED');
    expect(provider.calls.map(c => c.accountUid)).toEqual(['acc-1']);
  });

  it('does not let an expired connection affect other connections', async () => {
    await store.putConnection(USER, makeConnection({ connectionId: 'c-1', accounts: [makeAccount({ accountUid: 'acc-1' })] }));
    await store.putConnection(USER, makeConnection({ connectionId: 'c-2', accounts: [makeAccount({ accountUid: 'acc-2' })] }));
    provider.script('acc-1', new ProviderError('EXPIRED', 'revoked')).script('acc-2', [makeTxn()]);

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toMatchObject({ imported: 1 });
    expect(store.connectionFor(USER, 'c-2')?.status).toBe('ACTIVE');
  });

  it('stops a connection for this run when rate limited', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('RATE_LIMITED', 'slow'));

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(1);
  });

  it('expires a connection whose consent has passed without calling the provider', async () => {
    await store.putConnection(USER, makeConnection({ auth: { sessionId: 's', consentValidUntil: iso(NOW - 1) } }));

    await runSync(deps(), [USER]);

    expect(store.connectionFor(USER, makeConnection().connectionId)?.status).toBe('EXPIRED');
    expect(provider.calls).toHaveLength(0);
  });

  it('skips connections that are already EXPIRED', async () => {
    await store.putConnection(USER, makeConnection({ status: 'EXPIRED' }));

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(0);
  });

  it('stops the connection when it was changed during the sync', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    vi.spyOn(store, 'replaceConnectionIfUnchanged').mockResolvedValue(false);

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(1);
  });

  it('continues with other users when one user fails and still releases the lock', async () => {
    await store.putConnection('user-b', makeConnection());
    const original = store.listConnections.bind(store);
    vi.spyOn(store, 'listConnections').mockImplementation(async userId => {
      if (userId === USER) throw new Error('boom');
      return original(userId);
    });

    const results = await runSync(deps(), [USER, 'user-b']);

    expect(results[USER]).toBe('FAILED');
    expect(results['user-b']).toMatchObject({ failedAccounts: 0 });
    expect(store.statuses.get(USER)?.state).toBe('IDLE');
  });
});

describe('runSync locking and deadline', () => {
  it('skips a user whose lock is held', async () => {
    await store.putConnection(USER, makeConnection());
    store.statuses.set(USER, { state: 'RUNNING', startedAt: iso(NOW - 60_000) });

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toBe('LOCKED');
    expect(provider.calls).toHaveLength(0);
  });

  it('takes over a stale lock', async () => {
    await store.putConnection(USER, makeConnection());
    store.statuses.set(USER, { state: 'RUNNING', startedAt: iso(NOW - LOCK_STALE_MS - 1) });

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(1);
  });

  it('releases the lock with the result', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [makeTxn()]);

    await runSync(deps(), [USER]);

    expect(store.statuses.get(USER)).toMatchObject({
      state: 'IDLE', finishedAt: iso(NOW), lastResult: { imported: 1, skipped: 0, failedAccounts: 0, partial: false },
    });
  });

  it('stops before an account when less than a minute remains', async () => {
    await store.putConnection(USER, makeConnection());

    const results = await runSync(deps({ deadline: NOW + 30_000 }), [USER]);

    expect(results[USER]).toMatchObject({ partial: true });
    expect(provider.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/runSync.test.ts`
Expected: FAIL — cannot resolve `../runSync`.

- [ ] **Step 4: Implement**

`src/sync/runSync.ts`:
```ts
import { classifyProviderError } from './errors';
import type { Logger } from './log';
import type { SyncStore } from './store';
import { deriveTxnKeys } from './txnKey';
import type {
  BankProvider, ConnectedAccount, Connection, ConnectionStatus, InboxItem,
  ProviderId, ProviderTransaction, PsuContext, SyncResult,
} from './types';
import { syncWindow } from './window';

export const LOCK_STALE_MS = 10 * 60_000;
export const MIN_ACCOUNT_BUDGET_MS = 60_000;
export const ERROR_THRESHOLD = 3;

export interface RunSyncDeps {
  store: SyncStore;
  providers: Record<ProviderId, BankProvider>;
  now: () => number;
  deadline: number;
  log: Logger;
}

export type UserSyncOutcome = SyncResult | 'LOCKED' | 'FAILED';

type ConnectionPatch = Partial<Pick<Connection, 'accounts' | 'status' | 'consecutiveFailures' | 'lastError'>>;

const toIso = (ms: number): string => new Date(ms).toISOString();

export function toInboxItem(
  transaction: ProviderTransaction,
  txnKey: string,
  connectionId: string,
  accountUid: string,
  importedAt: string,
): InboxItem {
  return {
    txnKey,
    amount: transaction.amountPence,
    direction: transaction.direction,
    suggestedType: transaction.direction === 'IN' ? 'INCOME' : 'EXPENSE',
    description: transaction.description,
    bookingDate: transaction.bookingDate,
    connectionId,
    accountUid,
    importedAt,
  };
}

export async function runSync(deps: RunSyncDeps, userIds: string[], psu?: PsuContext): Promise<Record<string, UserSyncOutcome>> {
  const results: Record<string, UserSyncOutcome> = {};
  for (const userId of userIds) {
    try {
      results[userId] = await syncUser(deps, userId, psu);
    } catch (error) {
      results[userId] = 'FAILED';
      deps.log('sync.user_failed', { errorType: classifyProviderError(error) });
    }
  }
  return results;
}

async function syncUser(deps: RunSyncDeps, userId: string, psu?: PsuContext): Promise<SyncResult | 'LOCKED'> {
  const startedAt = deps.now();
  const acquired = await deps.store.acquireLock(userId, toIso(startedAt), toIso(startedAt - LOCK_STALE_MS));
  if (!acquired) return 'LOCKED';

  const result: SyncResult = { imported: 0, skipped: 0, failedAccounts: 0, partial: false };
  try {
    const connections = await deps.store.listConnections(userId);
    for (const connection of connections) {
      await syncConnection(deps, userId, connection, result, psu);
      if (result.partial) break;
    }
  } finally {
    await deps.store.releaseLock(userId, toIso(deps.now()), result);
  }

  deps.log('sync.user_done', {
    imported: result.imported,
    skipped: result.skipped,
    failedAccounts: result.failedAccounts,
    partial: result.partial,
    durationMs: deps.now() - startedAt,
  });
  return result;
}

async function syncConnection(
  deps: RunSyncDeps,
  userId: string,
  initial: Connection,
  result: SyncResult,
  psu?: PsuContext,
): Promise<void> {
  if (initial.status === 'EXPIRED') return;

  let connection = initial;
  let failureRecorded = false;

  const save = async (patch: ConnectionPatch): Promise<boolean> => {
    const next: Connection = { ...connection, ...patch, updatedAt: toIso(deps.now()) };
    const saved = await deps.store.replaceConnectionIfUnchanged(userId, next, connection.updatedAt);
    if (saved) connection = next;
    return saved;
  };

  if (Date.parse(connection.auth.consentValidUntil) <= deps.now()) {
    await save({ status: 'EXPIRED' });
    return;
  }

  const provider = deps.providers[connection.provider];

  for (const account of initial.accounts) {
    if (deps.deadline - deps.now() < MIN_ACCOUNT_BUDGET_MS) {
      result.partial = true;
      return;
    }

    try {
      const window = syncWindow(account, toIso(deps.now()).slice(0, 10));
      const transactions = await provider.fetchTransactions(connection, account, window, { psu, deadline: deps.deadline });
      const counts = await importTransactions(deps, userId, connection, account, transactions);
      result.imported += counts.imported;
      result.skipped += counts.skipped;

      const syncedAt = toIso(deps.now());
      const accounts = connection.accounts.map(a => (a.accountUid === account.accountUid ? { ...a, lastSyncedAt: syncedAt } : a));
      const saved = await save({ accounts, status: 'ACTIVE', consecutiveFailures: 0, lastError: undefined });
      if (!saved) return;
    } catch (error) {
      const type = classifyProviderError(error);
      result.failedAccounts += 1;
      deps.log('sync.account_failed', { connectionId: connection.connectionId, errorType: type });
      const lastError = { type, at: toIso(deps.now()) };

      if (type === 'EXPIRED') {
        await save({ status: 'EXPIRED', lastError });
        return;
      }

      if (!failureRecorded) {
        failureRecorded = true;
        const consecutiveFailures = connection.consecutiveFailures + 1;
        const status: ConnectionStatus = consecutiveFailures >= ERROR_THRESHOLD ? 'ERROR' : connection.status;
        const saved = await save({ consecutiveFailures, status, lastError });
        if (!saved) return;
      }

      if (type === 'RATE_LIMITED') return;
    }
  }
}

async function importTransactions(
  deps: RunSyncDeps,
  userId: string,
  connection: Connection,
  account: ConnectedAccount,
  transactions: ProviderTransaction[],
): Promise<{ imported: number; skipped: number }> {
  const keys = deriveTxnKeys(connection.provider, account.dedupeId, transactions);
  const unseen = await deps.store.filterUnseen(userId, keys);
  const importedAt = toIso(deps.now());
  let imported = 0;
  let skipped = 0;

  for (const [index, transaction] of transactions.entries()) {
    const txnKey = keys[index];
    if (!unseen.has(txnKey)) {
      skipped += 1;
      continue;
    }
    const item = toInboxItem(transaction, txnKey, connection.connectionId, account.accountUid, importedAt);
    const outcome = await deps.store.importItem(userId, item);
    if (outcome === 'IMPORTED') imported += 1;
    else skipped += 1;
  }

  return { imported, skipped };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run src/sync/__tests__/runSync.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/sync/runSync.ts src/sync/__tests__/fakes.ts src/sync/__tests__/runSync.test.ts
git commit -m "feat(sync): add runSync with locking, dedupe, failure handling and deadline"
```

---

## Phase E — Bank worker

### Task 9: Worker command parsing and execution

**Files:**
- Create: `src/sync/commands.ts`
- Test: `src/sync/__tests__/commands.test.ts`

**Interfaces:**
- Consumes: `runSync`, `RunSyncDeps` (Task 8); `EnableBankingApi`, `EbBank`, `isAllowedAuthUrl` (Task 7); `matchAccounts` (Task 3); `isRecord`, `hasOnlyKeys`, `UUID_RE`, `DATE_RE` (Task 1); fakes (Task 8).
- Produces:
  - `WorkerCommand` union: `listBanks { country }`, `startAuth { userId, aspspName, country, startDate, connectionId?, psu }`, `completeAuth { userId, state, code, psu }`, `syncNow { userId, psu }`, `disconnect { userId, connectionId }` — all with `command` discriminator
  - `WorkerErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'UPSTREAM'`
  - `WorkerResult<T> = { ok: true; value: T } | { ok: false; error: WorkerErrorCode; message: string }`
  - `WorkerDeps extends RunSyncDeps { eb: EnableBankingApi; redirectUrl: string; newId: () => string }`
  - `parseWorkerCommand(input: unknown): WorkerCommand | null`
  - `isScheduledEvent(event: unknown): boolean`
  - `executeWorkerCommand(deps: WorkerDeps, command: WorkerCommand): Promise<WorkerResult<unknown>>`
  - Result values: `listBanks` → `EbBank[]`; `startAuth` → `{ url: string }`; `completeAuth` → `{ connection: Connection }`; `syncNow` → `UserSyncOutcome`; `disconnect` → `{ disconnected: true }`

- [ ] **Step 1: Write the failing test**

`src/sync/__tests__/commands.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeWorkerCommand, isScheduledEvent, parseWorkerCommand } from '../commands';
import type { WorkerDeps } from '../commands';
import type { EnableBankingApi } from '../providers/enableBanking';
import { ProviderError } from '../errors';
import { FakeProvider, FakeSyncStore, makeAccount, makeConnection } from './fakes';

const USER = 'auth0|user-1';
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };
const STATE = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

let store: FakeSyncStore;
let eb: EnableBankingApi;
let ids: string[];

function deps(): WorkerDeps {
  return {
    store, providers: { 'enable-banking': new FakeProvider() }, now: () => NOW, deadline: NOW + 300_000,
    log: vi.fn(), eb, redirectUrl: 'https://app.example/banks/callback', newId: () => ids.shift()!,
  };
}

beforeEach(() => {
  store = new FakeSyncStore();
  ids = [STATE, '33333333-3333-4333-8333-333333333333'];
  eb = {
    id: 'enable-banking',
    fetchTransactions: vi.fn(async () => []),
    listBanks: vi.fn(async () => [{ name: 'Lloyds Bank', country: 'GB', logo: '', maximumConsentValiditySeconds: 365 * 86400 }]),
    startAuth: vi.fn(async () => 'https://tilisy.enablebanking.com/start'),
    completeAuth: vi.fn(async () => ({
      sessionId: 'sess-new',
      consentValidUntil: '2027-03-12T12:00:00.000Z',
      accounts: [
        { accountUid: 'acc-1', displayName: 'Current Account', last4: '1234', currency: 'GBP' },
        { accountUid: 'acc-eur', displayName: 'Euro', last4: '9999', currency: 'EUR' },
      ],
    })),
    endSession: vi.fn(async () => {}),
  };
});

describe('parseWorkerCommand', () => {
  it('accepts a valid startAuth command', () => {
    const input = { command: 'startAuth', userId: USER, aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01', psu };
    expect(parseWorkerCommand(input)).toEqual(input);
  });

  it.each([
    ['unknown command', { command: 'dropTables' }],
    ['extra field', { command: 'listBanks', country: 'GB', extra: 1 }],
    ['unsupported country', { command: 'listBanks', country: 'FR' }],
    ['bad start date', { command: 'startAuth', userId: USER, aspspName: 'L', country: 'GB', startDate: '01/09/2026', psu }],
    ['bad connection id', { command: 'disconnect', userId: USER, connectionId: 'nope' }],
    ['psu with extra keys', { command: 'syncNow', userId: USER, psu: { ...psu, admin: true } }],
    ['missing user', { command: 'syncNow', psu }],
    ['non-object', 'listBanks'],
  ])('rejects %s', (_label, input) => {
    expect(parseWorkerCommand(input)).toBeNull();
  });
});

describe('isScheduledEvent', () => {
  it('recognises EventBridge scheduled events only', () => {
    expect(isScheduledEvent({ source: 'aws.events', 'detail-type': 'Scheduled Event' })).toBe(true);
    expect(isScheduledEvent({ command: 'syncNow' })).toBe(false);
  });
});

describe('startAuth', () => {
  it('stores a pending auth and caps consent at 180 days', async () => {
    const result = await executeWorkerCommand(deps(), {
      command: 'startAuth', userId: USER, aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01', psu,
    });

    expect(result).toEqual({ ok: true, value: { url: 'https://tilisy.enablebanking.com/start' } });
    expect(await store.getPendingAuth(USER, STATE, NOW)).toMatchObject({ aspspName: 'Lloyds Bank', startDate: '2026-09-01' });
    expect(eb.startAuth).toHaveBeenCalledWith(expect.objectContaining({
      state: STATE, validUntil: new Date(NOW + 180 * 86_400_000).toISOString(), redirectUrl: 'https://app.example/banks/callback',
    }));
  });

  it('returns NOT_FOUND for an unknown bank', async () => {
    const result = await executeWorkerCommand(deps(), {
      command: 'startAuth', userId: USER, aspspName: 'Fake Bank', country: 'GB', startDate: '2026-09-01', psu,
    });
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('returns NOT_FOUND when reconnecting a connection the user does not own', async () => {
    const result = await executeWorkerCommand(deps(), {
      command: 'startAuth', userId: USER, aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01', connectionId: CONNECTION_ID, psu,
    });
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('refuses an auth URL outside Enable Banking', async () => {
    vi.mocked(eb.startAuth).mockResolvedValueOnce('https://evil.example/phish');
    const result = await executeWorkerCommand(deps(), {
      command: 'startAuth', userId: USER, aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01', psu,
    });
    expect(result).toMatchObject({ ok: false, error: 'UPSTREAM' });
  });
});

describe('completeAuth', () => {
  beforeEach(async () => {
    await store.putPendingAuth(USER, {
      state: STATE, aspspName: 'Lloyds Bank', aspspCountry: 'GB', startDate: '2026-09-01', expiresAt: NOW / 1000 + 900,
    });
    ids = ['33333333-3333-4333-8333-333333333333'];
  });

  it('creates a connection with GBP accounts only, registers the user and consumes the pending auth', async () => {
    const result = await executeWorkerCommand(deps(), { command: 'completeAuth', userId: USER, state: STATE, code: 'code-1', psu });

    expect(result.ok).toBe(true);
    const connection = await store.getConnection(USER, '33333333-3333-4333-8333-333333333333');
    expect(connection?.accounts).toEqual([
      { accountUid: 'acc-1', dedupeId: 'acc-1', displayName: 'Current Account', last4: '1234', currency: 'GBP', startDate: '2026-09-01' },
    ]);
    expect(store.users.has(USER)).toBe(true);
    expect(await store.getPendingAuth(USER, STATE, NOW)).toBeNull();
  });

  it('returns NOT_FOUND for a state belonging to another user', async () => {
    const result = await executeWorkerCommand(deps(), { command: 'completeAuth', userId: 'other-user', state: STATE, code: 'code-1', psu });
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(eb.completeAuth).not.toHaveBeenCalled();
  });

  it('reconnects an existing connection keeping account history', async () => {
    const existing = makeConnection({
      status: 'EXPIRED', consecutiveFailures: 4,
      accounts: [makeAccount({ accountUid: 'acc-1', startDate: '2026-06-01', lastSyncedAt: '2026-09-01T00:00:00.000Z' })],
    });
    await store.putConnection(USER, existing);
    await store.putPendingAuth(USER, {
      state: STATE, aspspName: 'Lloyds Bank', aspspCountry: 'GB', startDate: '2026-09-13', connectionId: existing.connectionId, expiresAt: NOW / 1000 + 900,
    });

    await executeWorkerCommand(deps(), { command: 'completeAuth', userId: USER, state: STATE, code: 'code-1', psu });
    const saved = await store.getConnection(USER, existing.connectionId);

    expect(saved).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0, auth: { sessionId: 'sess-new' } });
    expect(saved?.accounts[0]).toMatchObject({ startDate: '2026-06-01', lastSyncedAt: '2026-09-01T00:00:00.000Z' });
  });

  it('rejects a session with no GBP accounts and ends it', async () => {
    vi.mocked(eb.completeAuth).mockResolvedValueOnce({
      sessionId: 'sess-eur', consentValidUntil: 'x', accounts: [{ accountUid: 'e', displayName: 'Euro', last4: '1', currency: 'EUR' }],
    });
    const result = await executeWorkerCommand(deps(), { command: 'completeAuth', userId: USER, state: STATE, code: 'code-1', psu });
    expect(result).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(eb.endSession).toHaveBeenCalledWith('sess-eur');
  });

  it('maps provider failures to UPSTREAM without leaking details', async () => {
    vi.mocked(eb.completeAuth).mockRejectedValueOnce(new ProviderError('INVALID_RESPONSE', 'HTTP 400 secret detail'));
    const result = await executeWorkerCommand(deps(), { command: 'completeAuth', userId: USER, state: STATE, code: 'code-1', psu });
    expect(result).toEqual({ ok: false, error: 'UPSTREAM', message: 'The bank service could not complete the request' });
  });
});

describe('disconnect', () => {
  it('ends the session, removes pending items and the connection, and unregisters the last connection', async () => {
    const connection = makeConnection();
    await store.putConnection(USER, connection);
    await store.registerSyncUser(USER);
    await store.importItem(USER, {
      txnKey: 'k1', amount: 1, direction: 'OUT', suggestedType: 'EXPENSE', description: 'x',
      bookingDate: '2026-09-10', connectionId: connection.connectionId, accountUid: 'acc-1', importedAt: 't',
    });

    const result = await executeWorkerCommand(deps(), { command: 'disconnect', userId: USER, connectionId: connection.connectionId });

    expect(result).toEqual({ ok: true, value: { disconnected: true } });
    expect(eb.endSession).toHaveBeenCalledWith('session-1');
    expect(store.inboxFor(USER)).toHaveLength(0);
    expect(store.seen.size).toBe(0);
    expect(await store.getConnection(USER, connection.connectionId)).toBeNull();
    expect(store.users.has(USER)).toBe(false);
  });

  it('still disconnects when ending the session fails', async () => {
    await store.putConnection(USER, makeConnection());
    vi.mocked(eb.endSession).mockRejectedValueOnce(new ProviderError('TRANSIENT', 'down'));
    const result = await executeWorkerCommand(deps(), { command: 'disconnect', userId: USER, connectionId: CONNECTION_ID });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/commands.test.ts`
Expected: FAIL — cannot resolve `../commands`.

- [ ] **Step 3: Implement**

`src/sync/commands.ts`:
```ts
import { DATE_RE, UUID_RE, hasOnlyKeys, isRecord } from '../api/body';
import { matchAccounts } from './accounts';
import { classifyProviderError } from './errors';
import { isAllowedAuthUrl } from './providers/enableBanking';
import type { EbBank, EnableBankingApi } from './providers/enableBanking';
import { runSync } from './runSync';
import type { RunSyncDeps, UserSyncOutcome } from './runSync';
import type { Connection, PsuContext } from './types';

export const SUPPORTED_COUNTRIES = ['GB'] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

const PENDING_AUTH_TTL_S = 15 * 60;
const MAX_CONSENT_S = 180 * 24 * 60 * 60;
const MAX_USER_ID_LENGTH = 200;
const MAX_CODE_LENGTH = 2048;
const MAX_ASPSP_NAME_LENGTH = 100;
const MAX_PSU_FIELD_LENGTH = 512;
const UPSTREAM_MESSAGE = 'The bank service could not complete the request';

export type WorkerCommand =
  | { command: 'listBanks'; country: SupportedCountry }
  | { command: 'startAuth'; userId: string; aspspName: string; country: SupportedCountry; startDate: string; connectionId?: string; psu: PsuContext }
  | { command: 'completeAuth'; userId: string; state: string; code: string; psu: PsuContext }
  | { command: 'syncNow'; userId: string; psu: PsuContext }
  | { command: 'disconnect'; userId: string; connectionId: string };

type CommandOf<C extends WorkerCommand['command']> = Extract<WorkerCommand, { command: C }>;

export type WorkerErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'UPSTREAM';
export type WorkerResult<T> = { ok: true; value: T } | { ok: false; error: WorkerErrorCode; message: string };

export interface WorkerDeps extends RunSyncDeps {
  eb: EnableBankingApi;
  redirectUrl: string;
  newId: () => string;
}

const success = <T>(value: T): WorkerResult<T> => ({ ok: true, value });
const failure = (error: WorkerErrorCode, message: string): WorkerResult<never> => ({ ok: false, error, message });

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isCountry(value: unknown): value is SupportedCountry {
  return (SUPPORTED_COUNTRIES as readonly unknown[]).includes(value);
}

function isPsuContext(value: unknown): value is PsuContext {
  return isRecord(value)
    && hasOnlyKeys(value, ['ipAddress', 'userAgent'])
    && isBoundedString(value.ipAddress, MAX_PSU_FIELD_LENGTH)
    && typeof value.userAgent === 'string'
    && value.userAgent.length <= MAX_PSU_FIELD_LENGTH;
}

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value);
const isUserId = (value: unknown): value is string => isBoundedString(value, MAX_USER_ID_LENGTH);

export function isScheduledEvent(event: unknown): boolean {
  return isRecord(event) && event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event';
}

export function parseWorkerCommand(input: unknown): WorkerCommand | null {
  if (!isRecord(input)) return null;
  const c = input;

  switch (c.command) {
    case 'listBanks':
      if (!hasOnlyKeys(c, ['command', 'country']) || !isCountry(c.country)) return null;
      return { command: 'listBanks', country: c.country };

    case 'startAuth': {
      if (!hasOnlyKeys(c, ['command', 'userId', 'aspspName', 'country', 'startDate', 'psu'], ['connectionId'])) return null;
      if (!isUserId(c.userId) || !isBoundedString(c.aspspName, MAX_ASPSP_NAME_LENGTH) || !isCountry(c.country)) return null;
      if (!isDate(c.startDate) || !isPsuContext(c.psu)) return null;
      if (c.connectionId !== undefined && !isUuid(c.connectionId)) return null;
      const command: CommandOf<'startAuth'> = {
        command: 'startAuth', userId: c.userId, aspspName: c.aspspName, country: c.country, startDate: c.startDate, psu: c.psu,
      };
      if (typeof c.connectionId === 'string') command.connectionId = c.connectionId;
      return command;
    }

    case 'completeAuth':
      if (!hasOnlyKeys(c, ['command', 'userId', 'state', 'code', 'psu'])) return null;
      if (!isUserId(c.userId) || !isUuid(c.state) || !isBoundedString(c.code, MAX_CODE_LENGTH) || !isPsuContext(c.psu)) return null;
      return { command: 'completeAuth', userId: c.userId, state: c.state, code: c.code, psu: c.psu };

    case 'syncNow':
      if (!hasOnlyKeys(c, ['command', 'userId', 'psu']) || !isUserId(c.userId) || !isPsuContext(c.psu)) return null;
      return { command: 'syncNow', userId: c.userId, psu: c.psu };

    case 'disconnect':
      if (!hasOnlyKeys(c, ['command', 'userId', 'connectionId']) || !isUserId(c.userId) || !isUuid(c.connectionId)) return null;
      return { command: 'disconnect', userId: c.userId, connectionId: c.connectionId };

    default:
      return null;
  }
}

async function startAuth(deps: WorkerDeps, command: CommandOf<'startAuth'>): Promise<WorkerResult<{ url: string }>> {
  if (command.connectionId && !(await deps.store.getConnection(command.userId, command.connectionId))) {
    return failure('NOT_FOUND', 'Connection not found');
  }

  const bank = (await deps.eb.listBanks(command.country)).find(b => b.name === command.aspspName);
  if (!bank) return failure('NOT_FOUND', 'Bank not found');

  const now = deps.now();
  const state = deps.newId();
  const consentSeconds = Math.min(bank.maximumConsentValiditySeconds, MAX_CONSENT_S);

  await deps.store.putPendingAuth(command.userId, {
    state,
    aspspName: bank.name,
    aspspCountry: command.country,
    startDate: command.startDate,
    ...(command.connectionId ? { connectionId: command.connectionId } : {}),
    expiresAt: Math.floor(now / 1000) + PENDING_AUTH_TTL_S,
  });

  const url = await deps.eb.startAuth({
    aspspName: bank.name,
    country: command.country,
    state,
    redirectUrl: deps.redirectUrl,
    validUntil: new Date(now + consentSeconds * 1000).toISOString(),
    psu: command.psu,
  });

  if (!isAllowedAuthUrl(url)) {
    deps.log('worker.auth_url_rejected', {});
    return failure('UPSTREAM', 'The bank service returned an unexpected sign-in address');
  }
  return success({ url });
}

async function completeAuth(deps: WorkerDeps, command: CommandOf<'completeAuth'>): Promise<WorkerResult<{ connection: Connection }>> {
  const pending = await deps.store.getPendingAuth(command.userId, command.state, deps.now());
  if (!pending) return failure('NOT_FOUND', 'This bank connection attempt has expired. Please start again.');
  await deps.store.deletePendingAuth(command.userId, command.state);

  const session = await deps.eb.completeAuth(command.code, command.psu);
  const gbpAccounts = session.accounts.filter(account => account.currency === 'GBP');
  if (gbpAccounts.length === 0) {
    await deps.eb.endSession(session.sessionId);
    return failure('BAD_REQUEST', 'No GBP accounts were shared. Only GBP accounts are supported.');
  }

  const nowIso = new Date(deps.now()).toISOString();
  const auth = { sessionId: session.sessionId, consentValidUntil: session.consentValidUntil };
  let connection: Connection;

  if (pending.connectionId) {
    const existing = await deps.store.getConnection(command.userId, pending.connectionId);
    if (!existing) return failure('NOT_FOUND', 'Connection not found');
    connection = {
      ...existing,
      auth,
      status: 'ACTIVE',
      consecutiveFailures: 0,
      lastError: undefined,
      accounts: matchAccounts(existing.accounts, gbpAccounts, nowIso.slice(0, 10)),
      updatedAt: nowIso,
    };
  } else {
    connection = {
      connectionId: deps.newId(),
      provider: 'enable-banking',
      displayName: pending.aspspName,
      status: 'ACTIVE',
      consecutiveFailures: 0,
      accounts: gbpAccounts.map(account => ({ ...account, dedupeId: account.accountUid, startDate: pending.startDate })),
      auth,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  await deps.store.putConnection(command.userId, connection);
  await deps.store.registerSyncUser(command.userId, nowIso);
  return success({ connection });
}

async function disconnect(deps: WorkerDeps, command: CommandOf<'disconnect'>): Promise<WorkerResult<{ disconnected: true }>> {
  const connection = await deps.store.getConnection(command.userId, command.connectionId);
  if (!connection) return failure('NOT_FOUND', 'Connection not found');

  try {
    await deps.eb.endSession(connection.auth.sessionId);
  } catch (error) {
    deps.log('worker.end_session_failed', { errorType: classifyProviderError(error) });
  }

  await deps.store.deletePendingItemsForConnection(command.userId, command.connectionId);
  await deps.store.deleteConnection(command.userId, command.connectionId);
  if ((await deps.store.listConnections(command.userId)).length === 0) {
    await deps.store.unregisterSyncUser(command.userId);
  }
  return success({ disconnected: true as const });
}

async function syncNow(deps: WorkerDeps, command: CommandOf<'syncNow'>): Promise<WorkerResult<UserSyncOutcome>> {
  const results = await runSync(deps, [command.userId], command.psu);
  return success(results[command.userId]);
}

async function listBanks(deps: WorkerDeps, command: CommandOf<'listBanks'>): Promise<WorkerResult<EbBank[]>> {
  return success(await deps.eb.listBanks(command.country));
}

export async function executeWorkerCommand(deps: WorkerDeps, command: WorkerCommand): Promise<WorkerResult<unknown>> {
  try {
    switch (command.command) {
      case 'listBanks': return await listBanks(deps, command);
      case 'startAuth': return await startAuth(deps, command);
      case 'completeAuth': return await completeAuth(deps, command);
      case 'syncNow': return await syncNow(deps, command);
      case 'disconnect': return await disconnect(deps, command);
    }
  } catch (error) {
    deps.log('worker.command_failed', { command: command.command, errorType: classifyProviderError(error) });
    return failure('UPSTREAM', UPSTREAM_MESSAGE);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/sync/__tests__/commands.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/commands.ts src/sync/__tests__/commands.test.ts
git commit -m "feat(sync): add validated worker commands for connect, sync and disconnect"
```

---

### Task 10: Worker Lambda entry, secret loading and build

**Files:**
- Create: `src/sync/secrets.ts`, `sync-handler.ts`
- Modify: `scripts/build-api-handler.cjs`, `package.json`, `.gitignore`
- Test: `src/sync/__tests__/secrets.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–9.
- Produces: `parseEbCredentials(secretString: string | undefined): EbCredentials`; `loadEbCredentials(secretId: string, client?: SecretsManagerClient): Promise<EbCredentials>`; `handler(event: unknown, context: Context)` at `build/sync/index.js`; env vars `DYNAMODB_TABLE`, `EB_SECRET_ID`, `APP_BASE_URL`.

- [ ] **Step 1: Add the AWS SDK packages**

Run: `yarn add @aws-sdk/client-lambda @aws-sdk/client-secrets-manager`
Then run the CI audit gate locally: `yarn audit --level high` and review any high/critical advisory before continuing (DEP-01/05).

- [ ] **Step 2: Write the failing test**

`src/sync/__tests__/secrets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseEbCredentials } from '../secrets';

const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

describe('parseEbCredentials', () => {
  it('returns credentials from valid JSON', () => {
    const secret = JSON.stringify({ applicationId: '11111111-1111-4111-8111-111111111111', privateKeyPem: pem });
    expect(parseEbCredentials(secret)).toEqual({ applicationId: '11111111-1111-4111-8111-111111111111', privateKeyPem: pem });
  });

  it('explains how to set an empty secret', () => {
    expect(() => parseEbCredentials(undefined)).toThrow(/put-secret-value/);
  });

  it.each([
    ['invalid JSON', '{nope'],
    ['missing key', JSON.stringify({ applicationId: '11111111-1111-4111-8111-111111111111' })],
    ['non-uuid application id', JSON.stringify({ applicationId: 'abc', privateKeyPem: pem })],
    ['not a private key', JSON.stringify({ applicationId: '11111111-1111-4111-8111-111111111111', privateKeyPem: 'hello' })],
  ])('rejects %s without echoing the secret', (_label, secret) => {
    expect(() => parseEbCredentials(secret)).toThrow(/^Enable Banking secret/);
    try { parseEbCredentials(secret); } catch (error) { expect(String(error)).not.toContain('hello'); }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run src/sync/__tests__/secrets.test.ts`
Expected: FAIL — cannot resolve `../secrets`.

- [ ] **Step 4: Implement**

`src/sync/secrets.ts`:
```ts
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { UUID_RE, isRecord } from '../api/body';
import type { EbCredentials } from './providers/enableBankingClient';

let cached: Promise<EbCredentials> | undefined;

export function parseEbCredentials(secretString: string | undefined): EbCredentials {
  if (!secretString) {
    throw new Error('Enable Banking secret is empty; set it with aws secretsmanager put-secret-value');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new Error('Enable Banking secret is not valid JSON');
  }
  if (
    !isRecord(parsed)
    || typeof parsed.applicationId !== 'string'
    || !UUID_RE.test(parsed.applicationId)
    || typeof parsed.privateKeyPem !== 'string'
    || !parsed.privateKeyPem.includes('PRIVATE KEY')
  ) {
    throw new Error('Enable Banking secret must contain applicationId (UUID) and privateKeyPem');
  }
  return { applicationId: parsed.applicationId, privateKeyPem: parsed.privateKeyPem };
}

export function loadEbCredentials(secretId: string, client: SecretsManagerClient = new SecretsManagerClient({})): Promise<EbCredentials> {
  cached ??= client
    .send(new GetSecretValueCommand({ SecretId: secretId }))
    .then(result => parseEbCredentials(result.SecretString))
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
```

`sync-handler.ts` (repo root, next to `api-handler.ts`):
```ts
import type { Context } from 'aws-lambda';
import { executeWorkerCommand, isScheduledEvent, parseWorkerCommand } from './src/sync/commands';
import type { WorkerDeps } from './src/sync/commands';
import { jsonLogger } from './src/sync/log';
import { createEnableBankingProvider } from './src/sync/providers/enableBanking';
import type { EnableBankingApi } from './src/sync/providers/enableBanking';
import { createEbClient, createJwtSource } from './src/sync/providers/enableBankingClient';
import { runSync } from './src/sync/runSync';
import { loadEbCredentials } from './src/sync/secrets';
import { createDynamoSyncStore } from './src/sync/stores/dynamoSyncStore';

const DEADLINE_MARGIN_MS = 15_000;
const store = createDynamoSyncStore();
let enableBanking: EnableBankingApi | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function getEnableBanking(): Promise<EnableBankingApi> {
  if (enableBanking) return enableBanking;
  const credentials = await loadEbCredentials(requireEnv('EB_SECRET_ID'));
  const now = () => Date.now();
  enableBanking = createEnableBankingProvider(createEbClient({ jwt: createJwtSource(credentials, now) }));
  return enableBanking;
}

export const handler = async (event: unknown, context: Context): Promise<unknown> => {
  const eb = await getEnableBanking();
  const deps: WorkerDeps = {
    store,
    providers: { 'enable-banking': eb },
    eb,
    now: () => Date.now(),
    deadline: Date.now() + context.getRemainingTimeInMillis() - DEADLINE_MARGIN_MS,
    log: jsonLogger,
    redirectUrl: `${requireEnv('APP_BASE_URL')}/banks/callback`,
    newId: () => crypto.randomUUID(),
  };

  if (isScheduledEvent(event)) {
    const userIds = await store.listSyncUserIds();
    await runSync(deps, userIds);
    jsonLogger('sync.scheduled_done', { users: userIds.length });
    return { ok: true };
  }

  const command = parseWorkerCommand(event);
  if (!command) {
    jsonLogger('worker.bad_command', {});
    return { ok: false, error: 'BAD_REQUEST', message: 'Invalid command' };
  }
  return executeWorkerCommand(deps, command);
};
```

`scripts/build-api-handler.cjs` — replace the whole file:
```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

const LAMBDAS = [
  {
    entry: 'api-handler.ts',
    outDir: 'build/api',
    dependencies: {
      'jsonwebtoken': '^9.0.3',
      'jwks-rsa': '^3.2.1',
      '@aws-sdk/client-dynamodb': '^3.0.0',
      '@aws-sdk/lib-dynamodb': '^3.0.0',
      '@aws-sdk/client-lambda': '^3.0.0',
    },
  },
  {
    entry: 'sync-handler.ts',
    outDir: 'build/sync',
    dependencies: {
      'jsonwebtoken': '^9.0.3',
      '@aws-sdk/client-dynamodb': '^3.0.0',
      '@aws-sdk/lib-dynamodb': '^3.0.0',
      '@aws-sdk/client-secrets-manager': '^3.0.0',
    },
  },
];

function buildLambda({ entry, outDir, dependencies }) {
  const buildDir = path.join(root, outDir);
  fs.mkdirSync(buildDir, { recursive: true });

  console.log(`Compiling ${entry}...`);
  execSync(
    `tsc ${entry} --outDir ${outDir} --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop`,
    { cwd: root, stdio: 'inherit' },
  );

  // Lambda's handler is "index.handler"
  const compiled = path.join(buildDir, entry.replace(/\.ts$/, '.js'));
  if (fs.existsSync(compiled)) {
    fs.renameSync(compiled, path.join(buildDir, 'index.js'));
  }

  const packageJsonPath = path.join(buildDir, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify({ name: `budget-app-${path.basename(outDir)}`, version: '1.0.0', dependencies }, null, 2));

  console.log(`Installing dependencies for ${outDir}...`);
  execSync('npm install --production', { cwd: buildDir, stdio: 'inherit' });

  fs.unlinkSync(packageJsonPath);
  const lockFilePath = path.join(buildDir, 'package-lock.json');
  if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath);

  console.log(`✓ ${entry} compiled to ${outDir}/index.js`);
}

LAMBDAS.forEach(buildLambda);
```

`.gitignore` — append:
```
infra/sync_lambda_function.zip
```

- [ ] **Step 5: Run tests, typecheck and the build**

Run: `yarn vitest run src/sync/__tests__/secrets.test.ts && yarn typecheck && yarn build`
Expected: tests PASS; build prints `✓ api-handler.ts compiled to build/api/index.js` and `✓ sync-handler.ts compiled to build/sync/index.js`. Confirm `build/sync/index.js` exists and `build/sync/src/sync/runSync.js` is present. (`yarn build` needs the `VITE_AUTH0_*` env vars from `.env`.)

- [ ] **Step 6: Commit**

```bash
git add src/sync/secrets.ts src/sync/__tests__/secrets.test.ts sync-handler.ts scripts/build-api-handler.cjs package.json yarn.lock .gitignore
git commit -m "feat(sync): add bank worker Lambda entry and build (addresses SEC-02)"
```

---

## Phase F — Infrastructure

Infra changes are verified with `tofu validate` and a reviewed `tofu plan` in CI; never `tofu apply` locally (INFRA-10). Local validation:

```bash
cd infra && tofu init -backend=false && tofu validate && cd ..
```

### Task 11: Split IAM roles, table TTL/encryption, log groups

**Files:**
- Create: `infra/logs.tf`
- Modify: `infra/lambda.tf`, `infra/api-lambda.tf`, `infra/dynamodb.tf`

**Interfaces:**
- Produces: `aws_iam_role.api_role`; `aws_cloudwatch_log_group.static_lambda`, `.api_lambda`, `.worker_lambda`; table TTL on `expiresAt`; SSE enabled. Task 12 attaches worker resources to these.

- [ ] **Step 1: Add log groups**

`infra/logs.tf`:
```hcl
# Explicit Lambda log groups with retention (LOG-05). Custom names avoid
# colliding with the auto-created /aws/lambda/* groups of existing deployments.
locals {
  lambda_log_retention_days = 14
}

resource "aws_cloudwatch_log_group" "static_lambda" {
  name              = "/${var.app_name}/lambda/static"
  retention_in_days = local.lambda_log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/${var.app_name}/lambda/api"
  retention_in_days = local.lambda_log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_log_group" "worker_lambda" {
  name              = "/${var.app_name}/lambda/worker"
  retention_in_days = local.lambda_log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}
```

- [ ] **Step 2: Point the static Lambda at its log group**

`infra/lambda.tf` — inside `resource "aws_lambda_function" "app"`, after the `environment` block:
```hcl
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.static_lambda.name
  }
```
Also change the comment above `aws_iam_role.lambda_role` to `# Static file Lambda execution role (logs only — no data access)`. The role keeps only `AWSLambdaBasicExecutionRole`.

- [ ] **Step 3: Give the API Lambda its own role and log group**

`infra/api-lambda.tf` — add above the archive data source:
```hcl
# API Lambda execution role (INFRA-01): DynamoDB access and worker invoke only
resource "aws_iam_role" "api_role" {
  name        = "${var.app_name}-api-role"
  description = "Execution role for the protected API Lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_iam_role_policy_attachment" "api_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.api_role.name
}
```
In `resource "aws_lambda_function" "api"`: change `role = aws_iam_role.lambda_role.arn` to `role = aws_iam_role.api_role.arn`, and add after `environment`:
```hcl
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api_lambda.name
  }
```

- [ ] **Step 4: Move DynamoDB access to the API role and harden the table**

`infra/dynamodb.tf`:
- Inside `aws_dynamodb_table.budget_data`, after `point_in_time_recovery`:
```hcl
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # INFRA-03: AWS-managed KMS key; key usage is visible in CloudTrail
  server_side_encryption {
    enabled = true
  }
```
- In `aws_iam_role_policy.lambda_dynamodb`: rename the resource to `api_dynamodb`, set `name = "${var.app_name}-api-dynamodb"`, `role = aws_iam_role.api_role.id`, and add `"dynamodb:ConditionCheckItem"` to `Action`. Add above it:
```hcl
moved {
  from = aws_iam_role_policy.lambda_dynamodb
  to   = aws_iam_role_policy.api_dynamodb
}
```
(The policy still gets replaced because its `role` changes; `moved` keeps the history readable in the plan.)

- [ ] **Step 5: Validate**

Run: `cd infra && tofu init -backend=false && tofu validate && cd ..`
Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
git add infra/logs.tf infra/lambda.tf infra/api-lambda.tf infra/dynamodb.tf
git commit -m "fix(infra): split static and API Lambda roles, add log retention and table TTL/SSE (addresses INFRA-01, INFRA-03, LOG-05)"
```

In the PR, the reviewer checks the CI `tofu plan` shows: the static Lambda role with no DynamoDB policy; the API Lambda on `api_role`; SSE and TTL as in-place table updates (no table replacement).

---

### Task 12: Worker Lambda, secret, schedule and invoke permission

**Files:**
- Create: `infra/sync-lambda.tf`
- Modify: `infra/variables.tf`, `infra/api-lambda.tf`

**Interfaces:**
- Consumes: `aws_iam_role.api_role`, `aws_cloudwatch_log_group.worker_lambda` (Task 11), `build/sync` (Task 10).
- Produces: Lambda `${app_name}-bank-worker`; secret `${app_name}/enable-banking`; API env var `WORKER_FUNCTION_NAME`; output `enable_banking_secret_name`.

- [ ] **Step 1: Add the variable**

`infra/variables.tf` — append:
```hcl
variable "app_base_url" {
  type        = string
  description = "Public base URL of the app (e.g. https://budget.example.com). Empty uses the API Gateway invoke URL. Used for the bank redirect URL."
  default     = ""
}
```

- [ ] **Step 2: Add the worker infrastructure**

`infra/sync-lambda.tf`:
```hcl
# ============================================================================
# Bank worker Lambda: the only component that can read the Enable Banking key
# ============================================================================

locals {
  app_base_url = trimsuffix(var.app_base_url != "" ? var.app_base_url : aws_apigatewayv2_stage.default.invoke_url, "/")
}

data "archive_file" "sync_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../build/sync"
  output_path = "${path.module}/sync_lambda_function.zip"
}

# SEC-02/SEC-04: created empty; the value is set out-of-band with
# `aws secretsmanager put-secret-value` so the key never enters state.
resource "aws_secretsmanager_secret" "enable_banking" {
  name                    = "${var.app_name}/enable-banking"
  description             = "Enable Banking applicationId and privateKeyPem for the bank worker"
  recovery_window_in_days = 7

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_iam_role" "worker_role" {
  name        = "${var.app_name}-bank-worker-role"
  description = "Execution role for the bank worker Lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_iam_role_policy_attachment" "worker_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.worker_role.name
}

# INFRA-01: table and single secret only
resource "aws_iam_role_policy" "worker_permissions" {
  name = "${var.app_name}-bank-worker-permissions"
  role = aws_iam_role.worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = aws_dynamodb_table.budget_data.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.enable_banking.arn
      }
    ]
  })
}

resource "aws_lambda_function" "worker" {
  filename         = data.archive_file.sync_lambda_zip.output_path
  function_name    = "${var.app_name}-bank-worker"
  role             = aws_iam_role.worker_role.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  memory_size      = 256
  source_code_hash = data.archive_file.sync_lambda_zip.output_base64sha256

  environment {
    variables = {
      NODE_ENV       = "production"
      DYNAMODB_TABLE = aws_dynamodb_table.budget_data.name
      EB_SECRET_ID   = aws_secretsmanager_secret.enable_banking.name
      APP_BASE_URL   = local.app_base_url
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.worker_lambda.name
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

# INFRA-04: no automatic retries; the next schedule is the retry and the lock prevents overlap
resource "aws_lambda_function_event_invoke_config" "worker" {
  function_name          = aws_lambda_function.worker.function_name
  maximum_retry_attempts = 0
}

resource "aws_cloudwatch_event_rule" "bank_sync_schedule" {
  name                = "${var.app_name}-bank-sync"
  description         = "Scheduled bank transaction sync"
  schedule_expression = "rate(6 hours)"

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_event_target" "bank_sync_worker" {
  rule = aws_cloudwatch_event_rule.bank_sync_schedule.name
  arn  = aws_lambda_function.worker.arn
}

# INFRA-02: only this rule may invoke the worker via EventBridge
resource "aws_lambda_permission" "eventbridge_worker" {
  statement_id  = "AllowEventBridgeBankSync"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.bank_sync_schedule.arn
}

# The API Lambda may invoke only the worker
resource "aws_iam_role_policy" "api_invoke_worker" {
  name = "${var.app_name}-api-invoke-worker"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.worker.arn
      }
    ]
  })
}

output "enable_banking_secret_name" {
  value       = aws_secretsmanager_secret.enable_banking.name
  description = "Set with: aws secretsmanager put-secret-value --secret-id <name> --secret-string file://eb-secret.json"
}

output "bank_redirect_url" {
  value       = "${local.app_base_url}/banks/callback"
  description = "Register this redirect URL in the Enable Banking control panel"
}
```

- [ ] **Step 3: Tell the API Lambda where the worker is**

`infra/api-lambda.tf` — in the API Lambda `environment.variables`, add:
```hcl
      WORKER_FUNCTION_NAME = aws_lambda_function.worker.function_name
```

- [ ] **Step 4: Validate**

Run: `yarn build && cd infra && tofu init -backend=false && tofu validate && cd ..`
Expected: `Success! The configuration is valid.` (The build must exist so `archive_file` has a source directory.)

- [ ] **Step 5: Commit**

```bash
git add infra/sync-lambda.tf infra/variables.tf infra/api-lambda.tf
git commit -m "feat(infra): add bank worker Lambda, Enable Banking secret and 6-hourly schedule (addresses INFRA-01, INFRA-02, INFRA-04, SEC-04)"
```

- [ ] **Step 6: Post-merge setup (milestone M2)**

After CI applies this on `main`:
1. Create `eb-secret.json` **outside the repo** (e.g. in `~/`): `{"applicationId":"<sandbox app id>","privateKeyPem":"<PEM with \n escapes>"}`.
2. `aws secretsmanager put-secret-value --secret-id "$(cd infra && tofu output -raw enable_banking_secret_name)" --secret-string file://$HOME/eb-secret.json`, then delete the file.
3. Register `tofu output -raw bank_redirect_url` in the Enable Banking control panel.
4. Key rotation (SEC-07), whenever needed: create a new key for the application in the Enable Banking control panel, repeat steps 1–2 with the new PEM, confirm the smoke test below passes, then revoke the old key.
5. Smoke test: `aws lambda invoke --function-name <app_name>-bank-worker --payload '{"command":"listBanks","country":"GB"}' --cli-binary-format raw-in-base64-out /dev/stdout` returns `{"ok":true,"value":[...]}`.

---

## Phase G — API

### Task 13: Preserve bank links on transaction edits

**Files:**
- Modify: `src/api/transactions.ts` (`updateTransaction`, the `const transaction: Transaction = { ... }` object)
- Test: `src/api/__tests__/transactions.test.ts`

**Interfaces:**
- Consumes: `Transaction.source`/`bankRef` (Task 1).
- Produces: `updateTransaction` keeps `source` and `bankRef` from the existing item.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('updateTransaction', ...)` block in `src/api/__tests__/transactions.test.ts` (reuse its `makeEvent` helper and `mockSend`):
```ts
  it('keeps source and bankRef from the existing bank-imported transaction', async () => {
    const bankRef = { connectionId: 'c1', accountUid: 'acc-1', txnKey: 'a'.repeat(32) };
    mockSend
      .mockResolvedValueOnce({ Item: { transactionId: 'a'.repeat(32), createdAt: '2026-09-01T00:00:00.000Z', source: 'BANK', bankRef } })
      .mockResolvedValueOnce({});

    const res = await updateTransaction(
      makeEvent({ body: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: 'Edited', date: '2026-09-10' } }),
      'user-1',
      { yearMonth: '2026-09', transactionId: 'a'.repeat(32) },
    );

    expect(res.statusCode).toBe(200);
    const put = mockSend.mock.calls[1][0];
    expect(put.Item).toMatchObject({ source: 'BANK', bankRef, description: 'Edited' });
  });
```
If the existing suite's `updateTransaction` success test asserts a different status code, match that code here.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/api/__tests__/transactions.test.ts -t "keeps source and bankRef"`
Expected: FAIL — `put.Item` lacks `source`/`bankRef`.

- [ ] **Step 3: Implement**

In `updateTransaction`, replace the transaction object construction with:
```ts
  const newYearMonth = date.slice(0, 7);
  const transaction: Transaction = {
    transactionId,
    yearMonth: newYearMonth,
    amount,
    type,
    categoryId,
    description,
    date,
    createdAt: existing.createdAt,
    ...(existing.source ? { source: existing.source } : {}),
    ...(existing.bankRef ? { bankRef: existing.bankRef } : {}),
  };
```

- [ ] **Step 4: Run the suite**

Run: `yarn vitest run src/api/__tests__/transactions.test.ts`
Expected: PASS (all existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "fix(api): keep bank link when editing an imported transaction"
```

---

### Task 14: Worker invoke client and banks/sync handlers

**Files:**
- Create: `src/api/worker.ts`, `src/api/banks.ts`
- Test: `src/api/__tests__/banks.test.ts`

**Interfaces:**
- Consumes: `WorkerCommand`, `WorkerResult` (Task 9); `createDynamoSyncStore` (Task 5); `Connection`, `PsuContext`, `SyncStatus` (Task 1); `ok`, `err` (existing `src/api/http.ts`); `parseJsonBody`, `hasOnlyKeys`, `UUID_RE`, `DATE_RE` (Task 1).
- Produces:
  - `invokeWorker<T>(command: WorkerCommand): Promise<WorkerResult<T>>`, `invokeWorkerAsync(command: WorkerCommand): Promise<void>`
  - Handlers (router `Handler` signature): `listAspsps`, `connectBank`, `completeBankCallback`, `clearPendingAuth`, `listBankConnections`, `disconnectBank`, `triggerSync`, `getSyncStatus`
  - `PublicConnection = Omit<Connection, 'auth'> & { expiresInDays: number | null; needsAttention: boolean }`
  - `toPublicConnection(connection: Connection, nowMs: number): PublicConnection`
  - `validateStartDate(value: unknown, today: string): string | null`
  - Response shapes: `GET aspsps` → `{ aspsps }`; `connect` → `{ url }`; `callback` → 201 `{ connection }`; `connections` → `{ connections }`; `POST /api/sync` → 202 `{ status: 'STARTED' }`; `GET /api/sync/status` → `{ status }`

- [ ] **Step 1: Write the failing test**

`src/api/__tests__/banks.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const { mockInvoke, mockInvokeAsync, store } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockInvokeAsync: vi.fn(),
  store: { listConnections: vi.fn(), deletePendingAuth: vi.fn(), getSyncStatus: vi.fn() },
}));

vi.mock('../worker', () => ({ invokeWorker: mockInvoke, invokeWorkerAsync: mockInvokeAsync }));
vi.mock('../../sync/stores/dynamoSyncStore', () => ({ createDynamoSyncStore: () => store }));

import {
  clearPendingAuth, completeBankCallback, connectBank, disconnectBank, getSyncStatus,
  listAspsps, listBankConnections, toPublicConnection, triggerSync, validateStartDate,
} from '../banks';

const USER = 'auth0|user-1';
const NOW = new Date('2026-09-13T12:00:00.000Z');
const STATE = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

function makeEvent(opts: { body?: unknown; query?: Record<string, string> } = {}): APIGatewayProxyEventV2 {
  return {
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    queryStringParameters: opts.query ?? {},
    headers: { 'user-agent': 'Firefox' },
    requestContext: { http: { method: 'POST', sourceIp: '203.0.113.5' } },
  } as unknown as APIGatewayProxyEventV2;
}

const connection = {
  connectionId: CONNECTION_ID, provider: 'enable-banking' as const, displayName: 'Lloyds Bank', status: 'ACTIVE' as const,
  consecutiveFailures: 0, accounts: [], createdAt: 't', updatedAt: 't',
  auth: { sessionId: 'secret-session', consentValidUntil: '2026-12-12T12:00:00.000Z' },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockInvoke.mockReset();
  mockInvokeAsync.mockReset();
  Object.values(store).forEach(fn => fn.mockReset());
});

afterEach(() => { vi.useRealTimers(); });

describe('validateStartDate', () => {
  it.each([
    ['2026-09-13', null],
    ['2024-09-14', null],
    ['2026-09-14', 'startDate cannot be in the future'],
    ['2024-09-12', 'startDate cannot be more than 2 years ago'],
    ['2026-02-30', 'startDate must be in YYYY-MM-DD format'],
    [20260901, 'startDate must be in YYYY-MM-DD format'],
  ])('%s → %s', (value, expected) => {
    expect(validateStartDate(value, '2026-09-13')).toBe(expected);
  });
});

describe('toPublicConnection', () => {
  it('strips auth and derives expiry', () => {
    const result = toPublicConnection(connection, NOW.getTime());
    expect(result).not.toHaveProperty('auth');
    expect(result).toMatchObject({ expiresInDays: 90, needsAttention: false });
  });

  it('needs attention within seven days of expiry or when not ACTIVE', () => {
    const soon = { ...connection, auth: { ...connection.auth, consentValidUntil: '2026-09-19T12:00:00.000Z' } };
    expect(toPublicConnection(soon, NOW.getTime()).needsAttention).toBe(true);
    expect(toPublicConnection({ ...connection, status: 'ERROR' }, NOW.getTime()).needsAttention).toBe(true);
  });
});

describe('listAspsps', () => {
  it('rejects unsupported countries', async () => {
    const res = await listAspsps(makeEvent({ query: { country: 'FR' } }), USER, {});
    expect(res.statusCode).toBe(400);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns banks from the worker', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: [{ name: 'Lloyds Bank' }] });
    const res = await listAspsps(makeEvent({ query: { country: 'GB' } }), USER, {});
    expect(JSON.parse(res.body)).toEqual({ aspsps: [{ name: 'Lloyds Bank' }] });
    expect(mockInvoke).toHaveBeenCalledWith({ command: 'listBanks', country: 'GB' });
  });
});

describe('connectBank', () => {
  const body = { aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01' };

  it('forwards to startAuth with the JWT user and PSU context', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { url: 'https://tilisy.enablebanking.com/x' } });
    const res = await connectBank(makeEvent({ body }), USER, {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ url: 'https://tilisy.enablebanking.com/x' });
    expect(mockInvoke).toHaveBeenCalledWith({
      command: 'startAuth', userId: USER, ...body, psu: { ipAddress: '203.0.113.5', userAgent: 'Firefox' },
    });
  });

  it.each([
    ['unexpected field', { ...body, userId: 'someone-else' }],
    ['future start date', { ...body, startDate: '2026-12-01' }],
    ['unsupported country', { ...body, country: 'FR' }],
    ['long bank name', { ...body, aspspName: 'x'.repeat(101) }],
    ['bad connection id', { ...body, connectionId: 'nope' }],
  ])('rejects %s', async (_label, invalid) => {
    const res = await connectBank(makeEvent({ body: invalid }), USER, {});
    expect(res.statusCode).toBe(400);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('maps worker NOT_FOUND to 404', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'NOT_FOUND', message: 'Bank not found' });
    const res = await connectBank(makeEvent({ body }), USER, {});
    expect(res.statusCode).toBe(404);
  });
});

describe('completeBankCallback', () => {
  it('completes the connection, strips auth and starts the first sync', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { connection } });
    mockInvokeAsync.mockResolvedValueOnce(undefined);
    const res = await completeBankCallback(makeEvent({ body: { code: 'abc', state: STATE } }), USER, {});
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('secret-session');
    expect(mockInvokeAsync).toHaveBeenCalledWith({ command: 'syncNow', userId: USER, psu: { ipAddress: '203.0.113.5', userAgent: 'Firefox' } });
  });

  it('still returns 201 when starting the first sync fails', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { connection } });
    mockInvokeAsync.mockRejectedValueOnce(new Error('throttled'));
    const res = await completeBankCallback(makeEvent({ body: { code: 'abc', state: STATE } }), USER, {});
    expect(res.statusCode).toBe(201);
  });

  it('rejects a non-UUID state', async () => {
    const res = await completeBankCallback(makeEvent({ body: { code: 'abc', state: 'x' } }), USER, {});
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the worker cannot find the pending auth', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'NOT_FOUND', message: 'expired' });
    const res = await completeBankCallback(makeEvent({ body: { code: 'abc', state: STATE } }), USER, {});
    expect(res.statusCode).toBe(404);
  });
});

describe('clearPendingAuth', () => {
  it('deletes the caller’s pending auth', async () => {
    const res = await clearPendingAuth(makeEvent(), USER, { state: STATE });
    expect(res.statusCode).toBe(204);
    expect(store.deletePendingAuth).toHaveBeenCalledWith(USER, STATE);
  });

  it('rejects a non-UUID state', async () => {
    const res = await clearPendingAuth(makeEvent(), USER, { state: '../x' });
    expect(res.statusCode).toBe(400);
  });
});

describe('listBankConnections', () => {
  it('never returns session ids', async () => {
    store.listConnections.mockResolvedValueOnce([connection]);
    const res = await listBankConnections(makeEvent(), USER, {});
    expect(res.body).not.toContain('secret-session');
    expect(JSON.parse(res.body).connections).toHaveLength(1);
  });
});

describe('disconnectBank', () => {
  it('invokes disconnect for a valid id', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { disconnected: true } });
    const res = await disconnectBank(makeEvent(), USER, { connectionId: CONNECTION_ID });
    expect(res.statusCode).toBe(204);
    expect(mockInvoke).toHaveBeenCalledWith({ command: 'disconnect', userId: USER, connectionId: CONNECTION_ID });
  });
});

describe('triggerSync', () => {
  it('starts an async sync', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'IDLE', finishedAt: '2026-09-13T11:00:00.000Z' });
    const res = await triggerSync(makeEvent(), USER, {});
    expect(res.statusCode).toBe(202);
    expect(mockInvokeAsync).toHaveBeenCalledWith(expect.objectContaining({ command: 'syncNow', userId: USER }));
  });

  it('returns 409 while a recent sync is running', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'RUNNING', startedAt: '2026-09-13T11:58:00.000Z' });
    expect((await triggerSync(makeEvent(), USER, {})).statusCode).toBe(409);
  });

  it('allows a new sync when the running lock is stale', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'RUNNING', startedAt: '2026-09-13T11:40:00.000Z' });
    expect((await triggerSync(makeEvent(), USER, {})).statusCode).toBe(202);
  });

  it('returns 429 within five minutes of the last sync', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'IDLE', finishedAt: '2026-09-13T11:57:00.000Z' });
    expect((await triggerSync(makeEvent(), USER, {})).statusCode).toBe(429);
  });
});

describe('getSyncStatus', () => {
  it('defaults to IDLE when no sync has run', async () => {
    store.getSyncStatus.mockResolvedValueOnce(null);
    const res = await getSyncStatus(makeEvent(), USER, {});
    expect(JSON.parse(res.body)).toEqual({ status: { state: 'IDLE' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/api/__tests__/banks.test.ts`
Expected: FAIL — cannot resolve `../banks`.

- [ ] **Step 3: Implement**

`src/api/worker.ts`:
```ts
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { WorkerCommand, WorkerResult } from '../sync/commands';

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'eu-west-2' });

function functionName(): string {
  const name = process.env.WORKER_FUNCTION_NAME;
  if (!name) throw new Error('Missing required environment variable WORKER_FUNCTION_NAME');
  return name;
}

const encode = (command: WorkerCommand): Uint8Array => new TextEncoder().encode(JSON.stringify(command));

export async function invokeWorker<T>(command: WorkerCommand): Promise<WorkerResult<T>> {
  const result = await lambda.send(new InvokeCommand({
    FunctionName: functionName(),
    InvocationType: 'RequestResponse',
    Payload: encode(command),
  }));
  if (result.FunctionError || !result.Payload) {
    console.error(JSON.stringify({ event: 'worker.invoke_failed', command: command.command, functionError: result.FunctionError ?? 'NO_PAYLOAD' }));
    return { ok: false, error: 'UPSTREAM', message: 'The bank service is unavailable' };
  }
  return JSON.parse(new TextDecoder().decode(result.Payload)) as WorkerResult<T>;
}

export async function invokeWorkerAsync(command: WorkerCommand): Promise<void> {
  await lambda.send(new InvokeCommand({
    FunctionName: functionName(),
    InvocationType: 'Event',
    Payload: encode(command),
  }));
}
```

`src/api/banks.ts`:
```ts
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { EbBank } from '../sync/providers/enableBanking';
import { SUPPORTED_COUNTRIES } from '../sync/commands';
import type { WorkerErrorCode } from '../sync/commands';
import { createDynamoSyncStore } from '../sync/stores/dynamoSyncStore';
import type { Connection, PsuContext } from '../sync/types';
import { DATE_RE, UUID_RE, hasOnlyKeys, parseJsonBody } from './body';
import { SECURITY_HEADERS } from './constants';
import { err, ok } from './http';
import type { ApiResponse } from './types';
import { invokeWorker, invokeWorkerAsync } from './worker';

const store = createDynamoSyncStore();

const DAY_MS = 86_400_000;
const MAX_HISTORY_DAYS = 730;
const CONSENT_WARNING_DAYS = 7;
const SYNC_RUNNING_STALE_MS = 10 * 60_000;
const MANUAL_SYNC_COOLDOWN_MS = 5 * 60_000;
const MAX_ASPSP_NAME_LENGTH = 100;
const MAX_CODE_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 512;

const WORKER_ERROR_STATUS: Record<WorkerErrorCode, number> = { BAD_REQUEST: 400, NOT_FOUND: 404, UPSTREAM: 502 };

type Params = Record<string, string>;

export type PublicConnection = Omit<Connection, 'auth'> & { expiresInDays: number | null; needsAttention: boolean };

function psuFrom(event: APIGatewayProxyEventV2): PsuContext {
  return {
    ipAddress: event.requestContext.http.sourceIp,
    userAgent: (event.headers?.['user-agent'] ?? '').slice(0, MAX_USER_AGENT_LENGTH),
  };
}

const isSupportedCountry = (value: unknown): value is (typeof SUPPORTED_COUNTRIES)[number] =>
  (SUPPORTED_COUNTRIES as readonly unknown[]).includes(value);

const today = (): string => new Date().toISOString().slice(0, 10);

const empty = (statusCode: number): ApiResponse => ({ statusCode, headers: SECURITY_HEADERS, body: '' });

export function validateStartDate(value: unknown, todayIso: string): string | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return 'startDate must be in YYYY-MM-DD format';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'startDate must be in YYYY-MM-DD format';
  if (value > todayIso) return 'startDate cannot be in the future';
  const earliest = new Date(Date.parse(`${todayIso}T00:00:00Z`) - MAX_HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
  if (value < earliest) return 'startDate cannot be more than 2 years ago';
  return null;
}

export function toPublicConnection(connection: Connection, nowMs: number): PublicConnection {
  const { auth: _auth, ...rest } = connection;
  const expiresInDays = Math.floor((Date.parse(connection.auth.consentValidUntil) - nowMs) / DAY_MS);
  const needsAttention = connection.status !== 'ACTIVE' || expiresInDays <= CONSENT_WARNING_DAYS;
  return { ...rest, expiresInDays, needsAttention };
}

export async function listAspsps(event: APIGatewayProxyEventV2, _userId: string, _params: Params): Promise<ApiResponse> {
  const country = event.queryStringParameters?.country;
  if (!isSupportedCountry(country)) return err(400, 'country must be GB');
  const result = await invokeWorker<EbBank[]>({ command: 'listBanks', country });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);
  return ok({ aspsps: result.value });
}

export async function connectBank(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const body = parseJsonBody(event);
  if (!body || !hasOnlyKeys(body, ['aspspName', 'country', 'startDate'], ['connectionId'])) {
    return err(400, 'Body must contain aspspName, country, startDate and optional connectionId');
  }
  const { aspspName, country, startDate, connectionId } = body;
  if (typeof aspspName !== 'string' || aspspName.length === 0 || aspspName.length > MAX_ASPSP_NAME_LENGTH) {
    return err(400, 'aspspName must be 1-100 characters');
  }
  if (!isSupportedCountry(country)) return err(400, 'country must be GB');
  const startDateError = validateStartDate(startDate, today());
  if (startDateError) return err(400, startDateError);
  if (connectionId !== undefined && (typeof connectionId !== 'string' || !UUID_RE.test(connectionId))) {
    return err(400, 'connectionId must be a UUID');
  }

  const result = await invokeWorker<{ url: string }>({
    command: 'startAuth',
    userId,
    aspspName,
    country,
    startDate: startDate as string,
    ...(typeof connectionId === 'string' ? { connectionId } : {}),
    psu: psuFrom(event),
  });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);
  return ok({ url: result.value.url });
}

export async function completeBankCallback(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const body = parseJsonBody(event);
  if (!body || !hasOnlyKeys(body, ['code', 'state'])) return err(400, 'Body must contain code and state');
  const { code, state } = body;
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) return err(400, 'Invalid code');
  if (typeof state !== 'string' || !UUID_RE.test(state)) return err(400, 'Invalid state');

  const psu = psuFrom(event);
  const result = await invokeWorker<{ connection: Connection }>({ command: 'completeAuth', userId, state, code, psu });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);

  try {
    await invokeWorkerAsync({ command: 'syncNow', userId, psu });
  } catch (error) {
    console.error(JSON.stringify({ event: 'banks.first_sync_invoke_failed', errorName: error instanceof Error ? error.name : 'unknown' }));
  }

  return {
    statusCode: 201,
    headers: SECURITY_HEADERS,
    body: JSON.stringify({ connection: toPublicConnection(result.value.connection, Date.now()) }),
  };
}

export async function clearPendingAuth(_event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!UUID_RE.test(params.state ?? '')) return err(400, 'Invalid state');
  await store.deletePendingAuth(userId, params.state);
  return empty(204);
}

export async function listBankConnections(_event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const now = Date.now();
  const connections = await store.listConnections(userId);
  return ok({ connections: connections.map(connection => toPublicConnection(connection, now)) });
}

export async function disconnectBank(_event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!UUID_RE.test(params.connectionId ?? '')) return err(400, 'connectionId must be a UUID');
  const result = await invokeWorker<{ disconnected: true }>({ command: 'disconnect', userId, connectionId: params.connectionId });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);
  return empty(204);
}

export async function triggerSync(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const now = Date.now();
  const status = await store.getSyncStatus(userId);
  if (status?.state === 'RUNNING' && status.startedAt && now - Date.parse(status.startedAt) < SYNC_RUNNING_STALE_MS) {
    return err(409, 'A sync is already running');
  }
  if (status?.finishedAt && now - Date.parse(status.finishedAt) < MANUAL_SYNC_COOLDOWN_MS) {
    return err(429, 'Synced recently. Try again in a few minutes.');
  }
  await invokeWorkerAsync({ command: 'syncNow', userId, psu: psuFrom(event) });
  return { statusCode: 202, headers: SECURITY_HEADERS, body: JSON.stringify({ status: 'STARTED' }) };
}

export async function getSyncStatus(_event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const status = await store.getSyncStatus(userId);
  return ok({ status: status ?? { state: 'IDLE' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/api/__tests__/banks.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/worker.ts src/api/banks.ts src/api/__tests__/banks.test.ts
git commit -m "feat(api): add bank connection and sync endpoints backed by the worker (addresses IO-01, AUTH-04)"
```

---

### Task 15: Inbox endpoints

**Files:**
- Create: `src/api/inbox.ts`
- Test: `src/api/__tests__/inbox.test.ts`

**Interfaces:**
- Consumes: `docClient`, `TABLE`, `pk`, `txnSk`, `inboxSk`, `seenSk` (Task 5); `isCancelledByCondition` (Task 5); `validateTransactionInput` (existing `src/api/transactions.ts`); `InboxItem` (Task 1); `parseJsonBody`, `hasOnlyKeys`, `isRecord`, `DATE_RE` (Task 1).
- Produces: handlers `getInbox`, `getInboxCount`, `confirmInboxItem`, `ignoreInboxItem`; `encodeCursor(key: Record<string, unknown>): string`; `decodeCursor(cursor: string, userId: string): { PK: string; SK: string } | null`; `INBOX_PAGE_SIZE = 50`. Responses: `GET /api/inbox` → `{ items: InboxItem[]; cursor?: string }`; count → `{ count }`; confirm → 201 `{ transaction }`; ignore → 204.

- [ ] **Step 1: Write the failing test**

`src/api/__tests__/inbox.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  txnSk: (ym: string, id: string) => `TXN#${ym}#${id}`,
  inboxSk: (date: string, key: string) => `INBOX#${date}#${key}`,
  seenSk: (key: string) => `SEEN#${key}`,
}));

// inbox.ts imports validateTransactionInput from transactions.ts, which imports these commands too
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (i: unknown) { return i; }),
  QueryCommand: vi.fn(function (i: unknown) { return i; }),
  PutCommand: vi.fn(function (i: unknown) { return i; }),
  DeleteCommand: vi.fn(function (i: unknown) { return i; }),
  TransactWriteCommand: vi.fn(function (i: unknown) { return i; }),
}));

import { confirmInboxItem, decodeCursor, encodeCursor, getInbox, getInboxCount, ignoreInboxItem } from '../inbox';

const USER = 'user-1';
const KEY = 'a'.repeat(32);
const params = { bookingDate: '2026-09-10', txnKey: KEY };
const stored = {
  PK: 'USER#user-1', SK: `INBOX#2026-09-10#${KEY}`, txnKey: KEY, amount: 499, direction: 'OUT',
  suggestedType: 'EXPENSE', description: 'NETFLIX', bookingDate: '2026-09-10', connectionId: 'c1',
  accountUid: 'acc-1', importedAt: '2026-09-13T12:00:00.000Z',
};

const makeEvent = (opts: { body?: unknown; query?: Record<string, string> } = {}) => ({
  body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  queryStringParameters: opts.query ?? {},
  requestContext: { http: { method: 'POST' } },
} as unknown as APIGatewayProxyEventV2);

const cancelled = (codes: string[]) => Object.assign(new Error('cancelled'), {
  name: 'TransactionCanceledException', CancellationReasons: codes.map(Code => ({ Code })),
});

beforeEach(() => { mockSend.mockReset(); });

describe('cursor', () => {
  it('round-trips a key belonging to the user', () => {
    const cursor = encodeCursor({ PK: 'USER#user-1', SK: 'INBOX#2026-09-10#k' });
    expect(decodeCursor(cursor, USER)).toEqual({ PK: 'USER#user-1', SK: 'INBOX#2026-09-10#k' });
  });

  it.each([
    ['another user', { PK: 'USER#other', SK: 'INBOX#x' }],
    ['another item type', { PK: 'USER#user-1', SK: 'TXN#2026-09#x' }],
    ['extra keys', { PK: 'USER#user-1', SK: 'INBOX#x', admin: true }],
  ])('rejects a cursor for %s', (_label, key) => {
    expect(decodeCursor(encodeCursor(key), USER)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(decodeCursor('%%%', USER)).toBeNull();
  });
});

describe('getInbox', () => {
  it('returns items newest first without table keys and a next cursor', async () => {
    mockSend.mockResolvedValueOnce({ Items: [stored], LastEvaluatedKey: { PK: 'USER#user-1', SK: stored.SK } });
    const res = await getInbox(makeEvent(), USER, {});
    const body = JSON.parse(res.body);
    expect(body.items[0]).not.toHaveProperty('PK');
    expect(decodeCursor(body.cursor, USER)).toEqual({ PK: 'USER#user-1', SK: stored.SK });
    expect(mockSend.mock.calls[0][0]).toMatchObject({ ScanIndexForward: false, Limit: 50 });
  });

  it('rejects a forged cursor', async () => {
    const res = await getInbox(makeEvent({ query: { cursor: encodeCursor({ PK: 'USER#other', SK: 'INBOX#x' }) } }), USER, {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('getInboxCount', () => {
  it('sums counts across pages', async () => {
    mockSend
      .mockResolvedValueOnce({ Count: 2, LastEvaluatedKey: { PK: 'x', SK: 'y' } })
      .mockResolvedValueOnce({ Count: 3 });
    const res = await getInboxCount(makeEvent(), USER, {});
    expect(JSON.parse(res.body)).toEqual({ count: 5 });
  });
});

describe('confirmInboxItem', () => {
  it('uses the stored amount and date, ignoring any in the body', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(201);
    const [put, del, update] = mockSend.mock.calls[1][0].TransactItems;
    expect(put.Put.Item).toMatchObject({
      SK: `TXN#2026-09#${KEY}`, transactionId: KEY, amount: 499, date: '2026-09-10',
      source: 'BANK', bankRef: { connectionId: 'c1', accountUid: 'acc-1', txnKey: KEY },
    });
    expect(put.Put.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect(del.Delete.ConditionExpression).toBe('attribute_exists(SK)');
    expect(update.Update.ExpressionAttributeValues).toEqual({ ':outcome': 'CONFIRMED' });
  });

  it('rejects amount or date in the body', async () => {
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1', amount: 499900 } }), USER, params);
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('lets the user override the description', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
    await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1', description: 'Netflix' } }), USER, params);
    expect(mockSend.mock.calls[1][0].TransactItems[0].Put.Item.description).toBe('Netflix');
  });

  it('returns 404 when the inbox item is missing', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when a double-submit already removed the item', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockRejectedValueOnce(cancelled(['None', 'ConditionalCheckFailed', 'None']));
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when the transaction already exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored }).mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None', 'None']));
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(409);
  });

  it.each([
    ['bad date', { bookingDate: '10-09-2026', txnKey: KEY }],
    ['bad key', { bookingDate: '2026-09-10', txnKey: 'short' }],
  ])('rejects %s in the path', async (_label, badParams) => {
    const res = await confirmInboxItem(makeEvent({ body: { type: 'EXPENSE', categoryId: 'cat-1' } }), USER, badParams);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid type via the shared transaction validation', async () => {
    mockSend.mockResolvedValueOnce({ Item: stored });
    const res = await confirmInboxItem(makeEvent({ body: { type: 'GIFT', categoryId: 'cat-1' } }), USER, params);
    expect(res.statusCode).toBe(400);
  });
});

describe('ignoreInboxItem', () => {
  it('deletes the inbox item and marks it ignored', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await ignoreInboxItem(makeEvent(), USER, params);
    expect(res.statusCode).toBe(204);
    const [del, update] = mockSend.mock.calls[0][0].TransactItems;
    expect(del.Delete.Key).toEqual({ PK: 'USER#user-1', SK: `INBOX#2026-09-10#${KEY}` });
    expect(update.Update.ExpressionAttributeValues).toEqual({ ':outcome': 'IGNORED' });
  });

  it('returns 404 when the item is already gone', async () => {
    mockSend.mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None']));
    const res = await ignoreInboxItem(makeEvent(), USER, params);
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/api/__tests__/inbox.test.ts`
Expected: FAIL — cannot resolve `../inbox`.

- [ ] **Step 3: Implement**

`src/api/inbox.ts`:
```ts
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { InboxItem } from '../sync/types';
import { DATE_RE, hasOnlyKeys, isRecord, parseJsonBody } from './body';
import { SECURITY_HEADERS } from './constants';
import { docClient, TABLE, pk, txnSk, inboxSk, seenSk } from './db';
import { isCancelledByCondition } from './dynamoErrors';
import { err, ok } from './http';
import { validateTransactionInput } from './transactions';
import type { ApiResponse, Transaction } from './types';

export const INBOX_PAGE_SIZE = 50;
const TXN_KEY_RE = /^[0-9a-f]{32}$/;

type Params = Record<string, string>;

function withoutKeys(item: Record<string, unknown>): InboxItem {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as unknown as InboxItem;
}

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string, userId: string): { PK: string; SK: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['PK', 'SK'])) return null;
    if (parsed.PK !== pk(userId) || typeof parsed.SK !== 'string' || !parsed.SK.startsWith('INBOX#')) return null;
    return { PK: parsed.PK, SK: parsed.SK };
  } catch {
    return null;
  }
}

function validItemParams(params: Params): boolean {
  return DATE_RE.test(params.bookingDate ?? '') && TXN_KEY_RE.test(params.txnKey ?? '');
}

export async function getInbox(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const rawCursor = event.queryStringParameters?.cursor;
  const startKey = rawCursor ? decodeCursor(rawCursor, userId) : undefined;
  if (startKey === null) return err(400, 'Invalid cursor');

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'INBOX#' },
    ScanIndexForward: false,
    Limit: INBOX_PAGE_SIZE,
    ExclusiveStartKey: startKey,
  }));

  return ok({
    items: (result.Items ?? []).map(withoutKeys),
    ...(result.LastEvaluatedKey ? { cursor: encodeCursor(result.LastEvaluatedKey) } : {}),
  });
}

export async function getInboxCount(_event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'INBOX#' },
      Select: 'COUNT',
      ExclusiveStartKey: startKey,
    }));
    count += result.Count ?? 0;
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return ok({ count });
}

export async function confirmInboxItem(event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!validItemParams(params)) return err(400, 'Invalid inbox item reference');
  const body = parseJsonBody(event);
  if (!body || !hasOnlyKeys(body, ['type', 'categoryId'], ['description'])) {
    return err(400, 'Body must contain type, categoryId and optional description');
  }

  const { bookingDate, txnKey } = params;
  const found = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: inboxSk(bookingDate, txnKey) } }));
  if (!found.Item) return err(404, 'Inbox item not found');
  const item = withoutKeys(found.Item);

  const validation = validateTransactionInput({
    amount: item.amount,
    type: body.type,
    categoryId: body.categoryId,
    description: body.description ?? item.description,
    date: item.bookingDate,
  });
  if (validation.ok === false) return err(400, validation.message);

  const yearMonth = item.bookingDate.slice(0, 7);
  const transaction: Transaction = {
    transactionId: txnKey,
    yearMonth,
    ...validation.value,
    createdAt: new Date().toISOString(),
    source: 'BANK',
    bankRef: { connectionId: item.connectionId, accountUid: item.accountUid, txnKey },
  };

  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: { PK: pk(userId), SK: txnSk(yearMonth, txnKey), ...transaction },
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        {
          Delete: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: inboxSk(bookingDate, txnKey) },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: seenSk(txnKey) },
            UpdateExpression: 'SET #outcome = :outcome',
            ExpressionAttributeNames: { '#outcome': 'outcome' },
            ExpressionAttributeValues: { ':outcome': 'CONFIRMED' },
          },
        },
      ],
    }));
  } catch (error) {
    if (isCancelledByCondition(error, 0)) return err(409, 'Transaction already exists');
    if (isCancelledByCondition(error, 1)) return err(404, 'Inbox item not found');
    throw error;
  }

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ transaction }) };
}

export async function ignoreInboxItem(_event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!validItemParams(params)) return err(400, 'Invalid inbox item reference');
  const { bookingDate, txnKey } = params;

  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: inboxSk(bookingDate, txnKey) },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: seenSk(txnKey) },
            UpdateExpression: 'SET #outcome = :outcome',
            ExpressionAttributeNames: { '#outcome': 'outcome' },
            ExpressionAttributeValues: { ':outcome': 'IGNORED' },
          },
        },
      ],
    }));
  } catch (error) {
    if (isCancelledByCondition(error, 0)) return err(404, 'Inbox item not found');
    throw error;
  }

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/api/__tests__/inbox.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/inbox.ts src/api/__tests__/inbox.test.ts
git commit -m "feat(api): add inbox list, count, confirm and ignore endpoints (addresses IO-01, IO-07)"
```

---

### Task 16: Register routes

**Files:**
- Modify: `api-handler.ts`
- Test: `src/api/__tests__/router.test.ts` (existing — run only)

**Interfaces:**
- Consumes: handlers from Tasks 14 and 15.

- [ ] **Step 1: Register the routes**

In `api-handler.ts`, add imports:
```ts
import {
  clearPendingAuth, completeBankCallback, connectBank, disconnectBank,
  getSyncStatus, listAspsps, listBankConnections, triggerSync,
} from './src/api/banks';
import { confirmInboxItem, getInbox, getInboxCount, ignoreInboxItem } from './src/api/inbox';
```
and after the existing `router.delete('/api/targets/{categoryId}', deleteTarget);` line:
```ts
router.get('/api/banks/aspsps', listAspsps);
router.post('/api/banks/connect', connectBank);
router.post('/api/banks/callback', completeBankCallback);
router.delete('/api/banks/auth/{state}', clearPendingAuth);
router.get('/api/banks/connections', listBankConnections);
router.delete('/api/banks/connections/{connectionId}', disconnectBank);
router.post('/api/sync', triggerSync);
router.get('/api/sync/status', getSyncStatus);
router.get('/api/inbox/count', getInboxCount);
router.get('/api/inbox', getInbox);
router.post('/api/inbox/{bookingDate}/{txnKey}/confirm', confirmInboxItem);
router.post('/api/inbox/{bookingDate}/{txnKey}/ignore', ignoreInboxItem);
```

- [ ] **Step 2: Verify**

Run: `yarn test && yarn typecheck && yarn build`
Expected: all tests PASS; build produces `build/api/index.js` and `build/sync/index.js`.

- [ ] **Step 3: Commit**

```bash
git add api-handler.ts
git commit -m "feat(api): register bank, sync and inbox routes"
```

---

## Phase H — Frontend

### Task 17: Frontend types, API errors, API client and query hooks

**Files:**
- Create: `app/lib/apiError.ts`, `app/lib/transactionTypes.ts`
- Modify: `app/hooks/useProtectedApi.ts`, `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`, `app/components/transactions/TransactionSheet.tsx`
- Test: `app/lib/__tests__/api.test.ts`, `app/lib/__tests__/transactionTypes.test.ts`

**Interfaces:**
- Produces:
  - `ApiError extends Error { status: number }` thrown by `useProtectedApi` for non-2xx
  - `TYPE_OPTIONS: { label: string; value: TransactionType }[]`, `categoryTypeFor(type: TransactionType): CategoryType`
  - Types: `BankAspsp`, `ConnectedAccount`, `BankConnection`, `InboxItem`, `InboxPage`, `SyncResult`, `SyncStatus`, `PendingSync`
  - API methods: `getAspsps(country)`, `connectBank(input)`, `completeBankCallback(code, state)`, `clearBankAuth(state)`, `getConnections()`, `disconnectBank(connectionId)`, `triggerSync()`, `getSyncStatus()`, `getInbox(cursor?)`, `getInboxCount()`, `confirmInboxItem(item, input)`, `ignoreInboxItem(item)`
  - Hooks: `useAspsps(enabled)`, `useConnections()`, `useConnectBank()`, `useCompleteBankCallback()`, `useClearBankAuth()`, `useDisconnectBank()`, `useTriggerSync()`, `useInbox()`, `useInboxCount()`, `useConfirmInboxItem()`, `useIgnoreInboxItem()` (`useSyncStatus` is added in Task 18)
  - Query keys: `connections`, `aspsps`, `syncStatus`, `inbox`, `inboxCount`

- [ ] **Step 1: Write the failing tests**

`app/lib/__tests__/transactionTypes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { categoryTypeFor } from '../transactionTypes';

describe('categoryTypeFor', () => {
  it.each([
    ['EXPENSE', 'EXPENSE'],
    ['INCOME', 'INCOME'],
    ['INVESTMENT_IN', 'INVESTMENT'],
    ['INVESTMENT_OUT', 'INVESTMENT'],
  ] as const)('%s → %s', (type, expected) => {
    expect(categoryTypeFor(type)).toBe(expected);
  });
});
```

`app/lib/__tests__/api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../api';

function setup(response: unknown = {}) {
  const request = vi.fn(async () => response);
  return { request, api: createApi(request) };
}

describe('bank and inbox API client', () => {
  it('encodes path segments', async () => {
    const { request, api } = setup();
    await api.disconnectBank('a/b');
    expect(request).toHaveBeenCalledWith('/api/banks/connections/a%2Fb', { method: 'DELETE' });
  });

  it('posts the connect request and returns the url', async () => {
    const { request, api } = setup({ url: 'https://tilisy.enablebanking.com/x' });
    const url = await api.connectBank({ aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01' });
    expect(url).toBe('https://tilisy.enablebanking.com/x');
    expect(request).toHaveBeenCalledWith('/api/banks/connect', {
      method: 'POST', body: JSON.stringify({ aspspName: 'Lloyds Bank', country: 'GB', startDate: '2026-09-01' }),
    });
  });

  it('passes the inbox cursor as an encoded query parameter', async () => {
    const { request, api } = setup({ items: [] });
    await api.getInbox('abc+/=');
    expect(request).toHaveBeenCalledWith('/api/inbox?cursor=abc%2B%2F%3D');
  });

  it('confirms an inbox item by booking date and key', async () => {
    const { request, api } = setup({ transaction: { transactionId: 'k' } });
    await api.confirmInboxItem({ bookingDate: '2026-09-10', txnKey: 'k' }, { type: 'EXPENSE', categoryId: 'c' });
    expect(request).toHaveBeenCalledWith('/api/inbox/2026-09-10/k/confirm', {
      method: 'POST', body: JSON.stringify({ type: 'EXPENSE', categoryId: 'c' }),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/transactionTypes.test.ts app/lib/__tests__/api.test.ts`
Expected: FAIL — module/methods not found.

- [ ] **Step 3: Implement types, errors and shared transaction types**

`app/lib/apiError.ts`:
```ts
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`API error: ${status} ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
  }
}
```

`app/hooks/useProtectedApi.ts` — import `ApiError` from `~/lib/apiError` and replace the `throw new Error(...)` line with:
```ts
          throw new ApiError(response.status, response.statusText);
```

`app/lib/transactionTypes.ts`:
```ts
import type { CategoryType, TransactionType } from './types';

export const TYPE_OPTIONS: { label: string; value: TransactionType }[] = [
  { label: 'Spend', value: 'EXPENSE' },
  { label: 'Income', value: 'INCOME' },
  { label: 'Invest in', value: 'INVESTMENT_IN' },
  { label: 'Invest out', value: 'INVESTMENT_OUT' },
];

const CATEGORY_TYPE_BY_TRANSACTION_TYPE: Record<TransactionType, CategoryType> = {
  EXPENSE: 'EXPENSE',
  INCOME: 'INCOME',
  INVESTMENT_IN: 'INVESTMENT',
  INVESTMENT_OUT: 'INVESTMENT',
};

export function categoryTypeFor(type: TransactionType): CategoryType {
  return CATEGORY_TYPE_BY_TRANSACTION_TYPE[type];
}
```

`app/components/transactions/TransactionSheet.tsx`: delete the local `TYPE_OPTIONS` constant and the nested-ternary `expectedCategoryType`; import `{ TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes'` and use `const expectedCategoryType = categoryTypeFor(type);`.

`app/lib/types.ts` — append:
```ts
export interface BankAspsp {
  name: string;
  country: string;
  logo: string;
  maximumConsentValiditySeconds: number;
}

export type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'ERROR';

export interface ConnectedAccount {
  accountUid: string;
  dedupeId: string;
  displayName: string;
  last4: string;
  currency: string;
  startDate: string;
  lastSyncedAt?: string;
}

export interface BankConnection {
  connectionId: string;
  provider: 'enable-banking';
  displayName: string;
  status: ConnectionStatus;
  consecutiveFailures: number;
  lastError?: { type: string; at: string };
  accounts: ConnectedAccount[];
  createdAt: string;
  updatedAt: string;
  expiresInDays: number | null;
  needsAttention: boolean;
}

export interface InboxItem {
  txnKey: string;
  amount: number;
  direction: 'IN' | 'OUT';
  suggestedType: 'INCOME' | 'EXPENSE';
  description: string;
  bookingDate: string;
  connectionId: string;
  accountUid: string;
  importedAt: string;
  suggestion?: { type: TransactionType; categoryId: string; ruleId: string };
}

export interface InboxPage {
  items: InboxItem[];
  cursor?: string;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  failedAccounts: number;
  partial: boolean;
}

export interface SyncStatus {
  state: 'IDLE' | 'RUNNING';
  startedAt?: string;
  finishedAt?: string;
  lastResult?: SyncResult;
}

export interface PendingSync {
  baselineFinishedAt: string | null;
  requestedAt: number;
}
```

- [ ] **Step 4: Implement the API client methods**

`app/lib/api.ts` — extend the type import to include `BankAspsp, BankConnection, InboxItem, InboxPage, SyncStatus`, add this exported type above `createApi`:
```ts
export interface ConnectBankInput {
  aspspName: string;
  country: string;
  startDate: string;
  connectionId?: string;
}

export interface ConfirmInboxInput {
  type: TransactionType;
  categoryId: string;
  description?: string;
}

type InboxRef = Pick<InboxItem, 'bookingDate' | 'txnKey'>;
const inboxPath = (item: InboxRef, action: 'confirm' | 'ignore') =>
  `/api/inbox/${item.bookingDate}/${encodeURIComponent(item.txnKey)}/${action}`;
```
and add these members to the object returned by `createApi`:
```ts
    getAspsps: async (country: string): Promise<BankAspsp[]> => {
      const res = await request(`/api/banks/aspsps?country=${encodeURIComponent(country)}`) as { aspsps: BankAspsp[] };
      return res.aspsps;
    },
    connectBank: async (input: ConnectBankInput): Promise<string> => {
      const res = await request('/api/banks/connect', { method: 'POST', body: JSON.stringify(input) }) as { url: string };
      return res.url;
    },
    completeBankCallback: async (code: string, state: string): Promise<BankConnection> => {
      const res = await request('/api/banks/callback', { method: 'POST', body: JSON.stringify({ code, state }) }) as { connection: BankConnection };
      return res.connection;
    },
    clearBankAuth: async (state: string): Promise<void> => {
      await request(`/api/banks/auth/${encodeURIComponent(state)}`, { method: 'DELETE' });
    },
    getConnections: async (): Promise<BankConnection[]> => {
      const res = await request('/api/banks/connections') as { connections: BankConnection[] };
      return res.connections;
    },
    disconnectBank: async (connectionId: string): Promise<void> => {
      await request(`/api/banks/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    },
    triggerSync: async (): Promise<void> => {
      await request('/api/sync', { method: 'POST' });
    },
    getSyncStatus: async (): Promise<SyncStatus> => {
      const res = await request('/api/sync/status') as { status: SyncStatus };
      return res.status;
    },
    getInbox: async (cursor?: string): Promise<InboxPage> => {
      const path = cursor ? `/api/inbox?cursor=${encodeURIComponent(cursor)}` : '/api/inbox';
      return await request(path) as InboxPage;
    },
    getInboxCount: async (): Promise<number> => {
      const res = await request('/api/inbox/count') as { count: number };
      return res.count;
    },
    confirmInboxItem: async (item: InboxRef, input: ConfirmInboxInput): Promise<Transaction> => {
      const res = await request(inboxPath(item, 'confirm'), { method: 'POST', body: JSON.stringify(input) }) as { transaction: Transaction };
      return res.transaction;
    },
    ignoreInboxItem: async (item: InboxRef): Promise<void> => {
      await request(inboxPath(item, 'ignore'), { method: 'POST' });
    },
```

- [ ] **Step 5: Implement the hooks**

`app/lib/queries.ts` — change the react-query import to `import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';`, import `type ConfirmInboxInput, type ConnectBankInput` from `./api`, import `type InboxItem, type InboxPage` from `./types`, and extend `queryKeys`:
```ts
export const queryKeys = {
  categories: ['categories'] as const,
  targets: ['targets'] as const,
  transactions: (yearMonth: string) => ['transactions', yearMonth] as const,
  connections: ['connections'] as const,
  aspsps: ['aspsps'] as const,
  syncStatus: ['syncStatus'] as const,
  inbox: ['inbox'] as const,
  inboxCount: ['inboxCount'] as const,
};
```
Append:
```ts
export function useAspsps(enabled: boolean) {
  const api = useApi();
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.aspsps,
    queryFn: () => api.getAspsps('GB'),
    staleTime: 60 * 60_000,
    enabled: enabled && authReady,
  });
}

export function useConnections() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({ queryKey: queryKeys.connections, queryFn: () => api.getConnections(), enabled });
}

export function useConnectBank() {
  const api = useApi();
  return useMutation({ mutationFn: (input: ConnectBankInput) => api.connectBank(input) });
}

export function useCompleteBankCallback() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { code: string; state: string }) => api.completeBankCallback(vars.code, vars.state),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.connections });
      qc.invalidateQueries({ queryKey: queryKeys.syncStatus });
    },
  });
}

export function useClearBankAuth() {
  const api = useApi();
  return useMutation({ mutationFn: (state: string) => api.clearBankAuth(state) });
}

export function useDisconnectBank() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => api.disconnectBank(connectionId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.connections });
      qc.invalidateQueries({ queryKey: queryKeys.inbox });
      qc.invalidateQueries({ queryKey: queryKeys.inboxCount });
    },
  });
}

export function useTriggerSync() {
  const api = useApi();
  return useMutation({ mutationFn: () => api.triggerSync() });
}

export function useInbox() {
  const api = useApi();
  const enabled = useAuthReady();
  return useInfiniteQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ pageParam }) => api.getInbox(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: InboxPage) => lastPage.cursor,
    enabled,
  });
}

export function useInboxCount() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({ queryKey: queryKeys.inboxCount, queryFn: () => api.getInboxCount(), enabled });
}

function removeFromInbox(qc: QueryClient, txnKey: string): InfiniteData<InboxPage> | undefined {
  const previous = qc.getQueryData<InfiniteData<InboxPage>>(queryKeys.inbox);
  qc.setQueryData<InfiniteData<InboxPage>>(queryKeys.inbox, old => old && {
    ...old,
    pages: old.pages.map(page => ({ ...page, items: page.items.filter(item => item.txnKey !== txnKey) })),
  });
  return previous;
}

export function useConfirmInboxItem() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item: InboxItem; input: ConfirmInboxInput }) => api.confirmInboxItem(vars.item, vars.input),
    onMutate: async ({ item }) => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox });
      return { previous: removeFromInbox(qc, item.txnKey) };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.inbox, context.previous);
    },
    onSettled: (_data, _error, { item }) => {
      qc.invalidateQueries({ queryKey: queryKeys.inboxCount });
      qc.invalidateQueries({ queryKey: queryKeys.transactions(item.bookingDate.slice(0, 7)) });
    },
  });
}

export function useIgnoreInboxItem() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: InboxItem) => api.ignoreInboxItem(item),
    onMutate: async item => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox });
      return { previous: removeFromInbox(qc, item.txnKey) };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.inbox, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.inboxCount }),
  });
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `yarn vitest run app/lib/__tests__ app/components/transactions && yarn typecheck`
Expected: PASS, including the existing `TransactionSheet` and `queries` tests.

- [ ] **Step 7: Commit**

```bash
git add app/lib/apiError.ts app/lib/transactionTypes.ts app/hooks/useProtectedApi.ts app/lib/types.ts app/lib/api.ts app/lib/queries.ts app/components/transactions/TransactionSheet.tsx app/lib/__tests__/api.test.ts app/lib/__tests__/transactionTypes.test.ts
git commit -m "feat(app): add bank, sync and inbox API client and query hooks"
```

---

### Task 18: Pure UI helpers for banks and sync

**Files:**
- Create: `app/lib/banks.ts`, `app/lib/sync.ts`
- Test: `app/lib/__tests__/banks.test.ts`, `app/lib/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `BankConnection`, `SyncStatus`, `PendingSync` (Task 17), `ApiError` (Task 17).
- Produces:
  - `earliestStartDate(today: string): string` (730 days before)
  - `lastSyncedAt(connection: BankConnection): string | null`
  - `describeSyncAge(iso: string | null, nowMs: number): string`
  - `consentLabel(connection: BankConnection): string | null`
  - `statusBadge(connection: BankConnection): { label: string; color: 'success' | 'warning' | 'danger' }`
  - `accountLabel(connections: BankConnection[], connectionId: string, accountUid: string): string`
  - `isSyncFinished(status: SyncStatus | undefined, pending: PendingSync): boolean`
  - `shouldPollSync(status: SyncStatus | undefined, pending: PendingSync | null, nowMs: number): boolean`
  - `syncErrorMessage(error: unknown): string`
  - `SYNC_MAX_WAIT_MS = 6 * 60_000`
  - Hook `useSyncStatus(pending: PendingSync | null = null)` in `app/lib/queries.ts`

**Files (additional):** Modify `app/lib/queries.ts`.

- [ ] **Step 1: Write the failing tests**

`app/lib/__tests__/banks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { accountLabel, consentLabel, describeSyncAge, earliestStartDate, lastSyncedAt, statusBadge } from '../banks';
import type { BankConnection } from '../types';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    connectionId: 'c1', provider: 'enable-banking', displayName: 'Lloyds Bank', status: 'ACTIVE',
    consecutiveFailures: 0, createdAt: 't', updatedAt: 't', expiresInDays: 90, needsAttention: false,
    accounts: [
      { accountUid: 'a1', dedupeId: 'a1', displayName: 'Current Account', last4: '1234', currency: 'GBP', startDate: '2026-09-01', lastSyncedAt: '2026-09-13T09:00:00.000Z' },
      { accountUid: 'a2', dedupeId: 'a2', displayName: 'Saver', last4: '', currency: 'GBP', startDate: '2026-09-01', lastSyncedAt: '2026-09-13T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

describe('earliestStartDate', () => {
  it('is two years (730 days) before today', () => {
    expect(earliestStartDate('2026-09-13')).toBe('2024-09-13');
  });
});

describe('lastSyncedAt', () => {
  it('returns the most recent account sync', () => {
    expect(lastSyncedAt(connection())).toBe('2026-09-13T10:00:00.000Z');
  });

  it('returns null when no account has synced', () => {
    expect(lastSyncedAt(connection({ accounts: [] }))).toBeNull();
  });
});

describe('describeSyncAge', () => {
  it.each([
    [null, 'Never synced'],
    ['2026-09-13T11:59:30.000Z', 'Synced just now'],
    ['2026-09-13T11:45:00.000Z', 'Synced 15 min ago'],
    ['2026-09-13T09:00:00.000Z', 'Synced 3h ago'],
    ['2026-09-11T12:00:00.000Z', 'Synced 2 days ago'],
  ])('%s → %s', (iso, expected) => {
    expect(describeSyncAge(iso, NOW)).toBe(expected);
  });
});

describe('consentLabel', () => {
  it.each([
    [null, null],
    [-1, 'Access expired'],
    [0, 'Access expires today'],
    [1, 'Access expires in 1 day'],
    [30, 'Access expires in 30 days'],
  ])('%s days → %s', (days, expected) => {
    expect(consentLabel(connection({ expiresInDays: days }))).toBe(expected);
  });
});

describe('statusBadge', () => {
  it('shows connected, expiring soon, reconnect needed and sync problem', () => {
    expect(statusBadge(connection())).toEqual({ label: 'Connected', color: 'success' });
    expect(statusBadge(connection({ needsAttention: true, expiresInDays: 3 }))).toEqual({ label: 'Expiring soon', color: 'warning' });
    expect(statusBadge(connection({ status: 'EXPIRED', needsAttention: true }))).toEqual({ label: 'Reconnect needed', color: 'danger' });
    expect(statusBadge(connection({ status: 'ERROR', needsAttention: true }))).toEqual({ label: 'Sync problem', color: 'warning' });
  });
});

describe('accountLabel', () => {
  it('names the bank and masked account', () => {
    expect(accountLabel([connection()], 'c1', 'a1')).toBe('Lloyds Bank · Current Account ••1234');
  });

  it('omits the mask when last4 is unknown', () => {
    expect(accountLabel([connection()], 'c1', 'a2')).toBe('Lloyds Bank · Saver');
  });

  it('falls back when the connection is gone', () => {
    expect(accountLabel([], 'c1', 'a1')).toBe('Bank account');
  });
});
```

`app/lib/__tests__/sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isSyncFinished, shouldPollSync, syncErrorMessage, SYNC_MAX_WAIT_MS } from '../sync';
import { ApiError } from '../apiError';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const pending = { baselineFinishedAt: '2026-09-13T06:00:00.000Z', requestedAt: NOW };

describe('isSyncFinished', () => {
  it('is false while the previous result is still showing', () => {
    expect(isSyncFinished({ state: 'IDLE', finishedAt: '2026-09-13T06:00:00.000Z' }, pending)).toBe(false);
  });

  it('is true once a new result is recorded', () => {
    expect(isSyncFinished({ state: 'IDLE', finishedAt: '2026-09-13T12:00:05.000Z' }, pending)).toBe(true);
  });

  it('is false while running', () => {
    expect(isSyncFinished({ state: 'RUNNING', finishedAt: '2026-09-13T12:00:05.000Z' }, pending)).toBe(false);
  });
});

describe('shouldPollSync', () => {
  it('polls while RUNNING even without a pending request', () => {
    expect(shouldPollSync({ state: 'RUNNING' }, null, NOW)).toBe(true);
  });

  it('polls after a request until the worker records a result', () => {
    expect(shouldPollSync({ state: 'IDLE', finishedAt: pending.baselineFinishedAt }, pending, NOW + 5000)).toBe(true);
    expect(shouldPollSync({ state: 'IDLE', finishedAt: '2026-09-13T12:01:00.000Z' }, pending, NOW + 5000)).toBe(false);
  });

  it('gives up after the maximum wait', () => {
    expect(shouldPollSync({ state: 'IDLE', finishedAt: pending.baselineFinishedAt }, pending, NOW + SYNC_MAX_WAIT_MS + 1)).toBe(false);
  });

  it('does not poll when idle with nothing pending', () => {
    expect(shouldPollSync({ state: 'IDLE' }, null, NOW)).toBe(false);
  });
});

describe('syncErrorMessage', () => {
  it.each([
    [new ApiError(409, 'Conflict'), 'A sync is already running'],
    [new ApiError(429, 'Too Many Requests'), 'Synced recently — try again in a few minutes'],
    [new Error('network'), 'Sync could not start. Please try again.'],
  ])('%s → %s', (error, expected) => {
    expect(syncErrorMessage(error)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/banks.test.ts app/lib/__tests__/sync.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`app/lib/banks.ts`:
```ts
import type { BankConnection } from './types';

const DAY_MS = 86_400_000;
const MAX_HISTORY_DAYS = 730;

export function earliestStartDate(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - MAX_HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
}

export function lastSyncedAt(connection: BankConnection): string | null {
  const times = connection.accounts.map(a => a.lastSyncedAt).filter((t): t is string => Boolean(t));
  if (times.length === 0) return null;
  return times.sort().at(-1) ?? null;
}

export function describeSyncAge(iso: string | null, nowMs: number): string {
  if (!iso) return 'Never synced';
  const minutes = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function consentLabel(connection: BankConnection): string | null {
  const days = connection.expiresInDays;
  if (days === null) return null;
  if (days < 0) return 'Access expired';
  if (days === 0) return 'Access expires today';
  return `Access expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function statusBadge(connection: BankConnection): { label: string; color: 'success' | 'warning' | 'danger' } {
  if (connection.status === 'EXPIRED') return { label: 'Reconnect needed', color: 'danger' };
  if (connection.status === 'ERROR') return { label: 'Sync problem', color: 'warning' };
  if (connection.needsAttention) return { label: 'Expiring soon', color: 'warning' };
  return { label: 'Connected', color: 'success' };
}

export function accountLabel(connections: BankConnection[], connectionId: string, accountUid: string): string {
  const connection = connections.find(c => c.connectionId === connectionId);
  const account = connection?.accounts.find(a => a.accountUid === accountUid);
  if (!connection || !account) return 'Bank account';
  const mask = account.last4 ? ` ••${account.last4}` : '';
  return `${connection.displayName} · ${account.displayName}${mask}`;
}
```

`app/lib/sync.ts`:
```ts
import { ApiError } from './apiError';
import type { PendingSync, SyncStatus } from './types';

export const SYNC_MAX_WAIT_MS = 6 * 60_000;

export function isSyncFinished(status: SyncStatus | undefined, pending: PendingSync): boolean {
  return status?.state === 'IDLE' && (status.finishedAt ?? null) !== pending.baselineFinishedAt;
}

export function shouldPollSync(status: SyncStatus | undefined, pending: PendingSync | null, nowMs: number): boolean {
  if (status?.state === 'RUNNING') return true;
  if (!pending) return false;
  if (nowMs - pending.requestedAt > SYNC_MAX_WAIT_MS) return false;
  return !isSyncFinished(status, pending);
}

export function syncErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return 'A sync is already running';
  if (error instanceof ApiError && error.status === 429) return 'Synced recently — try again in a few minutes';
  return 'Sync could not start. Please try again.';
}
```

- [ ] **Step 4: Add the polling sync-status hook**

`app/lib/queries.ts` — add `import { shouldPollSync } from './sync';`, add `type PendingSync` to the `./types` import, and append:
```ts
const SYNC_POLL_MS = 3000;

export function useSyncStatus(pending: PendingSync | null = null) {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: () => api.getSyncStatus(),
    enabled,
    refetchInterval: query => (shouldPollSync(query.state.data, pending, Date.now()) ? SYNC_POLL_MS : false),
  });
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `yarn vitest run app/lib/__tests__ && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/lib/banks.ts app/lib/sync.ts app/lib/queries.ts app/lib/__tests__/banks.test.ts app/lib/__tests__/sync.test.ts
git commit -m "feat(app): add bank connection and sync status helpers"
```

---

### Task 19: Bank callback route and Auth0 redirect fix

**Files:**
- Create: `app/lib/bankCallback.ts`, `app/components/banks/BankCallback.tsx`, `app/routes/banks.callback.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`
- Test: `app/lib/__tests__/bankCallback.test.ts`, `app/components/banks/__tests__/BankCallback.test.tsx`

**Interfaces:**
- Consumes: `useCompleteBankCallback`, `useClearBankAuth` (Task 17), `ApiError` (Task 17).
- Produces: `BANK_CALLBACK_PATH = '/banks/callback'`; `BankCallbackParams`; `readBankCallback(search)`; `stashBankCallback(storage, params)`; `readStashedBankCallback(storage)`; `clearStashedBankCallback(storage)`; `safeReturnTo(value: unknown): string | null`; `<BankCallback storage? />`; route `/banks/callback`.

- [ ] **Step 1: Write the failing tests**

`app/lib/__tests__/bankCallback.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearStashedBankCallback, readBankCallback, readStashedBankCallback, safeReturnTo, stashBankCallback,
} from '../bankCallback';

describe('readBankCallback', () => {
  it('reads a successful redirect', () => {
    expect(readBankCallback('?code=abc&state=s1')).toEqual({ kind: 'success', code: 'abc', state: 's1' });
  });

  it('reads a bank error with a capped description', () => {
    const result = readBankCallback(`?error=access_denied&error_description=${'x'.repeat(300)}&state=s1`);
    expect(result).toMatchObject({ kind: 'error', state: 's1' });
    expect(result.kind === 'error' && result.message.length).toBe(200);
  });

  it('uses a default message when the bank gives none', () => {
    expect(readBankCallback('?error=access_denied')).toEqual({
      kind: 'error', state: null, message: 'The bank connection was cancelled or failed.',
    });
  });

  it('is invalid without code and state', () => {
    expect(readBankCallback('?code=abc')).toEqual({ kind: 'invalid' });
  });
});

describe('stash', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('reads repeatedly until cleared', () => {
    stashBankCallback(window.sessionStorage, { kind: 'success', code: 'abc', state: 's1' });
    expect(readStashedBankCallback(window.sessionStorage)).toEqual({ kind: 'success', code: 'abc', state: 's1' });
    expect(readStashedBankCallback(window.sessionStorage)).not.toBeNull();
    clearStashedBankCallback(window.sessionStorage);
    expect(readStashedBankCallback(window.sessionStorage)).toBeNull();
  });

  it('ignores corrupted values', () => {
    window.sessionStorage.setItem('budget.bankCallback', '{nope');
    expect(readStashedBankCallback(window.sessionStorage)).toBeNull();
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/banks/callback', '/banks/callback'],
    ['//evil.example', null],
    ['https://evil.example', null],
    ['/\\evil.example', null],
    [42, null],
  ])('%s → %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
```

`app/components/banks/__tests__/BankCallback.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

const auth0 = { isLoading: false, isAuthenticated: true, loginWithRedirect: vi.fn() };
const complete = { mutateAsync: vi.fn() };
const clear = { mutate: vi.fn() };
const navigate = vi.fn();

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));
vi.mock('~/lib/queries', () => ({
  useCompleteBankCallback: () => complete,
  useClearBankAuth: () => clear,
}));
vi.mock('react-router', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

import { BankCallback } from '../BankCallback';

function renderAt(search: string) {
  window.history.pushState({}, '', `/banks/callback${search}`);
  return render(
    <StrictMode>
      <MemoryRouter>
        <MantineProvider>
          <BankCallback storage={window.sessionStorage} />
        </MantineProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe('BankCallback', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    auth0.isLoading = false;
    auth0.isAuthenticated = true;
    auth0.loginWithRedirect.mockReset();
    complete.mutateAsync.mockReset().mockResolvedValue({});
    clear.mutate.mockReset();
    navigate.mockReset();
  });

  it('completes the connection exactly once and returns to banks', async () => {
    renderAt('?code=abc&state=s1');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/banks', { replace: true }));
    expect(complete.mutateAsync).toHaveBeenCalledTimes(1);
    expect(complete.mutateAsync).toHaveBeenCalledWith({ code: 'abc', state: 's1' });
  });

  it('removes the code from the address bar', async () => {
    renderAt('?code=abc&state=s1');
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('stashes the params and logs in when the session has expired', async () => {
    auth0.isAuthenticated = false;
    renderAt('?code=abc&state=s1');
    await waitFor(() => expect(auth0.loginWithRedirect).toHaveBeenCalledWith({ appState: { returnTo: '/banks/callback' } }));
    expect(window.sessionStorage.getItem('budget.bankCallback')).toContain('abc');
    expect(complete.mutateAsync).not.toHaveBeenCalled();
  });

  it('uses stashed params after returning from login', async () => {
    window.sessionStorage.setItem('budget.bankCallback', JSON.stringify({ code: 'stashed', state: 's2' }));
    renderAt('');
    await waitFor(() => expect(complete.mutateAsync).toHaveBeenCalledWith({ code: 'stashed', state: 's2' }));
  });

  it('shows the bank error as text and clears the pending attempt', async () => {
    renderAt('?error=access_denied&error_description=%3Cb%3EUser%20cancelled%3C%2Fb%3E&state=s1');
    expect(await screen.findByText('<b>User cancelled</b>')).toBeInTheDocument();
    expect(clear.mutate).toHaveBeenCalledWith('s1');
  });

  it('explains an expired attempt', async () => {
    const { ApiError } = await import('~/lib/apiError');
    complete.mutateAsync.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    renderAt('?code=abc&state=s1');
    expect(await screen.findByText('This connection attempt has expired. Please start again.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/bankCallback.test.ts app/components/banks`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the helpers**

`app/lib/bankCallback.ts`:
```ts
export const BANK_CALLBACK_PATH = '/banks/callback';

const STORAGE_KEY = 'budget.bankCallback';
const MAX_MESSAGE_LENGTH = 200;
const DEFAULT_ERROR_MESSAGE = 'The bank connection was cancelled or failed.';

export type BankCallbackSuccess = { kind: 'success'; code: string; state: string };
export type BankCallbackParams =
  | BankCallbackSuccess
  | { kind: 'error'; state: string | null; message: string }
  | { kind: 'invalid' };

export function readBankCallback(search: string): BankCallbackParams {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  if (params.get('error')) {
    const message = (params.get('error_description') ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
    return { kind: 'error', state, message: message || DEFAULT_ERROR_MESSAGE };
  }
  const code = params.get('code');
  if (code && state) return { kind: 'success', code, state };
  return { kind: 'invalid' };
}

export function stashBankCallback(storage: Storage, params: BankCallbackSuccess): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ code: params.code, state: params.state }));
}

// Non-destructive: React StrictMode calls state initializers twice.
export function readStashedBankCallback(storage: Storage): BankCallbackSuccess | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'code' in parsed && 'state' in parsed
      && typeof parsed.code === 'string' && typeof parsed.state === 'string') {
      return { kind: 'success', code: parsed.code, state: parsed.state };
    }
    return null;
  } catch {
    // A corrupted stash is ignored; the page falls back to the URL parameters.
    return null;
  }
}

export function clearStashedBankCallback(storage: Storage): void {
  storage.removeItem(STORAGE_KEY);
}

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}
```

- [ ] **Step 4: Implement the component and route**

`app/components/banks/BankCallback.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { useAuth0 } from '@auth0/auth0-react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '~/lib/apiError';
import {
  BANK_CALLBACK_PATH, clearStashedBankCallback, readBankCallback, readStashedBankCallback, stashBankCallback,
  type BankCallbackParams,
} from '~/lib/bankCallback';
import { useClearBankAuth, useCompleteBankCallback } from '~/lib/queries';

const EXPIRED_MESSAGE = 'This connection attempt has expired. Please start again.';
const FAILED_MESSAGE = 'We could not finish connecting your bank. Please try again.';

export function BankCallback({ storage = window.sessionStorage }: { storage?: Storage }) {
  const { isLoading, isAuthenticated, loginWithRedirect } = useAuth0();
  const navigate = useNavigate();
  const complete = useCompleteBankCallback();
  const clear = useClearBankAuth();
  const [params] = useState<BankCallbackParams>(() => readStashedBankCallback(storage) ?? readBankCallback(window.location.search));
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Keep the one-time code out of browser history and referrers.
    if (window.location.search) window.history.replaceState(null, '', BANK_CALLBACK_PATH);
  }, []);

  useEffect(() => {
    if (isLoading || started.current || params.kind === 'invalid') return;
    started.current = true;
    clearStashedBankCallback(storage);

    if (params.kind === 'error') {
      if (params.state) clear.mutate(params.state);
      return;
    }

    if (!isAuthenticated) {
      stashBankCallback(storage, params);
      void loginWithRedirect({ appState: { returnTo: BANK_CALLBACK_PATH } });
      return;
    }

    complete.mutateAsync({ code: params.code, state: params.state })
      .then(() => navigate('/banks', { replace: true }))
      .catch((error: unknown) => {
        setFailure(error instanceof ApiError && error.status === 404 ? EXPIRED_MESSAGE : FAILED_MESSAGE);
      });
  }, [isLoading, isAuthenticated, params, storage, loginWithRedirect, clear, complete, navigate]);

  const message = params.kind === 'error' ? params.message : failure;

  if (params.kind === 'invalid') {
    return <CallbackAlert title="Missing connection details" message="Start the bank connection again from the Banks page." />;
  }
  if (message) return <CallbackAlert title="Bank not connected" message={message} />;

  return (
    <Group justify="center" mt="xl">
      <Loader size="sm" />
      <Text>Finishing your bank connection…</Text>
    </Group>
  );
}

function CallbackAlert({ title, message }: { title: string; message: string }) {
  return (
    <Stack maw={480} mx="auto" mt="xl">
      <Alert color="danger" title={title}>
        <Text size="sm">{message}</Text>
      </Alert>
      <Button component={Link} to="/banks" variant="light">Back to banks</Button>
    </Stack>
  );
}
```

`app/routes/banks.callback.tsx`:
```tsx
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { BankCallback } from '~/components/banks/BankCallback';

export default function BanksCallbackRoute() {
  return (
    <DefaultLayout>
      <BankCallback />
    </DefaultLayout>
  );
}
```

- [ ] **Step 5: Stop Auth0 from consuming the bank redirect**

`app/components/layout/DefaultLayout.tsx` — add `import { BANK_CALLBACK_PATH, safeReturnTo } from '~/lib/bankCallback';` and add these props to `<Auth0Provider>` (keep all existing props):
```tsx
      // The bank redirect also uses ?code=&state=; without this Auth0 treats it as its own login callback.
      skipRedirectCallback={window.location.pathname === BANK_CALLBACK_PATH}
      onRedirectCallback={appState => {
        const returnTo = safeReturnTo(appState?.returnTo);
        if (returnTo) {
          window.location.replace(returnTo);
          return;
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      }}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `yarn vitest run app/lib/__tests__/bankCallback.test.ts app/components/banks && yarn typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/lib/bankCallback.ts app/components/banks/BankCallback.tsx app/routes/banks.callback.tsx app/components/layout/DefaultLayout.tsx app/lib/__tests__/bankCallback.test.ts app/components/banks/__tests__/BankCallback.test.tsx
git commit -m "feat(app): handle bank redirect callback without Auth0 intercepting it (addresses IO-08)"
```

---

### Task 20: Banks page

**Files:**
- Create: `app/components/banks/ConnectBankModal.tsx`, `app/components/banks/ConnectionCard.tsx`, `app/components/banks/SyncNowButton.tsx`, `app/routes/banks.tsx`
- Test: `app/components/banks/__tests__/ConnectBankModal.test.tsx`, `app/components/banks/__tests__/ConnectionCard.test.tsx`

**Interfaces:**
- Consumes: hooks from Tasks 17–18; `earliestStartDate`, `describeSyncAge`, `lastSyncedAt`, `consentLabel`, `statusBadge` (Task 18); `isSyncFinished`, `syncErrorMessage` (Task 18); `todayIso` (existing `app/lib/months.ts`).
- Produces: `<ConnectBankModal opened onClose reconnect? redirect? />`, `<ConnectionCard connection nowMs onReconnect onDisconnect />`, `<SyncNowButton />`, route `/banks`.

- [ ] **Step 1: Write the failing tests**

`app/components/banks/__tests__/ConnectBankModal.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

const connect = { mutateAsync: vi.fn(), isPending: false };

vi.mock('~/lib/queries', () => ({
  useAspsps: () => ({ data: [{ name: 'Lloyds Bank', country: 'GB', logo: '', maximumConsentValiditySeconds: 1 }], isLoading: false }),
  useConnectBank: () => connect,
}));

import { ConnectBankModal } from '../ConnectBankModal';
import { todayIso } from '~/lib/months';

function renderModal(props: Partial<Parameters<typeof ConnectBankModal>[0]> = {}) {
  const redirect = vi.fn();
  render(
    <MantineProvider>
      <ConnectBankModal opened onClose={() => {}} redirect={redirect} {...props} />
    </MantineProvider>,
  );
  return { redirect };
}

describe('ConnectBankModal', () => {
  beforeEach(() => { connect.mutateAsync.mockReset().mockResolvedValue('https://tilisy.enablebanking.com/x'); });

  it('requires a bank', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue to bank/i }));
    expect(await screen.findByText('Choose your bank')).toBeInTheDocument();
    expect(connect.mutateAsync).not.toHaveBeenCalled();
  });

  it('starts the connection from today by default and redirects to the bank', async () => {
    const user = userEvent.setup();
    const { redirect } = renderModal();
    await user.click(screen.getByRole('textbox', { name: /bank/i }));
    await user.click(await screen.findByRole('option', { name: 'Lloyds Bank' }));
    await user.click(screen.getByRole('button', { name: /continue to bank/i }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://tilisy.enablebanking.com/x'));
    expect(connect.mutateAsync).toHaveBeenCalledWith({ aspspName: 'Lloyds Bank', country: 'GB', startDate: todayIso() });
  });

  it('reconnects without asking for a bank or start date', async () => {
    const user = userEvent.setup();
    const reconnect = { connectionId: 'c1', displayName: 'Lloyds Bank' } as Parameters<typeof ConnectBankModal>[0]['reconnect'];
    renderModal({ reconnect });
    expect(screen.queryByRole('textbox', { name: /bank/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue to bank/i }));
    await waitFor(() => expect(connect.mutateAsync).toHaveBeenCalledWith({
      aspspName: 'Lloyds Bank', country: 'GB', startDate: todayIso(), connectionId: 'c1',
    }));
  });

  it('shows an error when the connection cannot start', async () => {
    connect.mutateAsync.mockRejectedValueOnce(new Error('502'));
    const user = userEvent.setup();
    const reconnect = { connectionId: 'c1', displayName: 'Lloyds Bank' } as Parameters<typeof ConnectBankModal>[0]['reconnect'];
    renderModal({ reconnect });
    await user.click(screen.getByRole('button', { name: /continue to bank/i }));
    expect(await screen.findByText('Could not start the bank connection. Please try again.')).toBeInTheDocument();
  });
});
```

`app/components/banks/__tests__/ConnectionCard.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ConnectionCard } from '../ConnectionCard';
import type { BankConnection } from '~/lib/types';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

const connection: BankConnection = {
  connectionId: 'c1', provider: 'enable-banking', displayName: 'Lloyds Bank', status: 'EXPIRED',
  consecutiveFailures: 0, createdAt: 't', updatedAt: 't', expiresInDays: -1, needsAttention: true,
  accounts: [{ accountUid: 'a1', dedupeId: 'a1', displayName: 'Current Account', last4: '1234', currency: 'GBP', startDate: '2026-09-01', lastSyncedAt: '2026-09-13T09:00:00.000Z' }],
};

describe('ConnectionCard', () => {
  it('shows bank, accounts, status, sync age and consent', () => {
    render(<MantineProvider><ConnectionCard connection={connection} nowMs={NOW} onReconnect={() => {}} onDisconnect={() => {}} /></MantineProvider>);
    expect(screen.getByText('Lloyds Bank')).toBeInTheDocument();
    expect(screen.getByText('Current Account ••1234')).toBeInTheDocument();
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.getByText('Synced 3h ago')).toBeInTheDocument();
    expect(screen.getByText('Access expired')).toBeInTheDocument();
  });

  it('calls the reconnect and disconnect handlers', async () => {
    const onReconnect = vi.fn();
    const onDisconnect = vi.fn();
    const user = userEvent.setup();
    render(<MantineProvider><ConnectionCard connection={connection} nowMs={NOW} onReconnect={onReconnect} onDisconnect={onDisconnect} /></MantineProvider>);
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/banks/__tests__/ConnectBankModal.test.tsx app/components/banks/__tests__/ConnectionCard.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

`app/components/banks/ConnectBankModal.tsx`:
```tsx
import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { earliestStartDate } from '~/lib/banks';
import { todayIso } from '~/lib/months';
import { useAspsps, useConnectBank } from '~/lib/queries';
import type { BankConnection } from '~/lib/types';

export interface ConnectBankModalProps {
  opened: boolean;
  onClose: () => void;
  reconnect?: Pick<BankConnection, 'connectionId' | 'displayName'>;
  redirect?: (url: string) => void;
}

const goTo = (url: string) => window.location.assign(url);

export function ConnectBankModal({ opened, onClose, reconnect, redirect = goTo }: ConnectBankModalProps) {
  const today = todayIso();
  const banks = useAspsps(opened && !reconnect);
  const connect = useConnectBank();
  const [aspspName, setAspspName] = useState<string | null>(reconnect?.displayName ?? null);
  const [startDate, setStartDate] = useState<string>(today);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!aspspName) {
      setError('Choose your bank');
      return;
    }
    setError(null);
    try {
      const url = await connect.mutateAsync({
        aspspName,
        country: 'GB',
        startDate,
        ...(reconnect ? { connectionId: reconnect.connectionId } : {}),
      });
      redirect(url);
    } catch (cause) {
      console.error('Failed to start bank connection', cause);
      setError('Could not start the bank connection. Please try again.');
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={reconnect ? `Reconnect ${reconnect.displayName}` : 'Connect a bank'}>
      <Stack>
        {reconnect ? (
          <Text size="sm">You will be sent to your bank to approve access again. Your transaction history is kept.</Text>
        ) : (
          <>
            <Select
              label="Bank"
              placeholder={banks.isLoading ? 'Loading banks…' : 'Search for your bank'}
              searchable
              nothingFoundMessage="No matching bank"
              data={(banks.data ?? []).map(bank => bank.name)}
              value={aspspName}
              onChange={setAspspName}
            />
            <DateInput
              label="Import transactions from"
              description="Pick the day after your manually entered transactions end"
              valueFormat="DD/MM/YYYY"
              value={startDate}
              onChange={value => setStartDate(value ?? today)}
              minDate={earliestStartDate(today)}
              maxDate={today}
            />
          </>
        )}
        {error && <Text c="danger" size="sm">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={connect.isPending}>Continue to bank</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

`app/components/banks/ConnectionCard.tsx`:
```tsx
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { consentLabel, describeSyncAge, lastSyncedAt, statusBadge } from '~/lib/banks';
import type { BankConnection } from '~/lib/types';

export function ConnectionCard({ connection, nowMs, onReconnect, onDisconnect }: {
  connection: BankConnection;
  nowMs: number;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const badge = statusBadge(connection);
  const consent = consentLabel(connection);

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap">
          <Text fw={600}>{connection.displayName}</Text>
          <Badge color={badge.color} variant="light">{badge.label}</Badge>
        </Group>
        {connection.accounts.map(account => (
          <Text key={account.accountUid} size="sm">
            {account.displayName}{account.last4 ? ` ••${account.last4}` : ''}
          </Text>
        ))}
        <Group gap="md" wrap="wrap">
          <Text size="xs" c="dimmed">{describeSyncAge(lastSyncedAt(connection), nowMs)}</Text>
          {consent && <Text size="xs" c={connection.needsAttention ? 'warning' : 'dimmed'}>{consent}</Text>}
        </Group>
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="light" onClick={onReconnect}>Reconnect</Button>
          <Button size="xs" variant="subtle" color="danger" onClick={onDisconnect}>Disconnect</Button>
        </Group>
      </Stack>
    </Card>
  );
}
```

`app/components/banks/SyncNowButton.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useSyncStatus, useTriggerSync } from '~/lib/queries';
import { isSyncFinished, SYNC_MAX_WAIT_MS, syncErrorMessage } from '~/lib/sync';
import type { PendingSync } from '~/lib/types';

export function SyncNowButton() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingSync | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = useSyncStatus(pending);
  const trigger = useTriggerSync();

  useEffect(() => {
    if (!pending || !isSyncFinished(status.data, pending)) return;
    setPending(null);
    qc.invalidateQueries({ queryKey: queryKeys.inbox });
    qc.invalidateQueries({ queryKey: queryKeys.inboxCount });
    qc.invalidateQueries({ queryKey: queryKeys.connections });
  }, [pending, status.data, qc]);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), SYNC_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  function start() {
    setMessage(null);
    const baselineFinishedAt = status.data?.finishedAt ?? null;
    trigger.mutate(undefined, {
      onSuccess: () => setPending({ baselineFinishedAt, requestedAt: Date.now() }),
      onError: error => setMessage(syncErrorMessage(error)),
    });
  }

  const running = status.data?.state === 'RUNNING' || pending !== null || trigger.isPending;

  return (
    <Stack gap={4} align="flex-end">
      <Button variant="light" onClick={start} loading={running}>Sync now</Button>
      {message && <Text size="xs" c="dimmed">{message}</Text>}
    </Stack>
  );
}
```

`app/routes/banks.tsx`:
```tsx
import { useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { ConnectBankModal } from '~/components/banks/ConnectBankModal';
import { ConnectionCard } from '~/components/banks/ConnectionCard';
import { SyncNowButton } from '~/components/banks/SyncNowButton';
import { useConnections, useDisconnectBank } from '~/lib/queries';
import type { BankConnection } from '~/lib/types';

function BanksContent() {
  const connections = useConnections();
  const disconnect = useDisconnectBank();
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState<BankConnection | null>(null);
  const [disconnecting, setDisconnecting] = useState<BankConnection | null>(null);
  const nowMs = Date.now();

  function confirmDisconnect() {
    if (!disconnecting) return;
    disconnect.mutate(disconnecting.connectionId, { onSettled: () => setDisconnecting(null) });
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Title order={2}>Banks</Title>
        <Group gap="xs" align="flex-start">
          <SyncNowButton />
          <Button onClick={() => setConnectOpen(true)}>Connect a bank</Button>
        </Group>
      </Group>

      {connections.isLoading && <Loader size="sm" />}
      {connections.isError && <Alert color="danger">Could not load your bank connections.</Alert>}
      {connections.data?.length === 0 && (
        <Text c="dimmed">No banks connected yet. Connect a bank to import transactions into your inbox for review.</Text>
      )}
      {connections.data?.map(connection => (
        <ConnectionCard
          key={connection.connectionId}
          connection={connection}
          nowMs={nowMs}
          onReconnect={() => setReconnecting(connection)}
          onDisconnect={() => setDisconnecting(connection)}
        />
      ))}

      <ConnectBankModal opened={connectOpen} onClose={() => setConnectOpen(false)} />
      {reconnecting && <ConnectBankModal opened reconnect={reconnecting} onClose={() => setReconnecting(null)} />}

      <Modal opened={disconnecting !== null} onClose={() => setDisconnecting(null)} title="Disconnect bank">
        <Stack>
          <Text size="sm">
            Disconnect {disconnecting?.displayName}? Unreviewed inbox items from this bank are removed.
            Transactions you have already confirmed stay in your budget.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDisconnecting(null)}>Cancel</Button>
            <Button color="danger" loading={disconnect.isPending} onClick={confirmDisconnect}>Disconnect</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default function Banks() {
  return (
    <DefaultLayout>
      <BanksContent />
    </DefaultLayout>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `yarn vitest run app/components/banks && yarn typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/banks app/routes/banks.tsx
git commit -m "feat(app): add banks page with connect, reconnect, disconnect and sync now"
```

---

### Task 21: Inbox page

**Files:**
- Create: `app/lib/inbox.ts`, `app/components/inbox/InboxRow.tsx`, `app/routes/inbox.tsx`
- Test: `app/lib/__tests__/inbox.test.ts`, `app/components/inbox/__tests__/InboxRow.test.tsx`

**Interfaces:**
- Consumes: `useInbox`, `useCategories`, `useConnections`, `useConfirmInboxItem`, `useIgnoreInboxItem`, `useSyncStatus` (Tasks 17–18); `TYPE_OPTIONS`, `categoryTypeFor` (Task 17); `accountLabel`, `describeSyncAge` (Task 18); `formatPence` (existing).
- Produces: `groupByBookingDate(items: InboxItem[]): { date: string; items: InboxItem[] }[]`; `<InboxRow item accountLabel categories onConfirm onIgnore busy? />`; route `/inbox`.

- [ ] **Step 1: Write the failing tests**

`app/lib/__tests__/inbox.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { groupByBookingDate } from '../inbox';
import type { InboxItem } from '../types';

const item = (txnKey: string, bookingDate: string): InboxItem => ({
  txnKey, bookingDate, amount: 1, direction: 'OUT', suggestedType: 'EXPENSE', description: 'x',
  connectionId: 'c', accountUid: 'a', importedAt: 't',
});

describe('groupByBookingDate', () => {
  it('groups consecutive items by date preserving API order', () => {
    const groups = groupByBookingDate([item('1', '2026-09-12'), item('2', '2026-09-12'), item('3', '2026-09-10')]);
    expect(groups.map(g => [g.date, g.items.map(i => i.txnKey)])).toEqual([
      ['2026-09-12', ['1', '2']],
      ['2026-09-10', ['3']],
    ]);
  });

  it('returns no groups for an empty inbox', () => {
    expect(groupByBookingDate([])).toEqual([]);
  });
});
```

`app/components/inbox/__tests__/InboxRow.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { InboxRow } from '../InboxRow';
import type { Category, InboxItem } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-isa', name: 'ISA', type: 'INVESTMENT', icon: 'x', isDefault: true, createdAt: '' },
];

const item: InboxItem = {
  txnKey: 'k1', amount: 1234, direction: 'OUT', suggestedType: 'EXPENSE', description: '<script>TESCO</script>',
  bookingDate: '2026-09-10', connectionId: 'c1', accountUid: 'a1', importedAt: 't',
};

function renderRow(overrides: Partial<Parameters<typeof InboxRow>[0]> = {}) {
  const onConfirm = vi.fn();
  const onIgnore = vi.fn();
  render(
    <MantineProvider>
      <InboxRow item={item} accountLabel="Lloyds Bank · Current Account ••1234" categories={categories}
        onConfirm={onConfirm} onIgnore={onIgnore} {...overrides} />
    </MantineProvider>,
  );
  return { onConfirm, onIgnore };
}

describe('InboxRow', () => {
  it('renders the bank description as text with a signed amount', () => {
    renderRow();
    expect(screen.getByText('<script>TESCO</script>')).toBeInTheDocument();
    expect(screen.getByText('−£12.34')).toBeInTheDocument();
  });

  it('disables confirm until a category is chosen', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('only offers categories matching the selected type', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('textbox', { name: 'Category' }));
    expect(await screen.findByRole('option', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();
  });

  it('confirms with the chosen type and category', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderRow();
    await user.click(screen.getByRole('radio', { name: 'Invest in' }));
    await user.click(screen.getByRole('textbox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'ISA' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith({ type: 'INVESTMENT_IN', categoryId: 'cat-isa' });
  });

  it('clears an incompatible category when the type changes', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('textbox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Groceries' }));
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('pre-fills from a rule suggestion', () => {
    renderRow({ item: { ...item, suggestion: { type: 'EXPENSE', categoryId: 'cat-groceries', ruleId: 'r1' } } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('ignores', async () => {
    const user = userEvent.setup();
    const { onIgnore } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(onIgnore).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/inbox.test.ts app/components/inbox`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`app/lib/inbox.ts`:
```ts
import type { InboxItem } from './types';

export function groupByBookingDate(items: InboxItem[]): { date: string; items: InboxItem[] }[] {
  const groups: { date: string; items: InboxItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.bookingDate) last.items.push(item);
    else groups.push({ date: item.bookingDate, items: [item] });
  }
  return groups;
}
```

`app/components/inbox/InboxRow.tsx`:
```tsx
import { useState } from 'react';
import { Button, Card, Group, SegmentedControl, Select, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import { categoryTypeFor, TYPE_OPTIONS } from '~/lib/transactionTypes';
import type { Category, InboxItem, TransactionType } from '~/lib/types';

export interface InboxRowProps {
  item: InboxItem;
  accountLabel: string;
  categories: Category[];
  onConfirm: (input: { type: TransactionType; categoryId: string }) => void;
  onIgnore: () => void;
  busy?: boolean;
}

function fitsType(categories: Category[], categoryId: string, type: TransactionType): boolean {
  return categories.some(c => c.categoryId === categoryId && c.type === categoryTypeFor(type));
}

export function InboxRow({ item, accountLabel, categories, onConfirm, onIgnore, busy = false }: InboxRowProps) {
  const [type, setType] = useState<TransactionType>(item.suggestion?.type ?? item.suggestedType);
  const [categoryId, setCategoryId] = useState<string | null>(item.suggestion?.categoryId ?? null);

  const options = categories
    .filter(c => c.type === categoryTypeFor(type))
    .map(c => ({ value: c.categoryId, label: c.name }));

  function changeType(value: string) {
    const next = value as TransactionType;
    setType(next);
    if (categoryId && !fitsType(categories, categoryId, next)) setCategoryId(null);
  }

  function confirm() {
    if (!categoryId) return;
    onConfirm({ type, categoryId });
  }

  const sign = item.direction === 'OUT' ? '−' : '+';

  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Text fw={500} truncate>{item.description}</Text>
            <Text size="xs" c="dimmed">{accountLabel}</Text>
          </div>
          <Text fw={600} c={item.direction === 'IN' ? 'success' : undefined}>{sign}{formatPence(item.amount)}</Text>
        </Group>
        <SegmentedControl size="xs" fullWidth value={type} onChange={changeType} data={TYPE_OPTIONS} />
        <Group align="flex-end" wrap="wrap" gap="xs">
          <Select
            label="Category"
            placeholder="Choose category"
            data={options}
            value={categoryId}
            onChange={setCategoryId}
            style={{ flex: 1, minWidth: 160 }}
          />
          <Group gap="xs">
            <Button variant="default" onClick={onIgnore} disabled={busy}>Ignore</Button>
            <Button onClick={confirm} disabled={!categoryId || busy}>Confirm</Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
```

`app/routes/inbox.tsx`:
```tsx
import { Alert, Anchor, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { InboxRow } from '~/components/inbox/InboxRow';
import { accountLabel, describeSyncAge } from '~/lib/banks';
import { groupByBookingDate } from '~/lib/inbox';
import {
  useCategories, useConfirmInboxItem, useConnections, useIgnoreInboxItem, useInbox, useSyncStatus,
} from '~/lib/queries';

function InboxContent() {
  const inbox = useInbox();
  const categories = useCategories();
  const connections = useConnections();
  const status = useSyncStatus();
  const confirm = useConfirmInboxItem();
  const ignore = useIgnoreInboxItem();

  const items = inbox.data?.pages.flatMap(page => page.items) ?? [];
  const groups = groupByBookingDate(items);

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Inbox</Title>
        <Anchor component={Link} to="/banks" size="sm">Manage banks</Anchor>
      </Group>

      {(confirm.isError || ignore.isError) && (
        <Alert color="danger">That change could not be saved. The item is back in your inbox.</Alert>
      )}
      {inbox.isLoading && <Loader size="sm" />}
      {inbox.isError && <Alert color="danger">Could not load your inbox.</Alert>}

      {inbox.isSuccess && items.length === 0 && (
        <Stack gap={4} align="center" py="xl">
          <Text fw={600}>All caught up</Text>
          <Text size="sm" c="dimmed">{describeSyncAge(status.data?.finishedAt ?? null, Date.now())}</Text>
        </Stack>
      )}

      {groups.map(group => (
        <Stack key={group.date} gap="xs">
          <Text size="sm" fw={600} c="dimmed">{group.date}</Text>
          {group.items.map(item => (
            <InboxRow
              key={item.txnKey}
              item={item}
              accountLabel={accountLabel(connections.data ?? [], item.connectionId, item.accountUid)}
              categories={categories.data ?? []}
              onConfirm={input => confirm.mutate({ item, input })}
              onIgnore={() => ignore.mutate(item)}
            />
          ))}
        </Stack>
      ))}

      {inbox.hasNextPage && (
        <Button variant="light" onClick={() => inbox.fetchNextPage()} loading={inbox.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </Stack>
  );
}

export default function Inbox() {
  return (
    <DefaultLayout>
      <InboxContent />
    </DefaultLayout>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `yarn vitest run app/lib/__tests__/inbox.test.ts app/components/inbox && yarn typecheck`
Expected: PASS. If Mantine's `SegmentedControl` options are not exposed as `radio` roles in this Mantine version, query them with `screen.getByLabelText('Invest in')` instead.

- [ ] **Step 5: Commit**

```bash
git add app/lib/inbox.ts app/components/inbox app/routes/inbox.tsx app/lib/__tests__/inbox.test.ts
git commit -m "feat(app): add review inbox with confirm and ignore"
```

---

### Task 22: Navigation, inbox badge and attention banner

**Files:**
- Create: `app/components/banks/AttentionBanner.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`
- Test: `app/components/banks/__tests__/AttentionBanner.test.tsx`

**Interfaces:**
- Consumes: `useConnections`, `useInboxCount` (Task 17).
- Produces: `<AttentionBanner />`; nav items `Inbox` (with badge, all layouts) and `Banks` (sidebar only).

- [ ] **Step 1: Write the failing test**

`app/components/banks/__tests__/AttentionBanner.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

const state = { data: [] as { needsAttention: boolean }[] };
vi.mock('~/lib/queries', () => ({ useConnections: () => state }));

import { AttentionBanner } from '../AttentionBanner';

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><MantineProvider><AttentionBanner /></MantineProvider></MemoryRouter>);
}

describe('AttentionBanner', () => {
  it('shows a link to banks when a connection needs attention', () => {
    state.data = [{ needsAttention: false }, { needsAttention: true }];
    renderAt('/');
    expect(screen.getByRole('link', { name: /review bank connections/i })).toHaveAttribute('href', '/banks');
  });

  it('is hidden when everything is healthy', () => {
    state.data = [{ needsAttention: false }];
    renderAt('/');
    expect(screen.queryByRole('link', { name: /review bank connections/i })).not.toBeInTheDocument();
  });

  it('is hidden on the banks page itself', () => {
    state.data = [{ needsAttention: true }];
    renderAt('/banks');
    expect(screen.queryByRole('link', { name: /review bank connections/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run app/components/banks/__tests__/AttentionBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner**

`app/components/banks/AttentionBanner.tsx`:
```tsx
import { Alert, Anchor } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { useConnections } from '~/lib/queries';

export function AttentionBanner() {
  const { pathname } = useLocation();
  const connections = useConnections();
  const needsAttention = (connections.data ?? []).some(connection => connection.needsAttention);

  if (!needsAttention || pathname.startsWith('/banks')) return null;

  return (
    <Alert color="warning" mb="md">
      A bank connection needs attention.{' '}
      <Anchor component={Link} to="/banks">Review bank connections</Anchor>
    </Alert>
  );
}
```

- [ ] **Step 4: Update navigation**

`app/components/layout/DefaultLayout.tsx`:
- Extend the icon import with `IconBuildingBank, IconInbox`; import `Badge` from `@mantine/core`; import `{ useInboxCount }` from `~/lib/queries` and `{ AttentionBanner }` from `../banks/AttentionBanner`.
- Replace `NAV_ITEMS` with:
```tsx
const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome, sidebarOnly: false },
  { to: '/inbox', label: 'Inbox', Icon: IconInbox, sidebarOnly: false },
  { to: '/transactions', label: 'Transactions', Icon: IconList, sidebarOnly: false },
  { to: '/targets', label: 'Targets', Icon: IconTarget, sidebarOnly: false },
  { to: '/categories', label: 'Categories', Icon: IconTag, sidebarOnly: false },
  { to: '/banks', label: 'Banks', Icon: IconBuildingBank, sidebarOnly: true },
];

function InboxBadge({ to }: { to: string }) {
  const count = useInboxCount();
  if (to !== '/inbox' || !count.data) return null;
  return <Badge size="xs" circle>{count.data > 99 ? '99+' : count.data}</Badge>;
}
```
- In `BottomTabs`, iterate `NAV_ITEMS.filter(item => !item.sidebarOnly)` and render `<InboxBadge to={to} />` next to the label `<Text>`.
- In `SidebarNav`, add `rightSection={<InboxBadge to={to} />}` to each `NavLink`.
- In `AppShell.Main`, render `<AttentionBanner />` immediately before `{children}`.

With five bottom tabs, check the mobile layout at 360px width in the browser during Task 23; labels use `size="xs"` already.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `yarn vitest run --project app && yarn typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/components/banks/AttentionBanner.tsx app/components/banks/__tests__/AttentionBanner.test.tsx app/components/layout/DefaultLayout.tsx
git commit -m "feat(app): add inbox and banks navigation with attention banner"
```

---

## Phase I — Verification

### Task 23: Spec update, end-to-end verification and security review

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-bank-sync-1-foundation-design.md`

- [ ] **Step 1: Update the spec with this plan's deviations**

Edit the spec so it matches what was built:
1. **Connection Flow / API:** the worker (not the API) generates `state` and reads/writes `BANKAUTH#` and connections; the API validates HTTP input and forwards.
2. **Data Model:** add `dedupeId` to the connected account fields; dedupe key uses `dedupeId` instead of `accountUid`.
3. **Security & Infrastructure:** log groups are `/${app_name}/lambda/{static,api,worker}` via `logging_config`; `app_base_url` defaults to the API Gateway invoke URL; worker IAM includes `dynamodb:BatchWriteItem`.
4. **Sync Algorithm:** `consecutiveFailures` increments at most once per connection per run.
5. **Testing:** replace "the repo has no frontend test setup" with the frontend tests added in Tasks 17–22.
6. Any differences found in Task 6 Step 1 (PSU headers) or Task 7 Step 1 (response shapes, auth URL host).

Commit:
```bash
git add docs/superpowers/specs/2026-09-13-bank-sync-1-foundation-design.md
git commit -m "docs: align bank sync spec 1 with implementation"
```

- [ ] **Step 2: Full automated verification**

Run: `yarn test && yarn typecheck && yarn build && (cd infra && tofu init -backend=false && tofu validate)`
Expected: all pass. Paste the summary lines into the PR description.

- [ ] **Step 3: Sandbox end-to-end (after deploy with the sandbox secret)**

Record pass/fail for each in the PR:
- [ ] `/banks` → Connect a bank → Enable Banking mock ASPSP → approve → lands on `/banks` with "Syncing…" then a connection card
- [ ] Cancel at the bank → callback shows the bank's message as plain text; `BANKAUTH#` item deleted
- [ ] Log out of Auth0 in another tab before approving at the bank → callback logs in and still completes
- [ ] Inbox shows imported items; confirm one with a category → appears in Transactions for its month; ignore one → gone
- [ ] Sync now twice quickly → second shows "Synced recently — try again in a few minutes"
- [ ] Re-sync → no duplicate inbox items
- [ ] Mobile width (360px): inbox rows wrap, five bottom tabs fit, banner readable
- [ ] Set a connection's `status` to `EXPIRED` in DynamoDB → banner appears; Reconnect works and keeps `startDate`
- [ ] Disconnect → pending items for that bank removed, confirmed transactions remain

- [ ] **Step 4: Infrastructure review**

In the CI `tofu plan` / AWS console confirm:
- [ ] Static Lambda role has only `AWSLambdaBasicExecutionRole`
- [ ] API role can invoke only the worker ARN; worker has no API Gateway integration
- [ ] Worker role can read only the Enable Banking secret
- [ ] `tofu state pull | grep -c privateKeyPem` returns `0`
- [ ] Worker async retries = 0; schedule `rate(6 hours)`; log groups retain 14 days
- [ ] CloudWatch logs for a full connect + sync contain no codes, states, session ids, amounts or descriptions

- [ ] **Step 5: Security review and PR**

Run the SECURITY.md checklist and the `security-review` skill on the branch diff; fix any findings with tests. Open the PR referencing AUTH-04, IO-01, IO-07, IO-08, SEC-02, SEC-04, INFRA-01, INFRA-02, INFRA-03, INFRA-04, LOG-04, LOG-05, and note the retained AUTH-03 deviation.

- [ ] **Step 6: Real Lloyds (milestone M3)**

Swap the secret to the production restricted-mode application, register the production redirect URL, connect Lloyds with a start date the day after your last manual entry, and verify: first sync imports only transactions from that date; a re-sync six hours later adds new items without duplicates; confirmed items appear in budgets and targets.

