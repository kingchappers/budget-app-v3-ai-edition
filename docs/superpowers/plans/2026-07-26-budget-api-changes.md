# Budget API Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the budget API so the frontend can edit transactions, record investment contributions with accurate type names, log transactions without a description, and reassign a category's transactions before deleting it.

**Architecture:** Four handler-level changes in `src/api/`, plus one small refactor extracting duplicated response helpers. No infrastructure changes: API Gateway already routes GET, POST, PUT and DELETE for `/api/{proxy+}` to the API Lambda, and the Lambda's IAM policy already grants every DynamoDB action these handlers use.

**Tech Stack:** TypeScript, AWS Lambda, DynamoDB (`@aws-sdk/lib-dynamodb`), Vitest.

## Global Constraints

- Node 24 (`.nvmrc`); run `nvm use` before any command.
- All amounts are positive integers of pence. Never introduce floats.
- Every handler returns `SECURITY_HEADERS` on every response, including errors.
- Handler signature is always `(event, userId, params) => Promise<ApiResponse>`.
- Tests mock `../db` and `@aws-sdk/lib-dynamodb`; never hit real AWS.
- Commit after each task. Conventional commits, imperative mood, ≤72 char subject.
- Reference security control IDs in commits where relevant (IO-01 for input validation).

---

### Task 1: Extract shared response helpers

`ok` and `err` are defined privately and identically in `categories.ts`, `transactions.ts` and `targets.ts`. This task removes the duplication before two more handlers are added. Pure refactor — no behaviour changes, so the existing suite is the test.

**Files:**
- Create: `src/api/http.ts`
- Modify: `src/api/categories.ts:8-14`, `src/api/transactions.ts:7-13`, `src/api/targets.ts:7-13`

**Interfaces:**
- Consumes: `SECURITY_HEADERS` from `./constants`, `ApiResponse` from `./types`
- Produces: `ok(body: object): ApiResponse` (status 200), `err(status: number, message: string): ApiResponse`

- [ ] **Step 1: Run the existing suite to establish a green baseline**

```bash
nvm use && yarn test
```

Expected: 31 tests pass across 4 files.

- [ ] **Step 2: Create the shared helper module**

Create `src/api/http.ts`:

```typescript
import { SECURITY_HEADERS } from './constants';
import type { ApiResponse } from './types';

export function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

export function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}
```

- [ ] **Step 3: Replace the local copies with imports**

In each of `src/api/categories.ts`, `src/api/transactions.ts` and `src/api/targets.ts`, delete the local `function ok(...)` and `function err(...)` definitions and add to the import block:

```typescript
import { ok, err } from './http';
```

Leave every call site unchanged — the signatures are identical.

- [ ] **Step 4: Verify nothing changed behaviourally**

```bash
yarn test && yarn typecheck
```

Expected: same 31 tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/api/http.ts src/api/categories.ts src/api/transactions.ts src/api/targets.ts
git commit -m "refactor: extract shared ok/err response helpers"
```

---

### Task 2: Rename investment transaction types to IN/OUT

`INVESTMENT_GAIN` and `INVESTMENT_LOSS` are named for market movement but are used for contributions and withdrawals. Rename to `INVESTMENT_IN` and `INVESTMENT_OUT`.

**Files:**
- Modify: `src/api/types.ts`, `src/api/constants.ts`, `src/api/transactions.ts`
- Test: `src/api/__tests__/transactions.test.ts`

**Interfaces:**
- Produces: `TransactionType = 'EXPENSE' | 'INCOME' | 'INVESTMENT_IN' | 'INVESTMENT_OUT'`

- [ ] **Step 1: Write the failing test**

Add to `src/api/__tests__/transactions.test.ts` inside the `describe('createTransaction')` block:

```typescript
  it('accepts INVESTMENT_IN as a transaction type', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createTransaction(makeEvent({
      body: { amount: 30000, type: 'INVESTMENT_IN', categoryId: 'cat-stocks', description: 'Monthly contribution', date: '2026-07-15' },
    }), 'user-1', {});
    expect(res.statusCode).toBe(201);
  });

  it('rejects the old INVESTMENT_GAIN type', async () => {
    const res = await createTransaction(makeEvent({
      body: { amount: 30000, type: 'INVESTMENT_GAIN', categoryId: 'cat-stocks', description: 'Old type', date: '2026-07-15' },
    }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test src/api/__tests__/transactions.test.ts
```

Expected: FAIL — `INVESTMENT_IN` currently returns 400, `INVESTMENT_GAIN` currently returns 201.

- [ ] **Step 3: Update the type union**

In `src/api/types.ts`, replace the `TransactionType` line:

```typescript
export type TransactionType = 'EXPENSE' | 'INCOME' | 'INVESTMENT_IN' | 'INVESTMENT_OUT';
```

- [ ] **Step 4: Update the validation constant**

In `src/api/constants.ts`, replace the `VALID_TRANSACTION_TYPES` block:

```typescript
export const VALID_TRANSACTION_TYPES = new Set([
  'EXPENSE', 'INCOME', 'INVESTMENT_IN', 'INVESTMENT_OUT',
]);
```

- [ ] **Step 5: Update the error message**

In `src/api/transactions.ts`, in `createTransaction`, replace the type error message:

```typescript
    return err(400, 'type must be EXPENSE, INCOME, INVESTMENT_IN, or INVESTMENT_OUT');
```

- [ ] **Step 6: Update any existing test fixtures using the old names**

```bash
grep -rn "INVESTMENT_GAIN\|INVESTMENT_LOSS" src/
```

Replace each remaining occurrence: `INVESTMENT_GAIN` → `INVESTMENT_IN`, `INVESTMENT_LOSS` → `INVESTMENT_OUT`. The only expected hit outside the files already edited is the negative-case test added in Step 1, which must keep the old name.

- [ ] **Step 7: Run tests and typecheck**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api/types.ts src/api/constants.ts src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "feat: rename investment transaction types to IN/OUT"
```

---

### Task 3: Make description optional

Description is required and non-empty, adding a typing step to every entry. Make it optional while keeping the 200-character cap when present.

**Files:**
- Modify: `src/api/transactions.ts` (validation and item construction in `createTransaction`)
- Test: `src/api/__tests__/transactions.test.ts`

**Interfaces:**
- Produces: `createTransaction` accepts a body with no `description`; the stored `Transaction.description` is `''` in that case.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('createTransaction')`:

```typescript
  it('creates a transaction with no description', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createTransaction(makeEvent({
      body: { amount: 480, type: 'EXPENSE', categoryId: 'cat-dining', date: '2026-07-15' },
    }), 'user-1', {});
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).transaction.description).toBe('');
  });

  it('still rejects a description longer than 200 characters', async () => {
    const res = await createTransaction(makeEvent({
      body: { amount: 480, type: 'EXPENSE', categoryId: 'cat-dining', description: 'x'.repeat(201), date: '2026-07-15' },
    }), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test src/api/__tests__/transactions.test.ts
```

Expected: FAIL — the missing-description case currently returns 400.

- [ ] **Step 3: Relax the validation**

In `src/api/transactions.ts`, in `createTransaction`, replace the description validation block:

```typescript
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > 200) {
      return err(400, 'description must be a string of at most 200 characters');
    }
  }
```

- [ ] **Step 4: Default the stored value**

In the same function, change the `description` property of the `transaction` object:

```typescript
    description: typeof description === 'string' ? description.trim() : '',
```

- [ ] **Step 5: Run tests and typecheck**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "feat: make transaction description optional (IO-01)"
```

---

### Task 4: Add transaction validation helper

Task 5 needs the same field validation as `createTransaction`. Extract it now so the update handler reuses it rather than duplicating twelve lines of rules.

**Files:**
- Modify: `src/api/transactions.ts`
- Test: `src/api/__tests__/transactions.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface ValidTransactionInput {
    amount: number;
    type: Transaction['type'];
    categoryId: string;
    description: string;
    date: string;
  }
  function validateTransactionInput(body: Record<string, unknown>):
    { ok: true; value: ValidTransactionInput } | { ok: false; message: string }
  ```

- [ ] **Step 1: Write the failing test**

Add a new top-level `describe` block to `src/api/__tests__/transactions.test.ts`, and add `validateTransactionInput` to the existing import from `'../transactions'`:

```typescript
describe('validateTransactionInput', () => {
  const valid = { amount: 480, type: 'EXPENSE', categoryId: 'cat-dining', description: 'Pret', date: '2026-07-15' };

  it('accepts a valid body', () => {
    const res = validateTransactionInput(valid);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.amount).toBe(480);
  });

  it('rejects a non-integer amount', () => {
    const res = validateTransactionInput({ ...valid, amount: 4.8 });
    expect(res.ok).toBe(false);
  });

  it('rejects a zero amount', () => {
    const res = validateTransactionInput({ ...valid, amount: 0 });
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown type', () => {
    const res = validateTransactionInput({ ...valid, type: 'NOPE' });
    expect(res.ok).toBe(false);
  });

  it('rejects a malformed date', () => {
    const res = validateTransactionInput({ ...valid, date: '15-07-2026' });
    expect(res.ok).toBe(false);
  });

  it('defaults a missing description to empty string', () => {
    const { description, ...noDesc } = valid;
    const res = validateTransactionInput(noDesc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.description).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test src/api/__tests__/transactions.test.ts
```

Expected: FAIL — `validateTransactionInput` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/api/transactions.ts`, add above `createTransaction`:

```typescript
export interface ValidTransactionInput {
  amount: number;
  type: Transaction['type'];
  categoryId: string;
  description: string;
  date: string;
}

export function validateTransactionInput(
  body: Record<string, unknown>,
): { ok: true; value: ValidTransactionInput } | { ok: false; message: string } {
  const { amount, type, categoryId, description, date } = body;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: 'amount must be a positive integer representing pence/cents' };
  }
  if (!type || !VALID_TRANSACTION_TYPES.has(type as string)) {
    return { ok: false, message: 'type must be EXPENSE, INCOME, INVESTMENT_IN, or INVESTMENT_OUT' };
  }
  if (!categoryId || typeof categoryId !== 'string' || categoryId.length > 100) {
    return { ok: false, message: 'categoryId is required' };
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > 200) {
      return { ok: false, message: 'description must be a string of at most 200 characters' };
    }
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: 'date must be in YYYY-MM-DD format' };
  }

  return {
    ok: true,
    value: {
      amount,
      type: type as Transaction['type'],
      categoryId,
      description: typeof description === 'string' ? description.trim() : '',
      date,
    },
  };
}
```

- [ ] **Step 4: Rewrite createTransaction to use it**

Replace the body of `createTransaction` between the JSON parse and the `yearMonth` line:

```typescript
  const validation = validateTransactionInput(body);
  if (!validation.ok) {
    return err(400, validation.message);
  }
  const { amount, type, categoryId, description, date } = validation.value;
```

Then change the `transaction` object's description property to plain `description` (it is already trimmed and defaulted by the validator).

- [ ] **Step 5: Run tests and typecheck**

```bash
yarn test && yarn typecheck
```

Expected: PASS — all previous createTransaction tests still pass, proving the extraction is behaviour-preserving.

- [ ] **Step 6: Commit**

```bash
git add src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "refactor: extract transaction input validation (IO-01)"
```

---

### Task 5: Add updateTransaction handler

Adds `PUT /api/transactions/{yearMonth}/{transactionId}`. Two paths: a same-month edit is a single put on the existing key; changing the date across a month boundary changes the sort key, which DynamoDB cannot do in place, so it becomes a transactional delete-plus-put.

**Files:**
- Modify: `src/api/transactions.ts`
- Test: `src/api/__tests__/transactions.test.ts`

**Interfaces:**
- Consumes: `validateTransactionInput` from Task 4, `ok`/`err` from Task 1
- Produces: `updateTransaction(event, userId, params) => Promise<ApiResponse>`; 200 with `{ transaction }`, 404 if absent, 400 on invalid input

- [ ] **Step 1: Extend the AWS SDK mock**

In `src/api/__tests__/transactions.test.ts`, replace the `vi.mock('@aws-sdk/lib-dynamodb', ...)` block:

```typescript
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function(i: unknown) { return i; }),
  PutCommand: vi.fn(function(i: unknown) { return i; }),
  DeleteCommand: vi.fn(function(i: unknown) { return i; }),
  GetCommand: vi.fn(function(i: unknown) { return i; }),
  TransactWriteCommand: vi.fn(function(i: unknown) { return i; }),
}));
```

- [ ] **Step 2: Write the failing tests**

Add `updateTransaction` to the import from `'../transactions'`, then add:

```typescript
describe('updateTransaction', () => {
  beforeEach(() => { mockSend.mockReset(); });

  const existing = {
    transactionId: 'txn-1', yearMonth: '2026-07', amount: 480, type: 'EXPENSE',
    categoryId: 'cat-dining', description: 'Pret', date: '2026-07-15',
    createdAt: '2026-07-15T09:00:00.000Z',
  };
  const params = { yearMonth: '2026-07', transactionId: 'txn-1' };

  it('updates a transaction within the same month', async () => {
    mockSend.mockResolvedValueOnce({ Item: existing });
    mockSend.mockResolvedValueOnce({});
    const res = await updateTransaction(makeEvent({
      body: { amount: 520, type: 'EXPENSE', categoryId: 'cat-dining', description: 'Pret coffee', date: '2026-07-16' },
    }), 'user-1', params);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transaction.amount).toBe(520);
    expect(body.transaction.transactionId).toBe('txn-1');
    expect(body.transaction.createdAt).toBe('2026-07-15T09:00:00.000Z');
  });

  it('returns 404 when the transaction does not exist', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await updateTransaction(makeEvent({
      body: { amount: 520, type: 'EXPENSE', categoryId: 'cat-dining', description: 'x', date: '2026-07-16' },
    }), 'user-1', params);
    expect(res.statusCode).toBe(404);
  });

  it('moves the item transactionally when the month changes', async () => {
    mockSend.mockResolvedValueOnce({ Item: existing });
    mockSend.mockResolvedValueOnce({});
    const res = await updateTransaction(makeEvent({
      body: { amount: 480, type: 'EXPENSE', categoryId: 'cat-dining', description: 'Pret', date: '2026-08-02' },
    }), 'user-1', params);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).transaction.yearMonth).toBe('2026-08');

    const writeArg = mockSend.mock.calls[1][0];
    expect(writeArg.TransactItems).toHaveLength(2);
    expect(writeArg.TransactItems[0].Delete.Key.SK).toBe('TXN#2026-07#txn-1');
    expect(writeArg.TransactItems[1].Put.Item.SK).toBe('TXN#2026-08#txn-1');
  });

  it('returns 400 for an invalid amount', async () => {
    const res = await updateTransaction(makeEvent({
      body: { amount: -5, type: 'EXPENSE', categoryId: 'cat-dining', description: 'x', date: '2026-07-16' },
    }), 'user-1', params);
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed yearMonth param', async () => {
    const res = await updateTransaction(makeEvent({
      body: { amount: 480, type: 'EXPENSE', categoryId: 'cat-dining', description: 'x', date: '2026-07-16' },
    }), 'user-1', { yearMonth: '07-2026', transactionId: 'txn-1' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
yarn test src/api/__tests__/transactions.test.ts
```

Expected: FAIL — `updateTransaction` is not exported.

- [ ] **Step 4: Implement the handler**

In `src/api/transactions.ts`, extend the SDK import and add the handler:

```typescript
import { QueryCommand, PutCommand, DeleteCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
```

```typescript
export async function updateTransaction(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { yearMonth, transactionId } = params;

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return err(400, 'yearMonth must be in YYYY-MM format');
  }
  if (!transactionId) {
    return err(400, 'transactionId is required');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const validation = validateTransactionInput(body);
  if (!validation.ok) {
    return err(400, validation.message);
  }
  const { amount, type, categoryId, description, date } = validation.value;

  const existingResult = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) },
  }));

  const existing = existingResult.Item as Transaction | undefined;
  if (!existing) {
    return err(404, 'Transaction not found');
  }

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
  };

  if (newYearMonth === yearMonth) {
    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: pk(userId), SK: txnSk(yearMonth, transactionId), ...transaction },
    }));
  } else {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE, Key: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) } } },
        { Put: { TableName: TABLE, Item: { PK: pk(userId), SK: txnSk(newYearMonth, transactionId), ...transaction } } },
      ],
    }));
  }

  return ok({ transaction });
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "feat: add transaction update endpoint handler (IO-01)"
```

---

### Task 6: Add category reassignment handler

Adds `POST /api/categories/{categoryId}/reassign`, moving every transaction from one category to another across all months so deleting a category never orphans history.

**Files:**
- Create: `src/api/reassign.ts`
- Create: `src/api/__tests__/reassign.test.ts`

**Interfaces:**
- Consumes: `ok`/`err` from Task 1, `docClient`, `TABLE`, `pk` from `./db`, `DEFAULT_CATEGORIES` from `./defaults`
- Produces: `reassignCategory(event, userId, params) => Promise<ApiResponse>`; 200 with `{ reassigned: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/api/__tests__/reassign.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function(i: unknown) { return i; }),
  UpdateCommand: vi.fn(function(i: unknown) { return i; }),
}));

import { reassignCategory } from '../reassign';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: object): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('reassignCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('reassigns every matching transaction across months', async () => {
    mockSend.mockResolvedValueOnce({ Items: [
      { SK: 'TXN#2026-06#a', categoryId: 'cat-custom' },
      { SK: 'TXN#2026-07#b', categoryId: 'cat-custom' },
      { SK: 'TXN#2026-07#c', categoryId: 'cat-food' },
    ] });
    mockSend.mockResolvedValue({});

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[1][0].Key.SK).toBe('TXN#2026-06#a');
    expect(mockSend.mock.calls[1][0].ExpressionAttributeValues[':c']).toBe('cat-entertainment');
  });

  it('returns 200 with zero when nothing matches', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ SK: 'TXN#2026-07#c', categoryId: 'cat-food' }] });
    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reassigned).toBe(0);
  });

  it('rejects reassigning a category to itself', async () => {
    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-custom' }), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a missing toCategoryId', async () => {
    const res = await reassignCategory(makeEvent({}), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown target category', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-nonexistent' }), 'user-1', { categoryId: 'cat-custom' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test src/api/__tests__/reassign.test.ts
```

Expected: FAIL — module `../reassign` does not exist.

- [ ] **Step 3: Implement the handler**

Create `src/api/reassign.ts`:

```typescript
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk } from './db';
import { DEFAULT_CATEGORY_IDS } from './defaults';
import { ok, err } from './http';
import type { ApiResponse } from './types';

export async function reassignCategory(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;

  if (!categoryId) {
    return err(400, 'categoryId is required');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const toCategoryId = body.toCategoryId;
  if (!toCategoryId || typeof toCategoryId !== 'string') {
    return err(400, 'toCategoryId is required');
  }
  if (toCategoryId === categoryId) {
    return err(400, 'toCategoryId must differ from the category being reassigned');
  }

  if (!DEFAULT_CATEGORY_IDS.has(toCategoryId)) {
    const target = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': pk(userId), ':sk': `CAT#${toCategoryId}` },
    }));
    if (!target.Items || target.Items.length === 0) {
      return err(400, 'toCategoryId does not exist');
    }
  }

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'TXN#' },
  }));

  const matching = (result.Items || []).filter(item => item.categoryId === categoryId);

  for (const item of matching) {
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk(userId), SK: item.SK },
      UpdateExpression: 'SET categoryId = :c',
      ExpressionAttributeValues: { ':c': toCategoryId },
    }));
  }

  return ok({ reassigned: matching.length });
}
```

Note: the unknown-target test mocks a single empty query result, which the
`DEFAULT_CATEGORY_IDS` guard skips for default ids — `cat-nonexistent` is not a
default, so the lookup runs and returns no items.

- [ ] **Step 4: Run tests and typecheck**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/reassign.ts src/api/__tests__/reassign.test.ts
git commit -m "feat: add category transaction reassignment handler"
```

---

### Task 7: Wire the new routes and verify deployment

Registers both new endpoints and confirms the Lambda's IAM policy covers `TransactWriteItems` in the real environment. API Gateway needs no change — `PUT /api/{proxy+}` and `POST /api/{proxy+}` already route to this Lambda.

**Files:**
- Modify: `api-handler.ts:27-35`
- Test: `src/api/__tests__/router.test.ts`

**Interfaces:**
- Consumes: `updateTransaction` (Task 5), `reassignCategory` (Task 6)

- [ ] **Step 1: Write the failing routing test**

Add to `src/api/__tests__/router.test.ts`:

```typescript
  it('routes PUT /api/transactions/{yearMonth}/{transactionId} with both params', async () => {
    const router = createRouter();
    let captured: Record<string, string> | null = null;
    router.put('/api/transactions/{yearMonth}/{transactionId}', async (_e, _u, p) => {
      captured = p;
      return { statusCode: 200, headers: {}, body: '' };
    });
    await router.dispatch(makeEvent('PUT', '/api/transactions/2026-07/txn-1'), 'user-1');
    expect(captured).toEqual({ yearMonth: '2026-07', transactionId: 'txn-1' });
  });

  it('routes POST /api/categories/{categoryId}/reassign', async () => {
    const router = createRouter();
    let captured: Record<string, string> | null = null;
    router.post('/api/categories/{categoryId}/reassign', async (_e, _u, p) => {
      captured = p;
      return { statusCode: 200, headers: {}, body: '' };
    });
    await router.dispatch(makeEvent('POST', '/api/categories/cat-custom/reassign'), 'user-1');
    expect(captured).toEqual({ categoryId: 'cat-custom' });
  });
```

- [ ] **Step 2: Run to verify it passes or fails**

```bash
yarn test src/api/__tests__/router.test.ts
```

Expected: PASS — the router already supports these patterns. This test locks in the path shapes the handlers depend on.

- [ ] **Step 3: Register the routes**

In `api-handler.ts`, extend the imports and route registrations:

```typescript
import { getTransactions, createTransaction, deleteTransaction, updateTransaction } from './src/api/transactions';
import { reassignCategory } from './src/api/reassign';
```

```typescript
router.put('/api/transactions/{yearMonth}/{transactionId}', updateTransaction);
router.post('/api/categories/{categoryId}/reassign', reassignCategory);
```

Register the reassign route **before** any broader `/api/categories` POST route so the more specific pattern is matched first. The router iterates in registration order.

- [ ] **Step 4: Verify the Lambda bundle compiles**

```bash
node scripts/build-api-handler.cjs
```

Expected: `✓ API handler compiled to build/api/index.js` with no TypeScript errors.

- [ ] **Step 5: Run the full suite**

```bash
yarn test && yarn typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api-handler.ts src/api/__tests__/router.test.ts
git commit -m "feat: wire transaction update and category reassign routes"
```

- [ ] **Step 7: Verify TransactWriteItems permission against the deployed Lambda**

The inline policy in `infra/dynamodb.tf` grants `GetItem`, `PutItem`, `DeleteItem`, `Query` and `UpdateItem`. `TransactWriteItems` is authorised through the underlying `PutItem` and `DeleteItem` permissions, so no change is expected — but this must be confirmed, not assumed, because the failure surfaces only in production.

After merging and deploying, exercise a cross-month edit against the live API with a valid Auth0 token:

```bash
curl -X PUT "$API/api/transactions/2026-07/$TXN_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":480,"type":"EXPENSE","categoryId":"cat-dining","description":"moved","date":"2026-08-02"}'
```

Expected: 200 with `yearMonth: "2026-08"`. If it returns `AccessDeniedException`, add to the `Action` list in `infra/dynamodb.tf`:

```hcl
          "dynamodb:ConditionCheckItem",
```

then `cd infra && tofu apply`, and re-run the curl.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Rename `INVESTMENT_GAIN`/`LOSS` → `IN`/`OUT` | 2 |
| Make description optional, keep ≤200 cap | 3 |
| `PUT /api/transactions/{yearMonth}/{transactionId}` | 5 |
| Same-month update path | 5 |
| Cross-month update via `TransactWriteItems`, preserving id and createdAt | 5 |
| `POST /api/categories/{categoryId}/reassign` | 6 |
| Reassign across all months via `begins_with(SK, 'TXN#')` | 6 |
| `UpdateItem` rather than `BatchWriteItem` | 6 |
| Target must exist and differ from source | 6 |
| Defaults remain undeletable | Already enforced by `deleteCategory` (403); unchanged |
| Verify `TransactWriteItems` IAM | 7 |
| No API Gateway change needed | Confirmed: all four methods already route to the Lambda |

**Type consistency:** `validateTransactionInput` is defined in Task 4 and consumed in Task 5 with the same signature. `Transaction['type']` is used consistently. `reassignCategory` and `updateTransaction` names match between Tasks 5, 6 and 7.

**Placeholder scan:** No TBD, TODO, or "add error handling" steps. Every code step contains the literal code to write.

**Deferred to the frontend plan:** all UI work, the reassign confirmation dialog, and `money.ts`/`summary.ts`.
