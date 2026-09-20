# Recurring Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monthly recurring templates: a new stored item type with five API routes, a client-side "what is due?" calculation, a Due card on Home (Add with Undo, Edit, Skip), a Recurring page, and a "Repeat monthly" row action.

**Architecture:** Templates are `RECUR#<id>` items in the existing single DynamoDB table, served by five new routes written like `targets.ts`. The API only stores templates; the frontend computes due items with pure functions from templates, today's local date and the transactions it already loads. Two existing pieces of the sheet (the Modal/Drawer wrapper and the Saved/Undo/Retry toast logic) are extracted so the new UI can reuse them.

**Tech Stack:** TypeScript, AWS Lambda + DynamoDB (`@aws-sdk/lib-dynamodb`), React 19 (StrictMode), React Router 8, Mantine 8.3.12, TanStack Query 5, Vitest 4 + Testing Library, yarn.

**Spec:** `docs/superpowers/specs/2026-09-19-recurring-templates-design.md`

## Global Constraints

- **No infra, IAM or dependency changes.** The table policy already covers the new item type; `/api/{proxy+}` already routes to the Lambda. Do not touch `infra/` or `package.json`.
- **Nothing is created automatically.** The Due card suggests; **Add** saves with the usual Undo toast; **Skip** shows a Skip-with-Undo toast. No scheduler.
- **Due logic is client-side and pure** (`app/lib/recurring.ts`); the API only stores and returns templates.
- **Item fields** (`PK = USER#<sub>`, `SK = RECUR#<recurringId>`): `recurringId` (server uuid), `type` (`EXPENSE | INCOME | INVESTMENT_IN | INVESTMENT_OUT`), `categoryId` (non-empty, at most 100 characters; existence not checked), `amount` (positive integer pence), `description` (at most 200 characters, optional, default `''`, trimmed), `dayOfMonth` (integer 1-31), `leadDays` (integer 0-14, default 3), `handledPeriod` (`YYYY-MM` or `null`; means "handled **through** that month"), `createdAt`, `updatedAt`.
- **Routes:** `GET /api/recurring`, `POST /api/recurring` (201), `PUT /api/recurring/{recurringId}` (replaces the editable fields, preserves `handledPeriod` and `createdAt`, 404 if missing), `DELETE /api/recurring/{recurringId}` (204, idempotent), `POST /api/recurring/{recurringId}/handled` (body `{ period: 'YYYY-MM' | null }`, conditional update, 404 if missing). Responses use the `ok`/`err` helpers and `SECURITY_HEADERS`; error messages are generic to the client.
- **Isolation (AUTH-04):** every DynamoDB key is built from `pk(userId)` where `userId` comes from the validated token. It is never taken from the request body or path. Tests must prove this by asserting the keys in the commands.
- **Due rules:** the occurrence date is `dayOfMonth` clamped to the month's last day. An occurrence `O` is visible when `O - leadDays <= today <= last day of O's month`, considering today's month and the next month. At most one row per template: the earliest unhandled visible occurrence. **Handled** means `handledPeriod >= O's month` OR a transaction in `O`'s month with the same `type` and `categoryId` (and the same normalised note when the template's note is non-empty). Templates whose category no longer exists are excluded. Ordering is by `daysAway` ascending (overdue first).
- **Actions:** Add creates `{ type, categoryId, amount, description, date: <due date> }`; Edit opens the add sheet prefilled with the **due date**, and marks the occurrence handled after that save; Skip marks the period handled and its Undo restores the previous `handledPeriod` (possibly `null`).
- **UI:** per-field inline errors in the template form (not everything under Amount); the bottom tab bar stays at four tabs (the Recurring link is sidebar-only plus a Home link).
- **Read event values in a handler before calling setState; never read an event inside a functional state updater** (this crashed the Transactions search under StrictMode). Tests for components with such handlers should render under `<StrictMode>` where practical.
- Code style: `~/` alias for `app/`, explicit types on function parameters and return values, early returns, no nested ternaries, no comments that restate the code, no empty catch blocks.
- **Commits:** conventional commits, imperative subject under 72 characters. The body ends with the two trailer lines **contiguous in one paragraph** (no blank line between them), built with a heredoc:

  ```bash
  git commit -q -F - <<'EOF'
  feat: short imperative subject

  Optional body explaining why.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
  EOF
  ```
  The first trailer line must say exactly `Claude Sonnet 5`, whichever model writes the commit.
- **Stage explicit paths only**; never `git add -A` or `git add .`.
- Run tests with `yarn test`, type-check with `yarn typecheck` (it covers `src/` and `api-handler.ts` too). Baseline on this branch: **238/238 tests, typecheck clean**. Both must pass at the end of every task, with pristine output (no `act()` or React warnings).
- Work on branch `feat/recurring-templates`.

## File Structure

| File | Responsibility |
|---|---|
| `src/api/types.ts`, `src/api/db.ts` | `Recurring` type; `recurringSk(id)` |
| `src/api/recurring.ts` | Validation and the five handlers |
| `api-handler.ts` | Register the five routes |
| `src/api/reassign.ts` | Reassign also moves templates |
| `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts` | Frontend type, API client, hooks |
| `app/lib/months.ts` | Date helpers (`lastDayOfMonth`, `addDaysIso`, `daysBetweenIso`, `formatShortDate`) |
| `app/lib/recurring.ts` | Due logic, labels, form validation |
| `app/lib/transactionTypes.ts` | `formatSignedPence` |
| `app/components/layout/ResponsiveSheet.tsx` | Modal on wide screens, bottom Drawer below |
| `app/components/layout/ToastAction.tsx` | Toast body with one action button; `TOAST_MS` |
| `app/hooks/useSaveWithUndo.tsx` | Saved / Undo / Retry logic extracted from the sheet |
| `app/hooks/useDueRecurring.ts` | Composes templates, categories and two months of transactions |
| `app/components/recurring/RecurringForm.tsx` | Create / edit / repeat form |
| `app/components/recurring/DueRecurringCard.tsx` | The Home card |
| `app/routes/recurring.tsx` | The Recurring page |
| `app/components/transactions/TransactionSheet.tsx`, `TransactionRow.tsx`, `app/routes/transactions.tsx`, `app/routes/_index.tsx` | Wiring |
| `app/components/layout/DefaultLayout.tsx`, `QuickEntryTips.tsx` | Sidebar link; tips text |
| `docs/ROADMAP.md` | Status row for C |

---

### Task 1: Backend types, validation, list and create

**Files:**
- Modify: `src/api/types.ts`, `src/api/db.ts`, `api-handler.ts`
- Create: `src/api/recurring.ts`
- Test: `src/api/__tests__/recurring.test.ts`

**Interfaces:**
- Consumes: `docClient`, `TABLE`, `pk` from `src/api/db.ts`; `ok`, `err` from `src/api/http.ts`; `SECURITY_HEADERS`, `VALID_TRANSACTION_TYPES` from `src/api/constants.ts`.
- Produces: `Recurring` type; `recurringSk(recurringId: string): string`; `validateRecurringInput(body: Record<string, unknown>)`, `parseJsonObject(event)`, `toRecurring(item)`, `getRecurring`, `createRecurring` (all exported from `src/api/recurring.ts`). Task 2 extends this file and the test file.

- [ ] **Step 1: Write the failing tests**

Create `src/api/__tests__/recurring.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  recurringSk: (recurringId: string) => `RECUR#${recurringId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function(i: unknown) { return i; }),
  PutCommand: vi.fn(function(i: unknown) { return i; }),
  UpdateCommand: vi.fn(function(i: unknown) { return i; }),
  DeleteCommand: vi.fn(function(i: unknown) { return i; }),
}));

import { createRecurring, getRecurring } from '../recurring';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: unknown, rawBody?: string): APIGatewayProxyEventV2 {
  return {
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

const validBody = {
  type: 'INCOME',
  categoryId: 'cat-salary',
  amount: 240000,
  description: 'Salary',
  dayOfMonth: 28,
  leadDays: 3,
};

describe('getRecurring', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns the caller\'s templates without storage keys', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{
      PK: 'USER#user-1', SK: 'RECUR#r1', recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary',
      amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3, handledPeriod: null,
      createdAt: 'c', updatedAt: 'u',
    }] });

    const res = await getRecurring(makeEvent(), 'user-1', {});

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recurring).toHaveLength(1);
    expect(body.recurring[0]).not.toHaveProperty('PK');
    expect(body.recurring[0]).not.toHaveProperty('SK');
    expect(body.recurring[0].recurringId).toBe('r1');
  });

  it('queries only the caller\'s RECUR# items', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    await getRecurring(makeEvent(), 'user-1', {});
    const command = mockSend.mock.calls[0][0];
    expect(command.ExpressionAttributeValues[':pk']).toBe('USER#user-1');
    expect(command.ExpressionAttributeValues[':prefix']).toBe('RECUR#');
  });

  it('returns an empty list when there are no templates', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await getRecurring(makeEvent(), 'user-1', {});
    expect(JSON.parse(res.body).recurring).toEqual([]);
  });
});

describe('createRecurring', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates a template and returns 201', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createRecurring(makeEvent(validBody), 'user-1', {});

    expect(res.statusCode).toBe(201);
    const { recurring } = JSON.parse(res.body);
    expect(recurring).toMatchObject({ ...validBody, handledPeriod: null });
    expect(recurring.recurringId).toMatch(/^[0-9a-f-]{36}$/);
    expect(recurring.createdAt).toBe(recurring.updatedAt);
  });

  it('stores the item under the caller\'s key, ignoring key fields in the body', async () => {
    mockSend.mockResolvedValueOnce({});
    await createRecurring(makeEvent({ ...validBody, PK: 'USER#evil', SK: 'RECUR#x', userId: 'evil' }), 'user-1', {});

    const item = mockSend.mock.calls[0][0].Item;
    expect(item.PK).toBe('USER#user-1');
    expect(item.SK).toBe(`RECUR#${item.recurringId}`);
    expect(item).not.toHaveProperty('userId');
  });

  it('defaults the note to empty and leadDays to 3, and trims the note', async () => {
    mockSend.mockResolvedValueOnce({});
    const { description: _omit, leadDays: _omit2, ...rest } = validBody;
    const res = await createRecurring(makeEvent(rest), 'user-1', {});
    expect(JSON.parse(res.body).recurring).toMatchObject({ description: '', leadDays: 3 });

    mockSend.mockResolvedValueOnce({});
    const trimmed = await createRecurring(makeEvent({ ...validBody, description: '  Rent  ' }), 'user-1', {});
    expect(JSON.parse(trimmed.body).recurring.description).toBe('Rent');
  });

  it.each([
    ['day 1', { dayOfMonth: 1 }],
    ['day 31', { dayOfMonth: 31 }],
    ['leadDays 0', { leadDays: 0 }],
    ['leadDays 14', { leadDays: 14 }],
    ['a 200 character note', { description: 'a'.repeat(200) }],
    ['INVESTMENT_IN', { type: 'INVESTMENT_IN' }],
  ])('accepts %s', async (_label, override) => {
    mockSend.mockResolvedValueOnce({});
    const res = await createRecurring(makeEvent({ ...validBody, ...override }), 'user-1', {});
    expect(res.statusCode).toBe(201);
  });

  it.each([
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -5 }],
    ['fractional amount', { amount: 10.5 }],
    ['string amount', { amount: '100' }],
    ['unknown type', { type: 'TRANSFER' }],
    ['missing type', { type: undefined }],
    ['empty categoryId', { categoryId: '' }],
    ['overlong categoryId', { categoryId: 'c'.repeat(101) }],
    ['missing categoryId', { categoryId: undefined }],
    ['day 0', { dayOfMonth: 0 }],
    ['day 32', { dayOfMonth: 32 }],
    ['fractional day', { dayOfMonth: 1.5 }],
    ['string day', { dayOfMonth: '5' }],
    ['missing day', { dayOfMonth: undefined }],
    ['negative leadDays', { leadDays: -1 }],
    ['leadDays 15', { leadDays: 15 }],
    ['fractional leadDays', { leadDays: 2.5 }],
    ['a 201 character note', { description: 'a'.repeat(201) }],
    ['a non-string note', { description: 42 }],
  ])('rejects %s with 400 and writes nothing', async (_label, override) => {
    const res = await createRecurring(makeEvent({ ...validBody, ...override }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', undefined, '{'],
    ['a JSON array', [1, 2], undefined],
    ['a JSON string', 'hello', undefined],
  ])('rejects %s with 400', async (_label, body, rawBody) => {
    const res = await createRecurring(makeEvent(body, rawBody), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Invalid JSON body');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run src/api/__tests__/recurring.test.ts`
Expected: FAIL, cannot resolve `../recurring`.

- [ ] **Step 3: Implement**

In `src/api/types.ts`, add after `CategoryTarget`:

```ts
export interface Recurring {
  recurringId: string;
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  leadDays: number;
  handledPeriod: string | null;
  createdAt: string;
  updatedAt: string;
}
```

In `src/api/db.ts`, add at the end:

```ts
export const recurringSk = (recurringId: string): string => `RECUR#${recurringId}`;
```

Create `src/api/recurring.ts`:

```ts
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, recurringSk } from './db';
import { SECURITY_HEADERS, VALID_TRANSACTION_TYPES } from './constants';
import type { ApiResponse, Recurring, TransactionType } from './types';
import { ok, err } from './http';

const DEFAULT_LEAD_DAYS = 3;
const MAX_NOTE_LENGTH = 200;

export interface ValidRecurringInput {
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  leadDays: number;
}

type Validation = { ok: true; value: ValidRecurringInput } | { ok: false; message: string };

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validateRecurringInput(body: Record<string, unknown>): Validation {
  const { type, categoryId, amount, description, dayOfMonth, leadDays } = body;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: 'amount must be a positive integer representing pence/cents' };
  }
  if (typeof type !== 'string' || !VALID_TRANSACTION_TYPES.has(type)) {
    return { ok: false, message: 'type must be EXPENSE, INCOME, INVESTMENT_IN, or INVESTMENT_OUT' };
  }
  if (typeof categoryId !== 'string' || categoryId === '' || categoryId.length > 100) {
    return { ok: false, message: 'categoryId is required' };
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > MAX_NOTE_LENGTH) {
      return { ok: false, message: 'description must be a string of at most 200 characters' };
    }
  }
  if (!isIntegerInRange(dayOfMonth, 1, 31)) {
    return { ok: false, message: 'dayOfMonth must be an integer from 1 to 31' };
  }
  if (leadDays !== undefined && leadDays !== null && !isIntegerInRange(leadDays, 0, 14)) {
    return { ok: false, message: 'leadDays must be an integer from 0 to 14' };
  }

  return {
    ok: true,
    value: {
      type: type as TransactionType,
      categoryId,
      amount,
      description: typeof description === 'string' ? description.trim() : '',
      dayOfMonth,
      leadDays: typeof leadDays === 'number' ? leadDays : DEFAULT_LEAD_DAYS,
    },
  };
}

export function parseJsonObject(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(event.body || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toRecurring(item: Record<string, unknown>): Recurring {
  return {
    recurringId: item.recurringId as string,
    type: item.type as TransactionType,
    categoryId: item.categoryId as string,
    amount: item.amount as number,
    description: (item.description as string | undefined) ?? '',
    dayOfMonth: item.dayOfMonth as number,
    leadDays: (item.leadDays as number | undefined) ?? DEFAULT_LEAD_DAYS,
    handledPeriod: (item.handledPeriod as string | null | undefined) ?? null,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
}

export async function getRecurring(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'RECUR#' },
  }));

  return ok({ recurring: (result.Items ?? []).map(toRecurring) });
}

export async function createRecurring(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Invalid JSON body');

  const validation = validateRecurringInput(body);
  if (validation.ok === false) return err(400, validation.message);

  const now = new Date().toISOString();
  const recurring: Recurring = {
    recurringId: crypto.randomUUID(),
    ...validation.value,
    handledPeriod: null,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: recurringSk(recurring.recurringId), ...recurring },
  }));

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ recurring }) };
}
```

In `api-handler.ts`, add the import after the `reassignCategory` import:

```ts
import { getRecurring, createRecurring } from './src/api/recurring';
```

and register the routes after the `router.delete('/api/targets/{categoryId}', deleteTarget);` line:

```ts
router.get('/api/recurring', getRecurring);
router.post('/api/recurring', createRecurring);
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run src/api/__tests__/recurring.test.ts && yarn typecheck && yarn test`
Expected: the new file PASSES; typecheck clean; whole suite passes. (If TypeScript objects to the `value is number` type guard narrowing `dayOfMonth`, keep the guard and adjust the call site minimally; do not loosen the validation.)

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/db.ts src/api/recurring.ts src/api/__tests__/recurring.test.ts api-handler.ts
git commit -q -F - <<'EOF'
feat: add recurring template list and create routes

RECUR# items in the single table, hand-validated like transactions, with
keys always built from the caller's user id.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 2: Backend update, delete and handled

**Files:**
- Modify: `src/api/recurring.ts`, `api-handler.ts`
- Test: `src/api/__tests__/recurring.test.ts`

**Interfaces:**
- Consumes: `validateRecurringInput`, `parseJsonObject`, `toRecurring` (Task 1); `UpdateCommand`, `DeleteCommand` (already mocked by Task 1's test file).
- Produces: `updateRecurring`, `deleteRecurring`, `setRecurringHandled` handlers.

- [ ] **Step 1: Write the failing tests**

In `src/api/__tests__/recurring.test.ts`, change the import line to:

```ts
import { createRecurring, deleteRecurring, getRecurring, setRecurringHandled, updateRecurring } from '../recurring';
```

Append:

```ts
function conditionalFailure(): Error {
  const error = new Error('The conditional request failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

const storedItem = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 3, handledPeriod: '2026-08', createdAt: 'c', updatedAt: 'u',
};

describe('updateRecurring', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('replaces the editable fields and returns the updated item', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: { ...storedItem, amount: 250000 } });
    const res = await updateRecurring(makeEvent({ ...validBody, amount: 250000 }), 'user-1', { recurringId: 'r1' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recurring.amount).toBe(250000);
    const command = mockSend.mock.calls[0][0];
    expect(command.Key).toEqual({ PK: 'USER#user-1', SK: 'RECUR#r1' });
    expect(command.ExpressionAttributeValues[':amount']).toBe(250000);
    expect(command.ReturnValues).toBe('ALL_NEW');
  });

  it('never overwrites handledPeriod or createdAt', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: storedItem });
    await updateRecurring(makeEvent({ ...validBody, handledPeriod: '2030-01', createdAt: 'x' }), 'user-1', { recurringId: 'r1' });
    const expression: string = mockSend.mock.calls[0][0].UpdateExpression;
    expect(expression).not.toContain('handledPeriod');
    expect(expression).not.toContain('createdAt');
  });

  it('requires the item to exist and returns 404 when it does not', async () => {
    mockSend.mockRejectedValueOnce(conditionalFailure());
    const res = await updateRecurring(makeEvent(validBody), 'user-1', { recurringId: 'missing' });
    expect(res.statusCode).toBe(404);
    expect(mockSend.mock.calls[0][0].ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('builds the key from the caller, so another user\'s id is not found for them', async () => {
    mockSend.mockRejectedValueOnce(conditionalFailure());
    await updateRecurring(makeEvent({ ...validBody, PK: 'USER#user-1' }), 'user-2', { recurringId: 'r1' });
    expect(mockSend.mock.calls[0][0].Key.PK).toBe('USER#user-2');
  });

  it('rejects invalid input with 400 and writes nothing', async () => {
    const res = await updateRecurring(makeEvent({ ...validBody, dayOfMonth: 40 }), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects a missing id and malformed JSON with 400', async () => {
    expect((await updateRecurring(makeEvent(validBody), 'user-1', {})).statusCode).toBe(400);
    expect((await updateRecurring(makeEvent(undefined, '{'), 'user-1', { recurringId: 'r1' })).statusCode).toBe(400);
  });

  it('rethrows unexpected errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(updateRecurring(makeEvent(validBody), 'user-1', { recurringId: 'r1' })).rejects.toThrow('boom');
  });
});

describe('deleteRecurring', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes under the caller\'s key and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteRecurring(makeEvent(), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(204);
    expect(mockSend.mock.calls[0][0].Key).toEqual({ PK: 'USER#user-1', SK: 'RECUR#r1' });
  });

  it('is idempotent and scoped to the caller', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteRecurring(makeEvent(), 'user-2', { recurringId: 'r1' });
    expect(res.statusCode).toBe(204);
    expect(mockSend.mock.calls[0][0].Key.PK).toBe('USER#user-2');
  });

  it('rejects a missing id with 400', async () => {
    expect((await deleteRecurring(makeEvent(), 'user-1', {})).statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('setRecurringHandled', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('sets the handled period and returns the item', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: { ...storedItem, handledPeriod: '2026-09' } });
    const res = await setRecurringHandled(makeEvent({ period: '2026-09' }), 'user-1', { recurringId: 'r1' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recurring.handledPeriod).toBe('2026-09');
    const command = mockSend.mock.calls[0][0];
    expect(command.Key).toEqual({ PK: 'USER#user-1', SK: 'RECUR#r1' });
    expect(command.ExpressionAttributeValues[':period']).toBe('2026-09');
    expect(command.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('accepts null to clear the marker', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: { ...storedItem, handledPeriod: null } });
    const res = await setRecurringHandled(makeEvent({ period: null }), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(200);
    expect(mockSend.mock.calls[0][0].ExpressionAttributeValues[':period']).toBeNull();
  });

  it.each([
    ['month 13', { period: '2026-13' }],
    ['month 00', { period: '2026-00' }],
    ['a one-digit month', { period: '2026-1' }],
    ['a full date', { period: '2026-09-01' }],
    ['a number', { period: 202609 }],
    ['text', { period: 'abc' }],
    ['a missing period', {}],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await setRecurringHandled(makeEvent(body), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 404 when the item does not exist for the caller', async () => {
    mockSend.mockRejectedValueOnce(conditionalFailure());
    const res = await setRecurringHandled(makeEvent({ period: '2026-09' }), 'user-2', { recurringId: 'r1' });
    expect(res.statusCode).toBe(404);
    expect(mockSend.mock.calls[0][0].Key.PK).toBe('USER#user-2');
  });

  it('rejects a missing id and malformed JSON with 400', async () => {
    expect((await setRecurringHandled(makeEvent({ period: '2026-09' }), 'user-1', {})).statusCode).toBe(400);
    expect((await setRecurringHandled(makeEvent(undefined, '{'), 'user-1', { recurringId: 'r1' })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run src/api/__tests__/recurring.test.ts`
Expected: FAIL, `updateRecurring` / `deleteRecurring` / `setRecurringHandled` are not exported.

- [ ] **Step 3: Implement**

In `src/api/recurring.ts`, change the first import line to:

```ts
import { QueryCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
```

Add near the top (after `MAX_NOTE_LENGTH`):

```ts
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}
```

Append the three handlers:

```ts
export async function updateRecurring(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { recurringId } = params;
  if (!recurringId) return err(400, 'recurringId is required');

  const body = parseJsonObject(event);
  if (!body) return err(400, 'Invalid JSON body');

  const validation = validateRecurringInput(body);
  if (validation.ok === false) return err(400, validation.message);
  const { type, categoryId, amount, description, dayOfMonth, leadDays } = validation.value;

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk(userId), SK: recurringSk(recurringId) },
      UpdateExpression:
        'SET #type = :type, categoryId = :categoryId, amount = :amount, description = :description, '
        + 'dayOfMonth = :dayOfMonth, leadDays = :leadDays, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: {
        ':type': type,
        ':categoryId': categoryId,
        ':amount': amount,
        ':description': description,
        ':dayOfMonth': dayOfMonth,
        ':leadDays': leadDays,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return ok({ recurring: toRecurring(result.Attributes ?? {}) });
  } catch (error) {
    if (isConditionalFailure(error)) return err(404, 'Recurring item not found');
    throw error;
  }
}

export async function deleteRecurring(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { recurringId } = params;
  if (!recurringId) return err(400, 'recurringId is required');

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: recurringSk(recurringId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}

export async function setRecurringHandled(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { recurringId } = params;
  if (!recurringId) return err(400, 'recurringId is required');

  const body = parseJsonObject(event);
  if (!body) return err(400, 'Invalid JSON body');

  const { period } = body;
  if (period !== null && !(typeof period === 'string' && PERIOD_PATTERN.test(period))) {
    return err(400, 'period must be YYYY-MM or null');
  }

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk(userId), SK: recurringSk(recurringId) },
      UpdateExpression: 'SET handledPeriod = :period, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':period': period, ':updatedAt': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }));
    return ok({ recurring: toRecurring(result.Attributes ?? {}) });
  } catch (error) {
    if (isConditionalFailure(error)) return err(404, 'Recurring item not found');
    throw error;
  }
}
```

In `api-handler.ts`, replace the import line added in Task 1 with:

```ts
import {
  getRecurring, createRecurring, updateRecurring, deleteRecurring, setRecurringHandled,
} from './src/api/recurring';
```

and replace the two route lines from Task 1 with:

```ts
router.get('/api/recurring', getRecurring);
router.post('/api/recurring', createRecurring);
router.put('/api/recurring/{recurringId}', updateRecurring);
router.delete('/api/recurring/{recurringId}', deleteRecurring);
router.post('/api/recurring/{recurringId}/handled', setRecurringHandled);
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run src/api/__tests__/recurring.test.ts && yarn typecheck && yarn test`
Expected: all recurring tests PASS; typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/api/recurring.ts src/api/__tests__/recurring.test.ts api-handler.ts
git commit -q -F - <<'EOF'
feat: add recurring update, delete and handled routes

Conditional updates return 404 for a missing item, and every key is built
from the caller's user id, which the tests assert.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 3: Reassign also moves templates

**Files:**
- Modify: `src/api/reassign.ts`
- Test: `src/api/__tests__/reassign.test.ts`

**Interfaces:**
- Consumes: the existing `reassignCategory` handler and its test mocks (`mockSend`, `makeEvent`).
- Produces: the response gains `recurringReassigned` (a count); `reassigned` (transactions) is unchanged, so existing callers are unaffected.

- [ ] **Step 1: Update and add tests**

In `src/api/__tests__/reassign.test.ts`, in the test `'reassigns every matching transaction across months'`, change `expect(mockSend).toHaveBeenCalledTimes(3);` to `expect(mockSend).toHaveBeenCalledTimes(4);` (the extra call is the new, empty `RECUR#` query) and add below it:

```ts
    expect(JSON.parse(res.body).recurringReassigned).toBe(0);
```

Add these tests inside the `describe('reassignCategory', ...)` block, before its closing `});`:

```ts
  it('also moves recurring templates that use the category', async () => {
    mockSend.mockImplementation(async (command: { ExpressionAttributeValues?: Record<string, unknown>; Key?: unknown }) => {
      const prefix = command.ExpressionAttributeValues?.[':prefix'];
      if (prefix === 'TXN#') return { Items: [{ SK: 'TXN#2026-07#a', categoryId: 'cat-custom' }] };
      if (prefix === 'RECUR#') {
        return { Items: [
          { SK: 'RECUR#r1', categoryId: 'cat-custom' },
          { SK: 'RECUR#r2', categoryId: 'cat-food' },
        ] };
      }
      return {};
    });

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    const body = JSON.parse(res.body);
    expect(body.reassigned).toBe(1);
    expect(body.recurringReassigned).toBe(1);
    const updatedKeys = mockSend.mock.calls.filter(call => call[0].Key).map(call => call[0].Key.SK);
    expect(updatedKeys).toEqual(['TXN#2026-07#a', 'RECUR#r1']);
  });

  it('paginates the templates query and only touches the caller\'s items', async () => {
    mockSend.mockImplementation(async (command: {
      ExpressionAttributeValues?: Record<string, unknown>; ExclusiveStartKey?: unknown; Key?: unknown;
    }) => {
      if (command.ExpressionAttributeValues?.[':prefix'] === 'RECUR#') {
        if (command.ExclusiveStartKey === undefined) {
          return { Items: [{ SK: 'RECUR#r1', categoryId: 'cat-custom' }], LastEvaluatedKey: { PK: 'USER#user-1', SK: 'RECUR#r1' } };
        }
        return { Items: [{ SK: 'RECUR#r2', categoryId: 'cat-custom' }] };
      }
      return {};
    });

    const res = await reassignCategory(makeEvent({ toCategoryId: 'cat-entertainment' }), 'user-1', { categoryId: 'cat-custom' });

    expect(JSON.parse(res.body).recurringReassigned).toBe(2);
    const commands = mockSend.mock.calls.map(call => call[0]);
    const queries = commands.filter(command => command.KeyConditionExpression);
    expect(queries.every(command => command.ExpressionAttributeValues[':pk'] === 'USER#user-1')).toBe(true);
    const updates = commands.filter(command => command.Key);
    expect(updates.every(command => command.Key.PK === 'USER#user-1')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run src/api/__tests__/reassign.test.ts`
Expected: FAIL. The call count is still 3, and `recurringReassigned` is `undefined`.

- [ ] **Step 3: Implement**

Replace the whole of `src/api/reassign.ts` with:

```ts
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, catSk } from './db';
import { DEFAULT_CATEGORY_IDS } from './defaults';
import { ok, err } from './http';
import type { ApiResponse } from './types';

const UPDATE_BATCH_SIZE = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function reassignItems(
  userId: string,
  prefix: string,
  categoryId: string,
  toCategoryId: string,
): Promise<number> {
  const matching: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': prefix },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of result.Items || []) {
      if (item.categoryId === categoryId) {
        matching.push(item);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  let reassigned = 0;
  for (const batch of chunk(matching, UPDATE_BATCH_SIZE)) {
    const results = await Promise.all(batch.map(async (item) => {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk(userId), SK: item.SK },
          UpdateExpression: 'SET categoryId = :c',
          ConditionExpression: 'attribute_exists(SK)',
          ExpressionAttributeValues: { ':c': toCategoryId },
        }));
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          return false;
        }
        throw error;
      }
    }));
    reassigned += results.filter(Boolean).length;
  }

  return reassigned;
}

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
      ExpressionAttributeValues: { ':pk': pk(userId), ':sk': catSk(toCategoryId) },
    }));
    if (!target.Items || target.Items.length === 0) {
      return err(400, 'toCategoryId does not exist');
    }
  }

  const reassigned = await reassignItems(userId, 'TXN#', categoryId, toCategoryId);
  const recurringReassigned = await reassignItems(userId, 'RECUR#', categoryId, toCategoryId);

  return ok({ reassigned, recurringReassigned });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run src/api/__tests__/reassign.test.ts && yarn typecheck && yarn test`
Expected: all reassign tests PASS (the existing ones plus the new ones); typecheck clean; whole suite passes. The transactions pass runs first, so every earlier call index in the existing tests is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/api/reassign.ts src/api/__tests__/reassign.test.ts
git commit -q -F - <<'EOF'
feat: move recurring templates when reassigning a category

A second, identical pass over RECUR# items keeps templates from pointing
at a category that has been reassigned away. The response keeps
reassigned unchanged and adds recurringReassigned.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 4: Frontend type, API client and hooks

**Files:**
- Modify: `app/lib/types.ts`, `app/lib/api.ts`, `app/lib/queries.ts`
- Test: `app/lib/__tests__/api.test.ts` (new), `app/lib/__tests__/recurringHooks.test.tsx` (new)

**Interfaces:**
- Consumes: the existing `createApi(request)`, `useApi`, `useAuthReady`, `queryKeys` patterns.
- Produces: `Recurring` type; `RecurringInput`; `createApi(...)` methods `getRecurring`, `createRecurring`, `updateRecurring`, `deleteRecurring`, `setRecurringHandled`; `queryKeys.recurring`; hooks `useRecurring`, `useCreateRecurring`, `useUpdateRecurring`, `useDeleteRecurring`, `useSetRecurringHandled` (`mutate({ recurringId, period })`, optimistic).

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/api.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../api';
import type { Recurring } from '../types';

const recurring: Recurring = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: 'c', updatedAt: 'u',
};
const input = { type: 'INCOME' as const, categoryId: 'cat-salary', amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3 };

describe('recurring API calls', () => {
  it('lists templates', async () => {
    const request = vi.fn().mockResolvedValue({ recurring: [recurring] });
    expect(await createApi(request).getRecurring()).toEqual([recurring]);
    expect(request).toHaveBeenCalledWith('/api/recurring');
  });

  it('creates a template', async () => {
    const request = vi.fn().mockResolvedValue({ recurring });
    expect(await createApi(request).createRecurring(input)).toEqual(recurring);
    expect(request).toHaveBeenCalledWith('/api/recurring', { method: 'POST', body: JSON.stringify(input) });
  });

  it('updates a template', async () => {
    const request = vi.fn().mockResolvedValue({ recurring });
    expect(await createApi(request).updateRecurring('r1', input)).toEqual(recurring);
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'PUT', body: JSON.stringify(input) });
  });

  it('deletes a template', async () => {
    const request = vi.fn().mockResolvedValue(null);
    await createApi(request).deleteRecurring('r1');
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'DELETE' });
  });

  it('marks a period handled, and can clear it with null', async () => {
    const request = vi.fn().mockResolvedValue({ recurring });
    const api = createApi(request);

    await api.setRecurringHandled('r1', '2026-09');
    expect(request).toHaveBeenLastCalledWith('/api/recurring/r1/handled', { method: 'POST', body: JSON.stringify({ period: '2026-09' }) });

    await api.setRecurringHandled('r1', null);
    expect(request).toHaveBeenLastCalledWith('/api/recurring/r1/handled', { method: 'POST', body: JSON.stringify({ period: null }) });
  });

  it('encodes ids in the path', async () => {
    const request = vi.fn().mockResolvedValue(null);
    await createApi(request).deleteRecurring('a/b');
    expect(request).toHaveBeenCalledWith('/api/recurring/a%2Fb', { method: 'DELETE' });
  });
});
```

Create `app/lib/__tests__/recurringHooks.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Recurring } from '../types';

const request = vi.fn();
let authenticated = true;

vi.mock('~/hooks/useProtectedApi', () => ({ useProtectedApi: () => ({ request }) }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ isAuthenticated: authenticated }) }));

import {
  queryKeys, useCreateRecurring, useDeleteRecurring, useRecurring, useSetRecurringHandled, useUpdateRecurring,
} from '../queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const template: Recurring = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 3, handledPeriod: '2026-08', createdAt: 'c', updatedAt: 'u',
};
const input = { type: 'INCOME' as const, categoryId: 'cat-salary', amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3 };

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
  authenticated = true;
});

describe('useRecurring', () => {
  it('fetches the templates once authenticated', async () => {
    request.mockResolvedValue({ recurring: [template] });
    const { result } = renderHook(() => useRecurring(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([template]);
    expect(request).toHaveBeenCalledWith('/api/recurring');
  });

  it('stays idle until Auth0 has restored the session', async () => {
    authenticated = false;
    const { result } = renderHook(() => useRecurring(), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(request).not.toHaveBeenCalled();
  });
});

describe('recurring mutations', () => {
  it('create refreshes the list', async () => {
    request.mockResolvedValue({ recurring: template });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateRecurring(), { wrapper });

    act(() => { result.current.mutate(input); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
    expect(request).toHaveBeenCalledWith('/api/recurring', { method: 'POST', body: JSON.stringify(input) });
  });

  it('update refreshes the list', async () => {
    request.mockResolvedValue({ recurring: template });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateRecurring(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', input }); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'PUT', body: JSON.stringify(input) });
  });

  it('delete refreshes the list', async () => {
    request.mockResolvedValue(null);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteRecurring(), { wrapper });

    act(() => { result.current.mutate('r1'); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
    expect(request).toHaveBeenCalledWith('/api/recurring/r1', { method: 'DELETE' });
  });
});

describe('useSetRecurringHandled', () => {
  it('updates the cached template immediately, before the server answers', async () => {
    const pending = deferred<{ recurring: Recurring }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: '2026-09' }); });

    await waitFor(() => expect(client.getQueryData<Recurring[]>(queryKeys.recurring)?.[0].handledPeriod).toBe('2026-09'));
    pending.resolve({ recurring: { ...template, handledPeriod: '2026-09' } });
  });

  it('can clear the marker with null', async () => {
    const pending = deferred<{ recurring: Recurring }>();
    request.mockReturnValue(pending.promise);
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: null }); });

    await waitFor(() => expect(client.getQueryData<Recurring[]>(queryKeys.recurring)?.[0].handledPeriod).toBeNull());
    pending.resolve({ recurring: { ...template, handledPeriod: null } });
  });

  it('puts the previous marker back when the request fails', async () => {
    request.mockRejectedValue(new Error('boom'));
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: '2026-09' }); });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Recurring[]>(queryKeys.recurring)?.[0].handledPeriod).toBe('2026-08');
  });

  it('refreshes the list once it settles', async () => {
    request.mockResolvedValue({ recurring: { ...template, handledPeriod: '2026-09' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.recurring, [template]);
    const { result } = renderHook(() => useSetRecurringHandled(), { wrapper });

    act(() => { result.current.mutate({ recurringId: 'r1', period: '2026-09' }); });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recurring }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/api.test.ts app/lib/__tests__/recurringHooks.test.tsx`
Expected: FAIL. The API methods and hooks do not exist yet.

- [ ] **Step 3: Implement**

In `app/lib/types.ts`, append:

```ts
export interface Recurring {
  recurringId: string;
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  leadDays: number;
  handledPeriod: string | null;
  createdAt: string;
  updatedAt: string;
}
```

In `app/lib/api.ts`, change the first import to:

```ts
import type { Category, CategoryTarget, Recurring, TargetPeriod, Transaction, TransactionType } from './types';
```

add after `TransactionInput`:

```ts
export interface RecurringInput {
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  leadDays: number;
}
```

and add these methods inside the returned object, after `deleteTarget`:

```ts

    getRecurring: async (): Promise<Recurring[]> => {
      const res = await request('/api/recurring') as { recurring: Recurring[] };
      return res.recurring;
    },
    createRecurring: async (input: RecurringInput): Promise<Recurring> => {
      const res = await request('/api/recurring', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { recurring: Recurring };
      return res.recurring;
    },
    updateRecurring: async (recurringId: string, input: RecurringInput): Promise<Recurring> => {
      const res = await request(`/api/recurring/${encodeURIComponent(recurringId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }) as { recurring: Recurring };
      return res.recurring;
    },
    deleteRecurring: async (recurringId: string): Promise<void> => {
      await request(`/api/recurring/${encodeURIComponent(recurringId)}`, { method: 'DELETE' });
    },
    setRecurringHandled: async (recurringId: string, period: string | null): Promise<Recurring> => {
      const res = await request(`/api/recurring/${encodeURIComponent(recurringId)}/handled`, {
        method: 'POST',
        body: JSON.stringify({ period }),
      }) as { recurring: Recurring };
      return res.recurring;
    },
```

In `app/lib/queries.ts`, change the two imports to:

```ts
import { createApi, type RecurringInput, type TransactionInput } from './api';
import type { Category, Recurring, TargetPeriod, Transaction } from './types';
```

add to `queryKeys`:

```ts
  recurring: ['recurring'] as const,
```

and append at the end of the file:

```ts
export function useRecurring() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.recurring,
    queryFn: () => api.getRecurring(),
    enabled,
  });
}

export function useCreateRecurring() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecurringInput) => api.createRecurring(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useUpdateRecurring() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { recurringId: string; input: RecurringInput }) =>
      api.updateRecurring(vars.recurringId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useDeleteRecurring() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recurringId: string) => api.deleteRecurring(recurringId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

interface SetHandledVars {
  recurringId: string;
  period: string | null;
}

function withHandledPeriod(rows: Recurring[] | undefined, recurringId: string, period: string | null): Recurring[] | undefined {
  return rows?.map(row => (row.recurringId === recurringId ? { ...row, handledPeriod: period } : row));
}

export function useSetRecurringHandled() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<Recurring, Error, SetHandledVars, { previousPeriod: string | null }>({
    mutationFn: (vars) => api.setRecurringHandled(vars.recurringId, vars.period),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: queryKeys.recurring });
      const rows = qc.getQueryData<Recurring[]>(queryKeys.recurring);
      const previousPeriod = rows?.find(row => row.recurringId === vars.recurringId)?.handledPeriod ?? null;
      qc.setQueryData<Recurring[]>(queryKeys.recurring, current => withHandledPeriod(current, vars.recurringId, vars.period));
      return { previousPeriod };
    },
    onError: (_error, vars, context) => {
      if (!context) return;
      qc.setQueryData<Recurring[]>(queryKeys.recurring, current => withHandledPeriod(current, vars.recurringId, context.previousPeriod));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.recurring });
    },
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/api.test.ts app/lib/__tests__/recurringHooks.test.tsx && yarn typecheck && yarn test`
Expected: new tests PASS; typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/lib/types.ts app/lib/api.ts app/lib/queries.ts app/lib/__tests__/api.test.ts app/lib/__tests__/recurringHooks.test.tsx
git commit -q -F - <<'EOF'
feat: add recurring API client and query hooks

Five API calls and hooks under a ['recurring'] key. Marking a period
handled updates the cache immediately and rolls back on failure.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 5: Date helpers and the pure due logic

**Files:**
- Modify: `app/lib/months.ts`, `app/lib/__tests__/months.test.ts`
- Create: `app/lib/recurring.ts`
- Test: `app/lib/__tests__/recurring.test.ts`

**Interfaces:**
- Consumes: `shiftMonth`, `todayIso` from `months.ts`; `normaliseNote` from `noteMemory.ts`; the `Recurring`, `Category`, `Transaction` types.
- Produces: in `months.ts`: `lastDayOfMonth(yearMonth: string): number`, `addDaysIso(iso: string, delta: number): string`, `daysBetweenIso(from: string, to: string): number`, `formatShortDate(iso: string): string`. In `recurring.ts`: `DueStatus`, `DueItem { recurring, period, dueDate, status, daysAway }`, `dueDateFor(period, dayOfMonth)`, `isHandled(recurring, period, transactions)`, `computeDueItems({ recurring, categories, transactions, today })`, `dueLabel(item)`, `formatDayOfMonth(day)`. Tasks 8, 9, 11 and 12 import these.

- [ ] **Step 1: Write the failing tests**

In `app/lib/__tests__/months.test.ts`, change line 2 to:

```ts
import {
  currentYearMonth, shiftMonth, formatMonthLabel, todayIso, yesterdayIso, dateChoiceFor,
  lastDayOfMonth, addDaysIso, daysBetweenIso, formatShortDate,
} from '../months';
```

and append:

```ts
describe('lastDayOfMonth', () => {
  it('handles 31, 30, 28 and leap-year 29 day months', () => {
    expect(lastDayOfMonth('2026-12')).toBe(31);
    expect(lastDayOfMonth('2026-04')).toBe(30);
    expect(lastDayOfMonth('2026-02')).toBe(28);
    expect(lastDayOfMonth('2028-02')).toBe(29);
  });
});

describe('addDaysIso', () => {
  it('moves across month and year boundaries in both directions', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2026-01-01', -3)).toBe('2025-12-29');
    expect(addDaysIso('2026-09-10', 0)).toBe('2026-09-10');
  });
});

describe('daysBetweenIso', () => {
  it('counts whole days, positive when the second date is later', () => {
    expect(daysBetweenIso('2026-09-25', '2026-09-28')).toBe(3);
    expect(daysBetweenIso('2026-09-28', '2026-09-25')).toBe(-3);
    expect(daysBetweenIso('2026-09-28', '2026-09-28')).toBe(0);
  });

  it('is not thrown off by the clocks changing', () => {
    expect(daysBetweenIso('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenIso('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('formatShortDate', () => {
  it('formats as day and abbreviated month', () => {
    expect(formatShortDate('2026-09-28')).toBe('28 Sep');
    expect(formatShortDate('2026-01-05')).toBe('5 Jan');
  });
});
```

Create `app/lib/__tests__/recurring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeDueItems, dueDateFor, dueLabel, formatDayOfMonth, isHandled,
} from '../recurring';
import type { Category, Recurring, Transaction } from '../types';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...over,
  };
}

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 240000, type: 'INCOME', categoryId: 'cat-salary',
    description: 'Salary', date: '2026-09-28', createdAt: '', ...over,
  };
}

function cat(categoryId: string, type: Category['type']): Category {
  return { categoryId, name: categoryId, type, icon: 'x', isDefault: true, createdAt: '' };
}

const categories = [cat('cat-salary', 'INCOME'), cat('cat-housing', 'EXPENSE')];

function due(templates: Recurring[], today: string, transactions: Transaction[] = []) {
  return computeDueItems({ recurring: templates, categories, transactions, today });
}

describe('dueDateFor', () => {
  it('uses the day, clamped to the last day of short months', () => {
    expect(dueDateFor('2026-09', 28)).toBe('2026-09-28');
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28');
    expect(dueDateFor('2028-02', 30)).toBe('2028-02-29');
    expect(dueDateFor('2026-04', 31)).toBe('2026-04-30');
  });
});

describe('isHandled', () => {
  it('is handled when the marker covers the period or a later one', () => {
    expect(isHandled(rec({ handledPeriod: '2026-09' }), '2026-09', [])).toBe(true);
    expect(isHandled(rec({ handledPeriod: '2026-10' }), '2026-09', [])).toBe(true);
    expect(isHandled(rec({ handledPeriod: '2026-08' }), '2026-09', [])).toBe(false);
    expect(isHandled(rec({ handledPeriod: null }), '2026-09', [])).toBe(false);
  });

  it('is handled by a matching transaction in the period', () => {
    expect(isHandled(rec({}), '2026-09', [txn({})])).toBe(true);
  });

  it('matches the note ignoring case and spaces', () => {
    expect(isHandled(rec({ description: 'Salary' }), '2026-09', [txn({ description: '  SALARY ' })])).toBe(true);
  });

  it('matches any note when the template has none', () => {
    expect(isHandled(rec({ description: '' }), '2026-09', [txn({ description: 'Bonus' })])).toBe(true);
  });

  it('is not handled by a different note, type, category or month', () => {
    expect(isHandled(rec({ description: 'Salary' }), '2026-09', [txn({ description: 'Bonus' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ type: 'EXPENSE' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ categoryId: 'cat-housing' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ date: '2026-08-28' })])).toBe(false);
  });
});

describe('computeDueItems visibility', () => {
  it('is hidden before the lead time starts', () => {
    expect(due([rec({})], '2026-09-24')).toEqual([]);
  });

  it('shows from the first lead day as upcoming', () => {
    const [item] = due([rec({})], '2026-09-25');
    expect(item).toMatchObject({ period: '2026-09', dueDate: '2026-09-28', status: 'upcoming', daysAway: 3 });
  });

  it('shows on the due day', () => {
    expect(due([rec({})], '2026-09-28')[0]).toMatchObject({ status: 'today', daysAway: 0 });
  });

  it('stays until the month ends, as overdue', () => {
    expect(due([rec({})], '2026-09-30')[0]).toMatchObject({ status: 'overdue', daysAway: -2 });
  });

  it('drops off in the next month until its own lead time starts', () => {
    expect(due([rec({})], '2026-10-01')).toEqual([]);
    expect(due([rec({})], '2026-10-25')[0]).toMatchObject({ period: '2026-10', status: 'upcoming' });
  });

  it('honours a lead time of zero', () => {
    expect(due([rec({ leadDays: 0 })], '2026-09-27')).toEqual([]);
    expect(due([rec({ leadDays: 0 })], '2026-09-28')[0].status).toBe('today');
  });

  it('honours a lead time of fourteen days across a month boundary', () => {
    const template = rec({ dayOfMonth: 1, leadDays: 14, handledPeriod: '2026-09' });
    expect(due([template], '2026-09-16')).toEqual([]);
    expect(due([template], '2026-09-17')[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01', daysAway: 14 });
  });

  it('clamps the 31st in a short month', () => {
    expect(due([rec({ dayOfMonth: 31 })], '2026-02-28')[0]).toMatchObject({ dueDate: '2026-02-28', status: 'today' });
  });

  it('excludes templates whose category no longer exists', () => {
    expect(due([rec({ categoryId: 'cat-deleted' })], '2026-09-28')).toEqual([]);
  });
});

describe('computeDueItems handled state and one row per template', () => {
  const rent = rec({ recurringId: 'rent', type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', dayOfMonth: 1, leadDays: 3 });

  it('shows the earliest unhandled occurrence only', () => {
    const items = due([rent], '2026-09-28');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ period: '2026-09', status: 'overdue' });
  });

  it('moves on to the next occurrence once the earlier one is handled by a transaction', () => {
    const paid = txn({ type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', date: '2026-09-01' });
    expect(due([rent], '2026-09-28', [paid])[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01', daysAway: 3 });
  });

  it('moves on once the earlier occurrence is skipped', () => {
    expect(due([{ ...rent, handledPeriod: '2026-09' }], '2026-09-28')[0]).toMatchObject({ period: '2026-10' });
  });

  it('hides everything a later marker covers', () => {
    expect(due([{ ...rent, handledPeriod: '2026-10' }], '2026-09-28')).toEqual([]);
  });

  it('clears a due item when the matching transaction is typed in by hand', () => {
    expect(due([rec({})], '2026-09-28', [txn({})])).toEqual([]);
  });
});

describe('computeDueItems ordering', () => {
  it('lists overdue first, then today, then upcoming, soonest first', () => {
    const overdue = rec({ recurringId: 'a', dayOfMonth: 26 });
    const today = rec({ recurringId: 'b', dayOfMonth: 28 });
    const upcoming = rec({ recurringId: 'c', dayOfMonth: 30 });
    const items = due([upcoming, today, overdue], '2026-09-28');
    expect(items.map(item => item.recurring.recurringId)).toEqual(['a', 'b', 'c']);
    expect(items.map(item => item.status)).toEqual(['overdue', 'today', 'upcoming']);
  });

  it('breaks ties by note and then id', () => {
    const items = due([
      rec({ recurringId: 'z', description: 'Bonus' }),
      rec({ recurringId: 'y', description: 'Allowance' }),
    ], '2026-09-28');
    expect(items.map(item => item.recurring.description)).toEqual(['Allowance', 'Bonus']);
  });
});

describe('dueLabel', () => {
  it('describes each status', () => {
    expect(dueLabel({ status: 'today', daysAway: 0 })).toBe('Due today');
    expect(dueLabel({ status: 'upcoming', daysAway: 1 })).toBe('Due in 1 day');
    expect(dueLabel({ status: 'upcoming', daysAway: 3 })).toBe('Due in 3 days');
    expect(dueLabel({ status: 'overdue', daysAway: -1 })).toBe('1 day overdue');
    expect(dueLabel({ status: 'overdue', daysAway: -2 })).toBe('2 days overdue');
  });
});

describe('formatDayOfMonth', () => {
  it('adds the right ordinal suffix', () => {
    const cases: [number, string][] = [
      [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'],
      [21, '21st'], [22, '22nd'], [23, '23rd'], [28, '28th'], [31, '31st'],
    ];
    for (const [day, expected] of cases) expect(formatDayOfMonth(day)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/months.test.ts app/lib/__tests__/recurring.test.ts`
Expected: FAIL. The new helpers and `../recurring` do not exist.

- [ ] **Step 3: Implement**

Append to `app/lib/months.ts`:

```ts

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function lastDayOfMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function addDaysIso(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return todayIso(new Date(year, month - 1, day + delta));
}

export function daysBetweenIso(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const millis = Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay);
  return Math.round(millis / 86_400_000);
}

export function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTH_ABBREVIATIONS[month - 1]}`;
}
```

Create `app/lib/recurring.ts`:

```ts
import { addDaysIso, daysBetweenIso, lastDayOfMonth, shiftMonth } from './months';
import { normaliseNote } from './noteMemory';
import type { Category, Recurring, Transaction } from './types';

export type DueStatus = 'upcoming' | 'today' | 'overdue';

export interface DueItem {
  recurring: Recurring;
  period: string;
  dueDate: string;
  status: DueStatus;
  daysAway: number;
}

export interface ComputeDueInput {
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
  today: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dueDateFor(period: string, dayOfMonth: number): string {
  return `${period}-${pad(Math.min(dayOfMonth, lastDayOfMonth(period)))}`;
}

export function isHandled(recurring: Recurring, period: string, transactions: Transaction[]): boolean {
  if (recurring.handledPeriod !== null && recurring.handledPeriod >= period) return true;

  const note = normaliseNote(recurring.description);
  return transactions.some(t =>
    t.date.slice(0, 7) === period
    && t.type === recurring.type
    && t.categoryId === recurring.categoryId
    && (note === '' || normaliseNote(t.description) === note),
  );
}

function statusFor(daysAway: number): DueStatus {
  if (daysAway > 0) return 'upcoming';
  if (daysAway === 0) return 'today';
  return 'overdue';
}

function compareDue(a: DueItem, b: DueItem): number {
  if (a.daysAway !== b.daysAway) return a.daysAway - b.daysAway;
  const byNote = a.recurring.description.localeCompare(b.recurring.description);
  if (byNote !== 0) return byNote;
  return a.recurring.recurringId.localeCompare(b.recurring.recurringId);
}

export function computeDueItems({ recurring, categories, transactions, today }: ComputeDueInput): DueItem[] {
  const thisMonth = today.slice(0, 7);
  const periods = [thisMonth, shiftMonth(thisMonth, 1)];
  const knownCategories = new Set(categories.map(c => c.categoryId));
  const items: DueItem[] = [];

  for (const template of recurring) {
    if (!knownCategories.has(template.categoryId)) continue;

    for (const period of periods) {
      const dueDate = dueDateFor(period, template.dayOfMonth);
      const visibleFrom = addDaysIso(dueDate, -template.leadDays);
      const visibleUntil = `${period}-${pad(lastDayOfMonth(period))}`;
      if (today < visibleFrom || today > visibleUntil) continue;
      if (isHandled(template, period, transactions)) continue;

      const daysAway = daysBetweenIso(today, dueDate);
      items.push({ recurring: template, period, dueDate, status: statusFor(daysAway), daysAway });
      break;
    }
  }

  return items.sort(compareDue);
}

export function dueLabel(item: Pick<DueItem, 'status' | 'daysAway'>): string {
  if (item.status === 'today') return 'Due today';

  const days = Math.abs(item.daysAway);
  const unit = days === 1 ? 'day' : 'days';
  if (item.status === 'upcoming') return `Due in ${days} ${unit}`;
  return `${days} ${unit} overdue`;
}

export function formatDayOfMonth(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;

  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${day}${suffixes[day % 10] ?? 'th'}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/months.test.ts app/lib/__tests__/recurring.test.ts && yarn typecheck && yarn test`
Expected: all new tests PASS; typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/lib/months.ts app/lib/__tests__/months.test.ts app/lib/recurring.ts app/lib/__tests__/recurring.test.ts
git commit -q -F - <<'EOF'
feat: add the pure recurring due calculation

Occurrence dates clamp to short months, an occurrence shows from its lead
time until month end, and only the earliest unhandled one per template is
listed. Handled means a marker at or past the month, or a matching
transaction.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 6: Extract `ResponsiveSheet`

A behavior-preserving refactor: the Modal-on-wide / Drawer-on-narrow wrapper moves out of `TransactionSheet` so the new form can reuse it. **The sheet's existing tests (including the two class-name Modal/Drawer tests) must pass unchanged.**

**Files:**
- Create: `app/components/layout/ResponsiveSheet.tsx`
- Modify: `app/components/transactions/TransactionSheet.tsx`
- Test: `app/components/layout/__tests__/ResponsiveSheet.test.tsx` (new)

**Interfaces:**
- Consumes: Mantine `Modal`, `Drawer`, `useMantineTheme`; `useMediaQuery` from `@mantine/hooks`.
- Produces: `ResponsiveSheet({ opened, onClose, title, children })`. It renders a centred `Modal` (size 440) at the Mantine `sm` breakpoint and up, and a bottom `Drawer` (`size="auto"`) below it. Used by Tasks 8 and 12.

- [ ] **Step 1: Write the failing test**

Create `app/components/layout/__tests__/ResponsiveSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ResponsiveSheet } from '../ResponsiveSheet';

function renderSheet(opened = true, onClose: () => void = () => {}) {
  return render(
    <MantineProvider>
      <ResponsiveSheet opened={opened} onClose={onClose} title="Test sheet">
        <p>Sheet body</p>
      </ResponsiveSheet>
    </MantineProvider>,
  );
}

describe('ResponsiveSheet', () => {
  it('is a bottom drawer on narrow screens', () => {
    renderSheet();
    expect(document.querySelector('.mantine-Drawer-root')).not.toBeNull();
    expect(document.querySelector('.mantine-Modal-root')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument();
    expect(screen.getByText('Sheet body')).toBeInTheDocument();
  });

  it('is a centred modal on wide screens', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: true })) as typeof window.matchMedia;
    try {
      renderSheet();
      expect(document.querySelector('.mantine-Modal-root')).not.toBeNull();
      expect(document.querySelector('.mantine-Drawer-root')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('renders nothing while closed', () => {
    renderSheet(false);
    expect(screen.queryByText('Sheet body')).not.toBeInTheDocument();
  });

  it('asks to close on Escape', async () => {
    const onClose = vi.fn();
    renderSheet(true, onClose);
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/layout/__tests__/ResponsiveSheet.test.tsx`
Expected: FAIL, cannot resolve `../ResponsiveSheet`.

- [ ] **Step 3: Implement**

Create `app/components/layout/ResponsiveSheet.tsx`:

```tsx
import { Drawer, Modal, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

export interface ResponsiveSheetProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function ResponsiveSheet({ opened, onClose, title, children }: ResponsiveSheetProps) {
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);

  if (isDesktop) {
    return (
      <Modal opened={opened} onClose={onClose} title={title} centered size={440}>
        {children}
      </Modal>
    );
  }

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" title={title}>
      {children}
    </Drawer>
  );
}
```

In `app/components/transactions/TransactionSheet.tsx`:

1. Replace line 2 (`import { Button, Drawer, Group, Modal, SegmentedControl, Stack, Text, TextInput, useMantineTheme } from '@mantine/core';`) with:

```tsx
import { Button, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
```

2. Delete the line `import { useMediaQuery } from '@mantine/hooks';`.
3. Add this import directly above `import { useNoteHistory } from '~/hooks/useNoteHistory';`:

```tsx
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
```

4. Delete these two lines at the top of the component body:

```tsx
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
```

5. Replace everything from `const title = editing ? 'Edit transaction' : 'Add transaction';` to the end of the file with:

```tsx
  const title = editing ? 'Edit transaction' : 'Add transaction';

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={title}>
      {form}
    </ResponsiveSheet>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/layout/__tests__/ResponsiveSheet.test.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: the new tests PASS **and the whole existing sheet test file passes untouched**; typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/ResponsiveSheet.tsx app/components/layout/__tests__/ResponsiveSheet.test.tsx app/components/transactions/TransactionSheet.tsx
git commit -q -F - <<'EOF'
refactor: extract the modal/drawer wrapper from the sheet

ResponsiveSheet renders a centred modal on wide screens and a bottom
drawer below, so the recurring form can share it. No behaviour change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 7: Extract `ToastAction` and `useSaveWithUndo`

A behavior-preserving refactor: the Saved / Undo / Retry logic moves out of `TransactionSheet` so the Due card's Add can reuse it, and the hook now returns the create's outcome so callers can react to it. **The sheet's existing tests (which cover Undo, Undo-before-response, Retry, and Undo-then-failure) must pass unchanged.**

**Files:**
- Create: `app/components/layout/ToastAction.tsx`, `app/hooks/useSaveWithUndo.tsx`
- Modify: `app/components/transactions/TransactionSheet.tsx`
- Test: `app/hooks/__tests__/useSaveWithUndo.test.tsx` (new)

**Interfaces:**
- Consumes: `useCategories`, `useCreateTransaction`, `useDeleteTransaction` from `~/lib/queries`; `formatPence`; `notifications` from `@mantine/notifications`; `TransactionInput` from `~/lib/api`.
- Produces: `ToastAction({ text, actionLabel, onAction })` and `TOAST_MS = 5000` (from `ToastAction.tsx`); `useSaveWithUndo(): (input: TransactionInput) => Promise<Transaction | null>`. The returned function shows the "Saved · Undo" toast immediately and resolves to the **created** transaction, or `null` if the create failed (a "Couldn't save · Retry" toast is shown, unless the user pressed Undo first). Used by Tasks 11 and 12.

- [ ] **Step 1: Write the failing test**

Create `app/hooks/__tests__/useSaveWithUndo.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';

const mockCreate = vi.fn();
const mockRemove = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [{ categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' }],
  }),
  useCreateTransaction: () => ({ mutateAsync: mockCreate }),
  useDeleteTransaction: () => ({ mutate: mockRemove }),
}));

import { useSaveWithUndo } from '../useSaveWithUndo';
import type { Transaction } from '~/lib/types';

function wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider><Notifications />{children}</MantineProvider>;
}

const input = { amount: 480, type: 'EXPENSE' as const, categoryId: 'cat-dining', description: '', date: '2026-09-20' };
const created = { transactionId: 't-real', yearMonth: '2026-09' };

describe('useSaveWithUndo', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockRemove.mockReset();
  });

  afterEach(() => { notifications.clean(); });

  it('shows a Saved toast and resolves to the created transaction', async () => {
    mockCreate.mockResolvedValue(created);
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    let outcome: Transaction | null = null;
    await act(async () => { outcome = await result.current(input); });

    expect(outcome).toEqual(created);
    expect(mockCreate).toHaveBeenCalledWith(input);
    expect(await screen.findByText('Saved £4.80 · Dining')).toBeInTheDocument();
  });

  it('Undo deletes the created transaction from its own month', async () => {
    mockCreate.mockResolvedValue(created);
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-09' }));
  });

  it('resolves to null and offers Retry, which re-sends the same input', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(created);
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    let outcome: Transaction | null = created as Transaction;
    await act(async () => { outcome = await result.current(input); });
    expect(outcome).toBeNull();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenLastCalledWith(input);
  });

  it('does not offer Retry when the user already pressed Undo', async () => {
    let rejectCreate!: (reason: unknown) => void;
    mockCreate.mockReturnValue(new Promise((_resolve, reject) => { rejectCreate = reject; }));
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { void result.current(input); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));
    await act(async () => {
      rejectCreate(new Error('boom'));
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/hooks/__tests__/useSaveWithUndo.test.tsx`
Expected: FAIL, cannot resolve `../useSaveWithUndo`.

- [ ] **Step 3: Implement**

Create `app/components/layout/ToastAction.tsx`:

```tsx
import { Button, Group, Text } from '@mantine/core';

export const TOAST_MS = 5000;

export interface ToastActionProps {
  text: string;
  actionLabel: string;
  onAction: () => void;
}

export function ToastAction({ text, actionLabel, onAction }: ToastActionProps) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm">{text}</Text>
      <Button variant="subtle" size="compact-sm" onClick={onAction}>{actionLabel}</Button>
    </Group>
  );
}
```

Create `app/hooks/useSaveWithUndo.tsx`:

```tsx
import { notifications } from '@mantine/notifications';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import type { TransactionInput } from '~/lib/api';
import { formatPence } from '~/lib/money';
import { useCategories, useCreateTransaction, useDeleteTransaction } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export function useSaveWithUndo(): (input: TransactionInput) => Promise<Transaction | null> {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();

  function describeInput(input: TransactionInput): string {
    const categoryName = categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    return `${formatPence(input.amount)} · ${categoryName}`;
  }

  function showFailureToast(input: TransactionInput): void {
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
            void save(input);
          }}
        />
      ),
    });
  }

  function save(input: TransactionInput): Promise<Transaction | null> {
    const toastId = `saved-${crypto.randomUUID()}`;
    let undone = false;
    const outcome = create.mutateAsync(input).then(
      created => created,
      () => {
        notifications.hide(toastId);
        // A cancelled entry must not offer Retry, or one tap would re-create it.
        if (!undone) showFailureToast(input);
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
            void outcome.then(created => {
              if (!created) return;
              remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
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

In `app/components/transactions/TransactionSheet.tsx`:

1. Delete the line `import { notifications } from '@mantine/notifications';`.
2. Change the money import to `import { formatPencePlain, parsePounds } from '~/lib/money';`.
3. Replace the `~/lib/queries` import block (the multi-line `import { useCategories, useCreateTransaction, useDeleteTransaction, useTransactions, useUpdateTransaction } from '~/lib/queries';`) with:

```tsx
import { useCategories, useTransactions, useUpdateTransaction } from '~/lib/queries';
```

4. Add this import above `import { useSnapshotWhileOpen } ...`:

```tsx
import { useSaveWithUndo } from '~/hooks/useSaveWithUndo';
```

5. Delete `const TOAST_MS = 5000;`.
6. Delete the `interface ToastActionProps { ... }` block and the `function ToastAction(...) { ... }` component.
7. In the component body, delete `const create = useCreateTransaction();` and `const remove = useDeleteTransaction();`, and add this line after `const update = useUpdateTransaction(yearMonth);`:

```tsx
  const saveWithUndo = useSaveWithUndo();
```

8. Delete the three functions `describeInput`, `showFailureToast` and `submitNew`.
9. In `handleSubmit`, replace `submitNew(input);` with:

```tsx
    void saveWithUndo(input);
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/hooks/__tests__/useSaveWithUndo.test.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: the new hook tests PASS **and the whole existing sheet test file passes untouched** (its `~/lib/queries` mock still supplies `useCreateTransaction`, `useDeleteTransaction` and `useCategories` to the hook); typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/ToastAction.tsx app/hooks/useSaveWithUndo.tsx app/hooks/__tests__/useSaveWithUndo.test.tsx app/components/transactions/TransactionSheet.tsx
git commit -q -F - <<'EOF'
refactor: extract the save-with-undo toast logic

useSaveWithUndo shows the Saved/Undo/Retry toasts and resolves to the
created transaction, so the recurring Due card can reuse it. The sheet
behaves exactly as before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 8: Template form validation and `RecurringForm`

**Files:**
- Modify: `app/lib/recurring.ts`, `app/lib/__tests__/recurring.test.ts`
- Create: `app/components/recurring/RecurringForm.tsx`
- Test: `app/components/recurring/__tests__/RecurringForm.test.tsx` (new)

**Interfaces:**
- Consumes: `parsePounds`, `formatPencePlain` from `~/lib/money`; `ResponsiveSheet` (Task 6); `useCategories`, `useCreateRecurring`, `useUpdateRecurring` (Task 4); `TYPE_OPTIONS`, `categoryTypeFor`; `RecurringInput` from `~/lib/api`.
- Produces: in `recurring.ts`: `RecurringFormValues`, `RecurringFormErrors`, `RecurringFormResult`, `validateRecurringForm(values)`. In `RecurringForm.tsx`: `RecurringDraft { type, categoryId, amount (pence), description, dayOfMonth }` and `RecurringForm({ opened, onClose, editing?, draft? })`. `draft` prefills a **new** template (Repeat monthly); `editing` edits an existing one. Callers must pass a **stable** `draft` object (memoised), because it is an effect dependency. Used by Tasks 9 and 10.

- [ ] **Step 1: Write the failing tests**

In `app/lib/__tests__/recurring.test.ts`, change the import from `'../recurring'` to:

```ts
import {
  computeDueItems, dueDateFor, dueLabel, formatDayOfMonth, isHandled, validateRecurringForm,
} from '../recurring';
```

and append:

```ts
describe('validateRecurringForm', () => {
  const values = {
    type: 'INCOME' as const, categoryId: 'cat-salary', amount: '2400.00', description: ' Salary ',
    dayOfMonth: 28 as number | string, leadDays: 3 as number | string,
  };

  it('returns the API input in pence, with the note trimmed', () => {
    expect(validateRecurringForm(values)).toEqual({
      ok: true,
      value: { type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3 },
    });
  });

  it('accepts whole numbers typed as text and both range ends', () => {
    expect(validateRecurringForm({ ...values, dayOfMonth: '1', leadDays: '0' }).ok).toBe(true);
    expect(validateRecurringForm({ ...values, dayOfMonth: 31, leadDays: 14 }).ok).toBe(true);
  });

  it('reports each problem on its own field, all at once', () => {
    const result = validateRecurringForm({ ...values, amount: 'abc', categoryId: null, dayOfMonth: 40, leadDays: 20 });
    expect(result).toEqual({
      ok: false,
      errors: {
        amount: 'Enter a valid amount',
        category: 'Choose a category',
        dayOfMonth: 'Enter a day from 1 to 31',
        leadDays: 'Enter 0 to 14 days',
      },
    });
  });

  it.each([0, 32, 1.5, '', 'abc', -3])('rejects day of month %s', (dayOfMonth) => {
    const result = validateRecurringForm({ ...values, dayOfMonth });
    expect(result.ok === false && result.errors.dayOfMonth).toBe('Enter a day from 1 to 31');
  });

  it.each([-1, 15, 2.5, '', 'x'])('rejects remind days %s', (leadDays) => {
    const result = validateRecurringForm({ ...values, leadDays });
    expect(result.ok === false && result.errors.leadDays).toBe('Enter 0 to 14 days');
  });

  it('reports an empty amount and an overlong note', () => {
    const empty = validateRecurringForm({ ...values, amount: '' });
    expect(empty.ok === false && empty.errors.amount).toBe('Enter an amount');
    const long = validateRecurringForm({ ...values, description: 'a'.repeat(201) });
    expect(long.ok === false && long.errors.description).toBe('Note is too long');
  });
});
```

Create `app/components/recurring/__tests__/RecurringForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Recurring } from '~/lib/types';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
    ],
    isLoading: false,
  }),
  useCreateRecurring: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateRecurring: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

import { RecurringForm, type RecurringDraft, type RecurringFormProps } from '../RecurringForm';

function renderForm(props: Partial<RecurringFormProps> = {}) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <RecurringForm opened onClose={onClose} {...props} />
    </MantineProvider>,
  );
  return { onClose };
}

const draft: RecurringDraft = { type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, description: 'Rent', dayOfMonth: 1 };

const existing: Recurring = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 5, handledPeriod: null, createdAt: '', updatedAt: '',
};

describe('RecurringForm', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({});
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it('shows each problem on its own field and saves nothing', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter an amount')).toBeInTheDocument();
    expect(screen.getByText('Choose a category')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a template in pence with the chosen fields', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm();

    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.type(screen.getByLabelText('Amount'), '2400');
    await user.click(screen.getByPlaceholderText('Choose'));
    await user.keyboard('{ArrowDown}{Enter}');
    const day = screen.getByLabelText('Day of month');
    await user.clear(day);
    await user.type(day, '28');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: '', dayOfMonth: 28, leadDays: 3,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers only categories of the chosen type', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByPlaceholderText('Choose'));
    expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['Housing', 'Food']);

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.click(screen.getByPlaceholderText('Choose'));
    expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['Salary']);
  });

  it('prefills a new template from a draft (Repeat monthly)', async () => {
    const user = userEvent.setup();
    renderForm({ draft });

    expect(screen.getByRole('dialog', { name: 'New recurring item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveValue('950.00');
    expect(screen.getByLabelText(/note/i)).toHaveValue('Rent');
    expect(screen.getByLabelText('Day of month')).toHaveValue('1');
    expect(screen.getByLabelText(/remind me/i)).toHaveValue('3');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, description: 'Rent', dayOfMonth: 1, leadDays: 3,
    }));
  });

  it('edits an existing template', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm({ editing: existing });

    expect(screen.getByRole('dialog', { name: 'Edit recurring item' })).toBeInTheDocument();
    expect(screen.getByLabelText(/remind me/i)).toHaveValue('5');
    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({
      recurringId: 'r1',
      input: { type: 'INCOME', categoryId: 'cat-salary', amount: 250000, description: 'Salary', dayOfMonth: 28, leadDays: 5 },
    }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('reports out-of-range day and reminder on their own fields', async () => {
    const user = userEvent.setup();
    renderForm({ draft });

    const day = screen.getByLabelText('Day of month');
    await user.clear(day);
    await user.type(day, '40');
    const lead = screen.getByLabelText(/remind me/i);
    await user.clear(lead);
    await user.type(lead, '20');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a day from 1 to 31')).toBeInTheDocument();
    expect(screen.getByText('Enter 0 to 14 days')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows a message and stays open when saving fails', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new Error('boom'));
    const { onClose } = renderForm({ draft });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Cancel without saving', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm({ draft });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/recurring.test.ts app/components/recurring/__tests__/RecurringForm.test.tsx`
Expected: FAIL. `validateRecurringForm` and `../RecurringForm` do not exist.

- [ ] **Step 3: Implement**

In `app/lib/recurring.ts`, replace the two import lines at the top with:

```ts
import type { RecurringInput } from './api';
import { parsePounds } from './money';
import { addDaysIso, daysBetweenIso, lastDayOfMonth, shiftMonth } from './months';
import { normaliseNote } from './noteMemory';
import type { Category, Recurring, Transaction, TransactionType } from './types';
```

and append to the file:

```ts

export interface RecurringFormValues {
  type: TransactionType;
  categoryId: string | null;
  amount: string;
  description: string;
  dayOfMonth: number | string;
  leadDays: number | string;
}

export type RecurringFormErrors = Partial<Record<'amount' | 'category' | 'description' | 'dayOfMonth' | 'leadDays', string>>;

export type RecurringFormResult =
  | { ok: true; value: RecurringInput }
  | { ok: false; errors: RecurringFormErrors };

function toWholeNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function validateRecurringForm(values: RecurringFormValues): RecurringFormResult {
  const errors: RecurringFormErrors = {};

  const amount = parsePounds(values.amount);
  if (!amount.ok) errors.amount = amount.message;
  if (!values.categoryId) errors.category = 'Choose a category';

  const day = toWholeNumber(values.dayOfMonth);
  if (day === null || day < 1 || day > 31) errors.dayOfMonth = 'Enter a day from 1 to 31';

  const leadDays = toWholeNumber(values.leadDays);
  if (leadDays === null || leadDays < 0 || leadDays > 14) errors.leadDays = 'Enter 0 to 14 days';

  const description = values.description.trim();
  if (description.length > 200) errors.description = 'Note is too long';

  if (!amount.ok || !values.categoryId || day === null || leadDays === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      type: values.type,
      categoryId: values.categoryId,
      amount: amount.pence,
      description,
      dayOfMonth: day,
      leadDays,
    },
  };
}
```

Create `app/components/recurring/RecurringForm.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { formatPencePlain } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useCategories, useCreateRecurring, useUpdateRecurring } from '~/lib/queries';
import { validateRecurringForm, type RecurringFormErrors } from '~/lib/recurring';
import { TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes';
import type { Recurring, TransactionType } from '~/lib/types';

const DEFAULT_LEAD_DAYS = 3;

export interface RecurringDraft {
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
}

export interface RecurringFormProps {
  opened: boolean;
  onClose: () => void;
  editing?: Recurring | null;
  draft?: RecurringDraft | null;
}

export function RecurringForm({ opened, onClose, editing, draft }: RecurringFormProps) {
  const { data: categories = [] } = useCategories();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState<number | string>(1);
  const [leadDays, setLeadDays] = useState<number | string>(DEFAULT_LEAD_DAYS);
  const [errors, setErrors] = useState<RecurringFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    const source = editing ?? draft ?? null;
    setType(source?.type ?? 'EXPENSE');
    setCategoryId(source?.categoryId ?? null);
    setAmount(source ? formatPencePlain(source.amount) : '');
    setDescription(source?.description ?? '');
    setDayOfMonth(source?.dayOfMonth ?? Number(todayIso().slice(8, 10)));
    setLeadDays(editing?.leadDays ?? DEFAULT_LEAD_DAYS);
    setErrors({});
    setFormError(null);
  }, [opened, editing, draft]);

  const options = categories
    .filter(c => c.type === categoryTypeFor(type))
    .map(c => ({ value: c.categoryId, label: c.name }));
  const pending = create.isPending || update.isPending;

  async function handleSubmit(): Promise<void> {
    const result = validateRecurringForm({ type, categoryId, amount, description, dayOfMonth, leadDays });
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(null);
      return;
    }

    setErrors({});
    try {
      if (editing) {
        await update.mutateAsync({ recurringId: editing.recurringId, input: result.value });
      } else {
        await create.mutateAsync(result.value);
      }
      onClose();
    } catch {
      setFormError('Could not save. Check your connection and try again.');
    }
  }

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={editing ? 'Edit recurring item' : 'New recurring item'}>
      <form onSubmit={e => { e.preventDefault(); void handleSubmit(); }}>
        <Stack>
          <SegmentedControl
            fullWidth
            value={type}
            onChange={value => { setType(value as TransactionType); setCategoryId(null); }}
            data={TYPE_OPTIONS}
          />
          <TextInput
            label="Amount"
            placeholder="0.00"
            leftSection="£"
            inputMode="decimal"
            data-autofocus
            value={amount}
            onChange={e => setAmount(e.currentTarget.value)}
            error={errors.amount}
          />
          <Select
            label="Category"
            placeholder="Choose"
            searchable
            data={options}
            value={categoryId}
            onChange={setCategoryId}
            error={errors.category}
          />
          <TextInput
            label="Note (optional)"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            maxLength={200}
            error={errors.description}
          />
          <Group grow align="flex-start">
            <NumberInput
              label="Day of month"
              min={1}
              max={31}
              allowDecimal={false}
              clampBehavior="none"
              value={dayOfMonth}
              onChange={setDayOfMonth}
              error={errors.dayOfMonth}
            />
            <NumberInput
              label="Remind me (days before)"
              min={0}
              max={14}
              allowDecimal={false}
              clampBehavior="none"
              value={leadDays}
              onChange={setLeadDays}
              error={errors.leadDays}
            />
          </Group>
          {formError && <Text size="sm" c="danger">{formError}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </Group>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/recurring.test.ts app/components/recurring/__tests__/RecurringForm.test.tsx && yarn typecheck && yarn test`
Expected: all new tests PASS; typecheck clean; whole suite passes, output pristine. If a `NumberInput` value assertion fails because Mantine renders the value differently, assert on the rendered input's `value` attribute and say so in the report; do not weaken what is checked. If the category `Select` keyboard step does not open the list in jsdom, mirror the pattern in `TransactionSheet.test.tsx` and report what changed.

- [ ] **Step 5: Commit**

```bash
git add app/lib/recurring.ts app/lib/__tests__/recurring.test.ts app/components/recurring/RecurringForm.tsx app/components/recurring/__tests__/RecurringForm.test.tsx
git commit -q -F - <<'EOF'
feat: add the recurring template form

One form for new, edit and repeat-monthly drafts, with a pure validator
that reports each problem on its own field.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 9: The Recurring page and sidebar link

**Files:**
- Modify: `app/lib/transactionTypes.ts`, `app/lib/__tests__/transactionTypes.test.ts`, `app/components/layout/DefaultLayout.tsx`, `app/components/layout/__tests__/DefaultLayout.test.tsx`
- Create: `app/routes/recurring.tsx`
- Test: `app/routes/__tests__/recurring.test.tsx` (new)

**Interfaces:**
- Consumes: `useRecurring`, `useCategories`, `useDeleteRecurring` (Task 4); `RecurringForm` (Task 8); `formatDayOfMonth` (Task 5); `getCategoryIcon` from `~/lib/categoryIcons`.
- Produces: `formatSignedPence(type: TransactionType, pence: number): string` (a `−` for `EXPENSE` and `INVESTMENT_IN`, a `+` otherwise; the minus is U+2212, matching `TransactionRow`); the `/recurring` route; a sidebar-only "Recurring" link. Task 12 reuses `formatSignedPence`.

- [ ] **Step 1: Write the failing tests**

In `app/lib/__tests__/transactionTypes.test.ts`, change the import to `import { categoryTypeFor, formatSignedPence } from '../transactionTypes';` and append:

```ts
describe('formatSignedPence', () => {
  it('shows outgoing types with a minus and incoming types with a plus', () => {
    expect(formatSignedPence('EXPENSE', 480)).toBe('−£4.80');
    expect(formatSignedPence('INVESTMENT_IN', 10000)).toBe('−£100.00');
    expect(formatSignedPence('INCOME', 240000)).toBe('+£2,400.00');
    expect(formatSignedPence('INVESTMENT_OUT', 5000)).toBe('+£50.00');
  });
});
```

In `app/components/layout/__tests__/DefaultLayout.test.tsx`, append inside the existing `describe`:

```tsx
  it('links to Recurring from the sidebar only, not the bottom tab bar', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: 'Recurring' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/recurring');
  });
```

Create `app/routes/__tests__/recurring.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, Recurring } from '~/lib/types';

const mockDelete = vi.fn();
const mockRefetch = vi.fn();
let mockQuery: { data?: Recurring[]; isLoading: boolean; error: Error | null };

const categories: Category[] = [
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
  { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'home', isDefault: true, createdAt: '' },
];

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...over,
  };
}

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/recurring/RecurringForm', () => ({
  RecurringForm: ({ opened, editing }: { opened: boolean; editing?: { description: string } | null }) =>
    opened ? <div>{editing ? `Form editing ${editing.description}` : 'Form new'}</div> : null,
}));
vi.mock('~/lib/queries', () => ({
  useRecurring: () => ({ ...mockQuery, refetch: mockRefetch }),
  useCategories: () => ({ data: categories }),
  useDeleteRecurring: () => ({ mutate: mockDelete }),
}));

import RecurringPage from '../recurring';

function renderPage() {
  return render(
    <MantineProvider>
      <RecurringPage />
    </MantineProvider>,
  );
}

describe('Recurring page', () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockRefetch.mockReset();
    mockQuery = { data: [], isLoading: false, error: null };
  });

  it('lists templates by day of month with their schedule and signed amount', () => {
    mockQuery.data = [
      rec({ recurringId: 'a', description: 'Salary', dayOfMonth: 28, leadDays: 3 }),
      rec({ recurringId: 'b', description: 'Rent', type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, dayOfMonth: 1, leadDays: 1 }),
    ];
    renderPage();

    const schedules = screen.getAllByText(/Monthly on the/).map(node => node.textContent);
    expect(schedules).toEqual([
      'Monthly on the 1st · remind 1 day before',
      'Monthly on the 28th · remind 3 days before',
    ]);
    expect(screen.getByText('−£950.00')).toBeInTheDocument();
    expect(screen.getByText('+£2,400.00')).toBeInTheDocument();
  });

  it('says so when there is no early reminder', () => {
    mockQuery.data = [rec({ leadDays: 0 })];
    renderPage();
    expect(screen.getByText('Monthly on the 28th · no early reminder')).toBeInTheDocument();
  });

  it('flags a template whose category was deleted', () => {
    mockQuery.data = [rec({ categoryId: 'cat-gone', description: 'Old gym' })];
    renderPage();
    expect(screen.getByText('Old gym')).toBeInTheDocument();
    expect(screen.getByText('Category deleted')).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderPage();
    expect(screen.getByText(/no recurring items yet/i)).toBeInTheDocument();
  });

  it('opens the form for a new item', async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /new/i }));
    expect(screen.getByText('Form new')).toBeInTheDocument();
  });

  it('opens the form to edit an item from its menu', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({})];
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(screen.getByText('Form editing Salary')).toBeInTheDocument();
  });

  it('deletes an item from its menu', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('r9');
  });

  it('offers a retry when loading fails', async () => {
    mockQuery = { data: undefined, isLoading: false, error: new Error('boom') };
    renderPage();
    await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/lib/__tests__/transactionTypes.test.ts app/routes/__tests__/recurring.test.tsx app/components/layout/__tests__/DefaultLayout.test.tsx`
Expected: FAIL. `formatSignedPence` and the route do not exist, and the layout has no Recurring link.

- [ ] **Step 3: Implement**

In `app/lib/transactionTypes.ts`, change the imports to:

```ts
import { formatPence } from './money';
import type { CategoryType, TransactionType } from './types';
```

and append:

```ts

const OUTGOING_TYPES: ReadonlySet<TransactionType> = new Set<TransactionType>(['EXPENSE', 'INVESTMENT_IN']);

export function formatSignedPence(type: TransactionType, pence: number): string {
  return `${OUTGOING_TYPES.has(type) ? '−' : '+'}${formatPence(pence)}`;
}
```

Create `app/routes/recurring.tsx`:

```tsx
import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Loader, Menu, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { RecurringForm } from '~/components/recurring/RecurringForm';
import { getCategoryIcon } from '~/lib/categoryIcons';
import { useCategories, useDeleteRecurring, useRecurring } from '~/lib/queries';
import { formatDayOfMonth } from '~/lib/recurring';
import { formatSignedPence } from '~/lib/transactionTypes';
import type { Category, Recurring } from '~/lib/types';

function scheduleText(item: Recurring): string {
  const day = `Monthly on the ${formatDayOfMonth(item.dayOfMonth)}`;
  if (item.leadDays === 0) return `${day} · no early reminder`;
  return `${day} · remind ${item.leadDays} ${item.leadDays === 1 ? 'day' : 'days'} before`;
}

function byDay(a: Recurring, b: Recurring): number {
  if (a.dayOfMonth !== b.dayOfMonth) return a.dayOfMonth - b.dayOfMonth;
  return a.description.localeCompare(b.description);
}

interface RecurringRowProps {
  item: Recurring;
  category: Category | undefined;
  onEdit: (item: Recurring) => void;
  onDelete: (item: Recurring) => void;
}

function RecurringRow({ item, category, onEdit, onDelete }: RecurringRowProps) {
  const label = item.description || category?.name || 'Recurring item';
  const Icon = getCategoryIcon(category?.icon ?? 'tag');

  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
          <Icon size={18} stroke={1.6} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text truncate>{label}</Text>
          <Text size="xs" c="dimmed">{scheduleText(item)}</Text>
          {!category && <Text size="xs" c="danger">Category deleted</Text>}
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{formatSignedPence(item.type, item.amount)}</Text>
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(item)}>Edit</Menu.Item>
            <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(item)}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}

function RecurringContent() {
  const recurring = useRecurring();
  const categories = useCategories();
  const remove = useDeleteRecurring();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);

  if (recurring.error) {
    return (
      <Alert color="danger" title="Could not load recurring items">
        <Button onClick={() => recurring.refetch()}>Try again</Button>
      </Alert>
    );
  }

  if (recurring.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const items = [...(recurring.data ?? [])].sort(byDay);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Recurring</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>New</Button>
      </Group>

      {items.length === 0 && (
        <Text c="dimmed">No recurring items yet. Use Repeat monthly on a transaction, or add one here.</Text>
      )}

      {items.map(item => (
        <RecurringRow
          key={item.recurringId}
          item={item}
          category={categories.data?.find(c => c.categoryId === item.categoryId)}
          onEdit={setEditing}
          onDelete={target => remove.mutate(target.recurringId)}
        />
      ))}

      <RecurringForm
        opened={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        editing={editing}
      />
    </Stack>
  );
}

export default function RecurringPage() {
  return (
    <DefaultLayout>
      <RecurringContent />
    </DefaultLayout>
  );
}
```

In `app/components/layout/DefaultLayout.tsx`:

1. Change the tabler import to `import { IconHome, IconList, IconRepeat, IconTarget, IconPlus, IconTag } from '@tabler/icons-react';`.
2. Add after the `NAV_ITEMS` array:

```tsx

const SIDEBAR_ONLY_ITEMS = [
  { to: '/recurring', label: 'Recurring', Icon: IconRepeat },
];
```

3. In `SidebarNav`, replace `{NAV_ITEMS.map(({ to, label, Icon }) => (` with:

```tsx
      {[...NAV_ITEMS, ...SIDEBAR_ONLY_ITEMS].map(({ to, label, Icon }) => (
```

(`BottomTabs` keeps mapping only `NAV_ITEMS`, so the tab bar stays at four tabs.)

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/lib/__tests__/transactionTypes.test.ts app/routes/__tests__/recurring.test.tsx app/components/layout/__tests__/DefaultLayout.test.tsx && yarn typecheck && yarn test`
Expected: all new tests PASS; typecheck clean (react-router typegen picks up the new route file); whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/lib/transactionTypes.ts app/lib/__tests__/transactionTypes.test.ts app/routes/recurring.tsx app/routes/__tests__/recurring.test.tsx app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/DefaultLayout.test.tsx
git commit -q -F - <<'EOF'
feat: add the Recurring page and sidebar link

Lists templates by day of month with their schedule, flags a deleted
category, and offers New, Edit and Delete. Linked from the desktop
sidebar only, so the bottom tab bar stays at four tabs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 10: "Repeat monthly" in the row menu

**Files:**
- Modify: `app/components/transactions/TransactionRow.tsx`, `app/routes/transactions.tsx`
- Test: `app/components/transactions/__tests__/TransactionRow.test.tsx`, `app/routes/__tests__/transactions.test.tsx`

**Interfaces:**
- Consumes: `RecurringForm`, `RecurringDraft` (Task 8).
- Produces: `TransactionRow` prop `onRepeat?: (t: Transaction) => void` and a "Repeat monthly" menu item; a `repeating` state in the Transactions route that opens `RecurringForm` with a `draft` built from the transaction.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('TransactionRow menu', ...)` block of `app/components/transactions/__tests__/TransactionRow.test.tsx`:

```tsx
  it('offers Repeat monthly and reports the transaction', async () => {
    const user = userEvent.setup();
    const onRepeat = vi.fn();
    renderRow({ onEdit: vi.fn(), onRepeat });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Repeat monthly' }));

    expect(onRepeat).toHaveBeenCalledWith(transaction);
  });

  it('omits Repeat monthly when no handler is given', async () => {
    const user = userEvent.setup();
    renderRow({ onEdit: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await screen.findByRole('menuitem', { name: 'Edit' });

    expect(screen.queryByRole('menuitem', { name: 'Repeat monthly' })).not.toBeInTheDocument();
  });
```

In `app/routes/__tests__/transactions.test.tsx`, add this mock beside the other `vi.mock` calls (before the `import Transactions` line):

```tsx
vi.mock('~/components/recurring/RecurringForm', () => ({
  RecurringForm: ({ opened, draft }: { opened: boolean; draft?: { description: string; dayOfMonth: number } | null }) =>
    opened ? <div>{`Repeat draft: ${draft?.description} on day ${draft?.dayOfMonth}`}</div> : null,
}));
```

and append a new `describe` at the end of the file:

```tsx
describe('Transactions route repeat monthly', () => {
  it('opens the recurring form prefilled from a row, using the day of its date', async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Shop' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Repeat monthly' }));

    expect(screen.getByText('Repeat draft: Weekly Shop on day 10')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionRow.test.tsx app/routes/__tests__/transactions.test.tsx`
Expected: FAIL. There is no Repeat monthly item.

- [ ] **Step 3: Implement**

In `app/components/transactions/TransactionRow.tsx`:

1. Change the icon import to `import { IconCopy, IconDots, IconPencil, IconRepeat, IconTrash } from '@tabler/icons-react';`.
2. Add `onRepeat,` after `onDuplicate,` in the destructured props, and `onRepeat?: (t: Transaction) => void;` after the `onDuplicate?: ...` line in the props type.
3. Change `(onEdit || onDelete || onDuplicate)` to `(onEdit || onDelete || onDuplicate || onRepeat)`.
4. Add after the `{onDuplicate && ...}` menu item line:

```tsx
              {onRepeat && <Menu.Item leftSection={<IconRepeat size={14} />} onClick={() => onRepeat(transaction)}>Repeat monthly</Menu.Item>}
```

In `app/routes/transactions.tsx`:

1. Change the react import to `import { useMemo, useState } from 'react';`.
2. Add these imports with the other component imports:

```tsx
import { RecurringForm, type RecurringDraft } from '~/components/recurring/RecurringForm';
```

3. Add after the `duplicating` state (all hooks stay above the early returns):

```tsx
  const [repeating, setRepeating] = useState<Transaction | null>(null);
  const repeatDraft = useMemo<RecurringDraft | null>(() => (
    repeating
      ? {
          type: repeating.type,
          categoryId: repeating.categoryId,
          amount: repeating.amount,
          description: repeating.description,
          dayOfMonth: Number(repeating.date.slice(8, 10)),
        }
      : null
  ), [repeating]);
```

4. Add `onRepeat={setRepeating}` to the `<TransactionRow ... />` props (after `onDuplicate={setDuplicating}`).
5. Add after the `<TransactionSheet ... />` element:

```tsx
      <RecurringForm opened={repeating !== null} onClose={() => setRepeating(null)} draft={repeatDraft} />
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionRow.test.tsx app/routes/__tests__/transactions.test.tsx && yarn typecheck && yarn test`
Expected: new tests PASS (and the existing search and Duplicate route tests still pass); typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/TransactionRow.tsx app/routes/transactions.tsx app/components/transactions/__tests__/TransactionRow.test.tsx app/routes/__tests__/transactions.test.tsx
git commit -q -F - <<'EOF'
feat: add Repeat monthly to the transaction row menu

Opens the recurring form prefilled from the transaction: its type,
category, amount, note and the day of month from its date.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 11: Sheet `templateDate` / `onSaved`, and `useDueRecurring`

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx`, `app/components/transactions/__tests__/TransactionSheet.test.tsx`
- Create: `app/hooks/useDueRecurring.ts`
- Test: `app/hooks/__tests__/useDueRecurring.test.ts` (new)

**Interfaces:**
- Consumes: `useSaveWithUndo` (Task 7, returns `Promise<Transaction | null>`); `computeDueItems`, `DueItem` (Task 5); `useRecurring`, `useCategories`, `useTransactions` (Task 4 and existing).
- Produces: `TransactionSheetProps.templateDate?: string` (overrides the "today" that `template` normally uses) and `onSaved?: (created: Transaction) => void` (called only after a create **succeeds**); `useDueRecurring(): { items: DueItem[]; isLoading: boolean; error: Error | null; refetch: () => void }`. Used by Task 12.

- [ ] **Step 1: Write the failing tests**

In `app/components/transactions/__tests__/TransactionSheet.test.tsx`, add inside the `describe('TransactionSheet', ...)` block:

```tsx
  it('uses the template date instead of today when one is given', async () => {
    const user = userEvent.setup();
    renderSheet({ template: editing, templateDate: '2026-10-01' });

    expect(screen.getByRole('radio', { name: 'Other…' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-01' }));
  });

  it('selects Today when the template date is today', () => {
    renderSheet({ template: editing, templateDate: todayIso() });
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();
  });

  it('reports the created transaction through onSaved after a successful create', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderSheet({ template: editing, onSaved });

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' }));
  });

  it('does not call onSaved when the create fails', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();
    renderSheet({ template: editing, onSaved });

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(onSaved).not.toHaveBeenCalled();
  });
```

Create `app/hooks/__tests__/useDueRecurring.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Category, Recurring, Transaction } from '~/lib/types';

interface QueryState<T> { data?: T; isLoading: boolean; error?: Error | null; refetch?: () => void }

const mockRefetch = vi.fn();
let recurringState: QueryState<Recurring[]>;
let categoriesState: QueryState<Category[]>;
let monthStates: Record<string, QueryState<Transaction[]>>;
const requestedMonths: string[] = [];

vi.mock('~/lib/queries', () => ({
  useRecurring: () => recurringState,
  useCategories: () => categoriesState,
  useTransactions: (month: string) => {
    requestedMonths.push(month);
    return monthStates[month] ?? { data: undefined, isLoading: false };
  },
}));

import { useDueRecurring } from '../useDueRecurring';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...over,
  };
}

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 240000, type: 'INCOME', categoryId: 'cat-salary',
    description: 'Salary', date: '2026-09-28', createdAt: '', ...over,
  };
}

const categories: Category[] = [
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
];

describe('useDueRecurring', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 28));
    mockRefetch.mockReset();
    requestedMonths.length = 0;
    recurringState = { data: [rec({})], isLoading: false, error: null, refetch: mockRefetch };
    categoriesState = { data: categories, isLoading: false };
    monthStates = { '2026-09': { data: [], isLoading: false }, '2026-10': { data: [], isLoading: false } };
  });

  afterEach(() => { vi.useRealTimers(); });

  it('asks for today\'s month and the next month of transactions', () => {
    renderHook(() => useDueRecurring());
    expect(requestedMonths).toContain('2026-09');
    expect(requestedMonths).toContain('2026-10');
  });

  it('computes the due items from the templates and today\'s local date', () => {
    const { result } = renderHook(() => useDueRecurring());
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ status: 'today', dueDate: '2026-09-28', period: '2026-09' });
  });

  it('drops an item that a transaction this month already covers', () => {
    monthStates['2026-09'] = { data: [txn({})], isLoading: false };
    const { result } = renderHook(() => useDueRecurring());
    expect(result.current.items).toEqual([]);
  });

  it('uses next month\'s transactions for an occurrence that falls next month', () => {
    recurringState = {
      data: [rec({ recurringId: 'rent', type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', dayOfMonth: 1, handledPeriod: '2026-09' })],
      isLoading: false, error: null, refetch: mockRefetch,
    };
    const { result: unpaid } = renderHook(() => useDueRecurring());
    expect(unpaid.current.items[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01' });

    monthStates['2026-10'] = {
      data: [txn({ type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', date: '2026-10-01', yearMonth: '2026-10' })],
      isLoading: false,
    };
    const { result: paid } = renderHook(() => useDueRecurring());
    expect(paid.current.items).toEqual([]);
  });

  it('is loading while any of its sources is loading', () => {
    monthStates['2026-10'] = { data: undefined, isLoading: true };
    expect(renderHook(() => useDueRecurring()).result.current.isLoading).toBe(true);

    monthStates['2026-10'] = { data: [], isLoading: false };
    recurringState = { data: undefined, isLoading: true, error: null, refetch: mockRefetch };
    expect(renderHook(() => useDueRecurring()).result.current.isLoading).toBe(true);
  });

  it('surfaces a templates error and can refetch them', () => {
    const boom = new Error('boom');
    recurringState = { data: undefined, isLoading: false, error: boom, refetch: mockRefetch };
    const { result } = renderHook(() => useDueRecurring());

    expect(result.current.error).toBe(boom);
    result.current.refetch();
    expect(mockRefetch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/hooks/__tests__/useDueRecurring.test.ts app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL. The hook does not exist, and the sheet ignores `templateDate` and `onSaved`.

- [ ] **Step 3: Implement**

Create `app/hooks/useDueRecurring.ts`:

```ts
import { useMemo } from 'react';
import { shiftMonth, todayIso } from '~/lib/months';
import { useCategories, useRecurring, useTransactions } from '~/lib/queries';
import { computeDueItems, type DueItem } from '~/lib/recurring';

export interface DueRecurringState {
  items: DueItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useDueRecurring(): DueRecurringState {
  const recurring = useRecurring();
  const categories = useCategories();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const current = useTransactions(thisMonth);
  const next = useTransactions(shiftMonth(thisMonth, 1));

  const items = useMemo(() => computeDueItems({
    recurring: recurring.data ?? [],
    categories: categories.data ?? [],
    transactions: [...(current.data ?? []), ...(next.data ?? [])],
    today,
  }), [recurring.data, categories.data, current.data, next.data, today]);

  return {
    items,
    isLoading: recurring.isLoading || categories.isLoading || current.isLoading || next.isLoading,
    error: recurring.error ?? null,
    refetch: () => { void recurring.refetch(); },
  };
}
```

In `app/components/transactions/TransactionSheet.tsx`:

1. In `TransactionSheetProps`, add after `template?: Transaction | null;`:

```tsx
  templateDate?: string;
  onSaved?: (created: Transaction) => void;
```

2. Change the signature to:

```tsx
export function TransactionSheet({ opened, onClose, yearMonth, editing, template, templateDate, onSaved }: TransactionSheetProps) {
```

3. In the reset effect's `template` branch, replace these three lines:

```tsx
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('user');
```

with:

```tsx
      setDate(templateDate ?? todayIso());
      setDateChoice(templateDate ? dateChoiceFor(templateDate) : 'today');
      setCategorySource('user');
```

4. Change that effect's dependency array from `[opened, editing, template]` to `[opened, editing, template, templateDate]`.

5. In `handleSubmit`, replace `void saveWithUndo(input);` with:

```tsx
    void saveWithUndo(input).then(created => {
      if (created) onSaved?.(created);
    });
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/hooks/__tests__/useDueRecurring.test.ts app/components/transactions/__tests__/TransactionSheet.test.tsx && yarn typecheck && yarn test`
Expected: new tests PASS and all existing sheet tests pass unchanged; typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useDueRecurring.ts app/hooks/__tests__/useDueRecurring.test.ts app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -q -F - <<'EOF'
feat: add useDueRecurring and sheet templateDate/onSaved

The hook composes templates, categories and this and next month's
transactions into due items. The sheet can open on a given date and
reports the created transaction once a save succeeds.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 12: The Due card and Home

**Files:**
- Create: `app/components/recurring/DueRecurringCard.tsx`
- Modify: `app/routes/_index.tsx`
- Test: `app/components/recurring/__tests__/DueRecurringCard.test.tsx` (new), `app/routes/__tests__/index.test.tsx` (new)

**Interfaces:**
- Consumes: `useDueRecurring` (Task 11), `useSaveWithUndo` and `ToastAction`/`TOAST_MS` (Task 7), `useSetRecurringHandled` (Task 4), `dueLabel`, `DueItem` (Task 5), `formatShortDate` (Task 5), `formatSignedPence` (Task 9), the sheet's `template`/`templateDate`/`onSaved` (Task 11).
- Produces: `DueRecurringCard()` (no props) rendered at the top of Home, and a "Manage recurring" link at the bottom of Home. Behaviour: **Add** calls `saveWithUndo` with the template's fields and the **due date**; **Edit** opens the add sheet prefilled (template values, due date) and marks the occurrence handled after that save; **Skip** marks the period handled and shows a "Skipped · Undo" toast whose Undo restores the previous `handledPeriod`.

- [ ] **Step 1: Write the failing tests**

Create `app/components/recurring/__tests__/DueRecurringCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router';
import type { DueItem } from '~/lib/recurring';
import type { Recurring } from '~/lib/types';

const mockSave = vi.fn();
const mockHandled = vi.fn();
const mockRefetch = vi.fn();
let dueState: { items: DueItem[]; isLoading: boolean; error: Error | null; refetch: () => void };

vi.mock('~/hooks/useDueRecurring', () => ({ useDueRecurring: () => dueState }));
vi.mock('~/hooks/useSaveWithUndo', () => ({ useSaveWithUndo: () => mockSave }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
      { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'home', isDefault: true, createdAt: '' },
    ],
  }),
  useSetRecurringHandled: () => ({ mutate: mockHandled }),
}));
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, template, templateDate, onSaved }: {
    opened: boolean;
    template?: { description: string; amount: number } | null;
    templateDate?: string;
    onSaved?: (created: unknown) => void;
  }) => (opened
    ? (
      <div>
        <span>{`Sheet ${template?.description} ${template?.amount} on ${templateDate}`}</span>
        <button onClick={() => onSaved?.({})}>simulate saved</button>
      </div>
    )
    : null),
}));

import { DueRecurringCard } from '../DueRecurringCard';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: '2026-08', createdAt: '', updatedAt: '', ...over,
  };
}

function item(over: Partial<DueItem> = {}, template: Partial<Recurring> = {}): DueItem {
  return {
    recurring: rec(template), period: '2026-09', dueDate: '2026-09-28', status: 'today', daysAway: 0, ...over,
  };
}

function renderCard() {
  return render(
    <MantineProvider>
      <Notifications />
      <MemoryRouter>
        <DueRecurringCard />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('DueRecurringCard', () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockHandled.mockReset();
    mockRefetch.mockReset();
    dueState = { items: [item()], isLoading: false, error: null, refetch: mockRefetch };
  });

  afterEach(() => { notifications.clean(); });

  it('lists each due item with its status, date and signed amount', () => {
    dueState.items = [
      item({ status: 'overdue', daysAway: -2, dueDate: '2026-09-26' }, { recurringId: 'a', description: 'Rent', type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000 }),
      item({ status: 'upcoming', daysAway: 2, dueDate: '2026-09-30' }, { recurringId: 'b' }),
    ];
    renderCard();

    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('2 days overdue · 26 Sep')).toBeInTheDocument();
    expect(screen.getByText('−£950.00')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
    expect(screen.getByText('Due in 2 days · 30 Sep')).toBeInTheDocument();
    expect(screen.getByText('+£2,400.00')).toBeInTheDocument();
  });

  it('renders nothing when nothing is due or while loading', () => {
    dueState = { items: [], isLoading: false, error: null, refetch: mockRefetch };
    const { container, unmount } = renderCard();
    expect(container.textContent).toBe('');
    unmount();

    dueState = { items: [item()], isLoading: true, error: null, refetch: mockRefetch };
    expect(renderCard().container.textContent).toBe('');
  });

  it('shows a compact error with a retry when the templates fail to load', async () => {
    dueState = { items: [], isLoading: false, error: new Error('boom'), refetch: mockRefetch };
    renderCard();
    await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('links to the Recurring page', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/recurring');
  });

  it('Add saves the template on its due date, through the undoable save', async () => {
    renderCard();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add Salary' }));

    expect(mockSave).toHaveBeenCalledWith({
      amount: 240000, type: 'INCOME', categoryId: 'cat-salary', description: 'Salary', date: '2026-09-28',
    });
    expect(mockHandled).not.toHaveBeenCalled();
  });

  it('Skip marks the period handled and its Undo restores the previous marker', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Skip' }));

    expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-09' });
    expect(await screen.findByText('Skipped Salary')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(mockHandled).toHaveBeenLastCalledWith({ recurringId: 'r1', period: '2026-08' });
  });

  it('Skip\'s Undo can restore an empty marker', async () => {
    const user = userEvent.setup();
    dueState.items = [item({}, { handledPeriod: null })];
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(mockHandled).toHaveBeenLastCalledWith({ recurringId: 'r1', period: null });
  });

  it('Edit opens the add sheet prefilled on the due date, and marks it handled once saved', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(screen.getByText('Sheet Salary 240000 on 2026-09-28')).toBeInTheDocument();
    expect(mockHandled).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'simulate saved' }));

    await waitFor(() => expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-09' }));
  });
});
```

Create `app/routes/__tests__/index.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/recurring/DueRecurringCard', () => ({ DueRecurringCard: () => <div>Due card</div> }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useTransactions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

import Home from '../_index';

function renderHome() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('Home', () => {
  it('shows the Due card above the month header', () => {
    renderHome();
    const card = screen.getByText('Due card');
    const header = screen.getByRole('heading', { level: 3 });
    expect(card.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('always links to the Recurring page', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'Manage recurring' })).toHaveAttribute('href', '/recurring');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/recurring/__tests__/DueRecurringCard.test.tsx app/routes/__tests__/index.test.tsx`
Expected: FAIL. The card does not exist, and Home has neither the card nor the link.

- [ ] **Step 3: Implement**

Create `app/components/recurring/DueRecurringCard.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Button, Card, Group, Menu, Text, ThemeIcon, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPencil } from '@tabler/icons-react';
import { Link } from 'react-router';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useDueRecurring } from '~/hooks/useDueRecurring';
import { useSaveWithUndo } from '~/hooks/useSaveWithUndo';
import { getCategoryIcon } from '~/lib/categoryIcons';
import { currentYearMonth, formatShortDate } from '~/lib/months';
import { useCategories, useSetRecurringHandled } from '~/lib/queries';
import { dueLabel, type DueItem } from '~/lib/recurring';
import { formatSignedPence } from '~/lib/transactionTypes';
import type { Transaction } from '~/lib/types';

function syntheticTransaction(item: DueItem): Transaction {
  const { recurring } = item;
  return {
    transactionId: `recurring-${recurring.recurringId}`,
    yearMonth: item.period,
    amount: recurring.amount,
    type: recurring.type,
    categoryId: recurring.categoryId,
    description: recurring.description,
    date: item.dueDate,
    createdAt: '',
  };
}

export function DueRecurringCard() {
  const { items, isLoading, error, refetch } = useDueRecurring();
  const { data: categories = [] } = useCategories();
  const saveWithUndo = useSaveWithUndo();
  const setHandled = useSetRecurringHandled();
  const [editing, setEditing] = useState<DueItem | null>(null);
  const template = useMemo(() => (editing ? syntheticTransaction(editing) : null), [editing]);

  function labelFor(item: DueItem): string {
    const category = categories.find(c => c.categoryId === item.recurring.categoryId);
    return item.recurring.description || category?.name || 'Recurring item';
  }

  function markHandled(item: DueItem): void {
    setHandled.mutate({ recurringId: item.recurring.recurringId, period: item.period });
  }

  function add(item: DueItem): void {
    const { recurring, dueDate } = item;
    void saveWithUndo({
      amount: recurring.amount,
      type: recurring.type,
      categoryId: recurring.categoryId,
      description: recurring.description,
      date: dueDate,
    });
  }

  function skip(item: DueItem): void {
    const { recurringId } = item.recurring;
    const previousPeriod = item.recurring.handledPeriod;
    markHandled(item);

    const toastId = `skipped-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      autoClose: TOAST_MS,
      message: (
        <ToastAction
          text={`Skipped ${labelFor(item)}`}
          actionLabel="Undo"
          onAction={() => {
            notifications.hide(toastId);
            setHandled.mutate({ recurringId, period: previousPeriod });
          }}
        />
      ),
    });
  }

  let card: React.ReactNode = null;
  if (error) {
    card = (
      <Alert color="danger" title="Could not load recurring items">
        <Button size="compact-sm" onClick={refetch}>Try again</Button>
      </Alert>
    );
  } else if (!isLoading && items.length > 0) {
    card = (
      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Title order={5}>Due</Title>
          <Anchor component={Link} to="/recurring" size="sm">Manage</Anchor>
        </Group>
        {items.map(item => {
          const Icon = getCategoryIcon(categories.find(c => c.categoryId === item.recurring.categoryId)?.icon ?? 'tag');
          const label = labelFor(item);
          return (
            <Group key={item.recurring.recurringId} justify="space-between" wrap="nowrap" py={4}>
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
                  <Icon size={18} stroke={1.6} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text truncate>{label}</Text>
                  <Text size="xs" c={item.status === 'overdue' ? 'danger' : 'dimmed'}>
                    {`${dueLabel(item)} · ${formatShortDate(item.dueDate)}`}
                  </Text>
                </div>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <Text fw={500}>{formatSignedPence(item.recurring.type, item.recurring.amount)}</Text>
                <Button size="compact-sm" aria-label={`Add ${label}`} onClick={() => add(item)}>Add</Button>
                <Menu position="bottom-end">
                  <Menu.Target>
                    <ActionIcon variant="subtle" aria-label={`More actions for ${label}`}><IconDots size={16} /></ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setEditing(item)}>Edit</Menu.Item>
                    <Menu.Item onClick={() => skip(item)}>Skip</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          );
        })}
      </Card>
    );
  }

  return (
    <>
      {card}
      <TransactionSheet
        opened={editing !== null}
        onClose={() => setEditing(null)}
        yearMonth={currentYearMonth()}
        template={template}
        templateDate={editing?.dueDate}
        onSaved={() => { if (editing) markHandled(editing); }}
      />
    </>
  );
}
```

In `app/routes/_index.tsx`:

1. Add this import with the other component imports:

```tsx
import { DueRecurringCard } from '~/components/recurring/DueRecurringCard';
```

2. Replace

```tsx
    <Stack>
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />
```

with

```tsx
    <Stack>
      <DueRecurringCard />
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />
```

3. Add after the `Recent` block's closing `</div>` (the one that ends with the `See all` button), still inside the `<Stack>`:

```tsx
      <Button component={Link} to="/recurring" variant="subtle" style={{ alignSelf: 'flex-start' }}>
        Manage recurring
      </Button>
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/recurring/__tests__/DueRecurringCard.test.tsx app/routes/__tests__/index.test.tsx && yarn typecheck && yarn test`
Expected: all new tests PASS; typecheck clean; whole suite passes, output pristine. If a `Menu` item is not found via `findByRole('menuitem')`, first confirm the menu opened by asserting on the other item; adapt the query to Mantine's rendered role without weakening what is asserted.

- [ ] **Step 5: Commit**

```bash
git add app/components/recurring/DueRecurringCard.tsx app/components/recurring/__tests__/DueRecurringCard.test.tsx app/routes/_index.tsx app/routes/__tests__/index.test.tsx
git commit -q -F - <<'EOF'
feat: add the Due card to Home

Lists what is due with Add (saved on the due date, with Undo), Edit (the
add sheet prefilled on the due date, then marked handled) and Skip (with
Undo). Home also always links to the Recurring page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 13: Tips text

**Files:**
- Modify: `app/components/layout/QuickEntryTips.tsx`
- Test: `app/components/layout/__tests__/QuickEntryTips.test.tsx`

**Interfaces:**
- Consumes: the existing tips modal.
- Produces: a "Recurring:" entry in the "Quick entry tips" modal.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('QuickEntryTips', ...)` block of `app/components/layout/__tests__/QuickEntryTips.test.tsx`:

```tsx
  it('explains recurring items', async () => {
    const user = userEvent.setup();
    renderTips();

    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quick entry tips' });

    expect(within(dialog).getByText('Recurring:')).toBeInTheDocument();
    expect(within(dialog).getByText(/Repeat monthly/)).toBeInTheDocument();
    expect(within(dialog).getByText(/top of Home/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/layout/__tests__/QuickEntryTips.test.tsx`
Expected: FAIL. There is no "Recurring:" entry.

- [ ] **Step 3: Implement**

In `app/components/layout/QuickEntryTips.tsx`, add this block directly after the Duplicate entry (the `<Text size="sm">` containing `<strong>Duplicate:</strong>`):

```tsx
          <Text size="sm">
            <strong>Recurring:</strong> choose Repeat monthly in a transaction's menu to set one up. When it is
            due it appears at the top of Home with Add, Edit and Skip. Manage them under Recurring.
          </Text>
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run app/components/layout/__tests__/QuickEntryTips.test.tsx && yarn typecheck && yarn test`
Expected: PASS; typecheck clean; whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/QuickEntryTips.tsx app/components/layout/__tests__/QuickEntryTips.test.tsx
git commit -q -F - <<'EOF'
feat: mention recurring items in the quick entry tips

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

---

### Task 14: Real-browser verification and docs

**Files:**
- Modify: `docs/ROADMAP.md`

This is verification, not new code. Use the stubbed headless harness kept in the scratchpad (`/private/tmp/claude-501/-Users-samuelchapman-Projects-budget-app-v3-ai-edition/c36988fc-314b-4d95-a73a-309d87387391/scratchpad/`, folders `task9/` and `task8b/`: a Vite config that aliases `@auth0/auth0-react` to a stub, and an in-browser API stub with request logging, adjustable latency and a POST-failure switch). Copy what you need into a **new** scratchpad folder `task14/` and extend the API stub with `/api/recurring` (`GET`, `POST` returning 201 with a server uuid and `handledPeriod: null`, `PUT /{id}`, `DELETE /{id}` returning 204, `POST /{id}/handled` with `{ period }`), all in memory. **The repo must stay untouched** (`git status --short` clean afterwards); never enter real credentials; remove any `.playwright-mcp/` folder the Playwright tool creates in the repo.

- [ ] **Step 1: Automated verification**

Run: `yarn typecheck && yarn test`
Expected: both clean; suite green with pristine output.

- [ ] **Step 2: Seed the stub relative to the real date**

Compute dates from the actual current date when seeding (do not hard-code). Seed templates so each Due state is present today: one **due today**, one **overdue** (due a couple of days ago, same month), one **upcoming** within its lead time, one **not yet visible** (due later than its lead time), one whose **category is missing** from the categories list, and one **already covered** by a transaction this month (same type, category, note). Include at least one INCOME (Salary) and one EXPENSE (Rent).

- [ ] **Step 3: Browser checklist (report PASS / FAIL / UNVERIFIABLE with evidence for each)**

Mobile (about 390x844) and desktop (about 1280x800), light and dark where noted. Count requests from the stub's log.

- [ ] R1. Transactions page: a row's menu shows **Repeat monthly** (after Duplicate). It opens the template form prefilled (type, category, amount, note, day of month from the transaction's date, remind days 3). Save sends exactly **one** `POST /api/recurring` with that body and the form closes.
- [ ] R2. The form validates per field: submitting empty shows the amount and category errors **under their own fields**; day 40 and remind 20 show their own errors; nothing is sent until valid.
- [ ] R3. `/recurring` lists templates sorted by day with "Monthly on the Nth · remind N days before" (or "no early reminder") and signed amounts; the deleted-category template shows "Category deleted"; **Edit** changes the amount (`PUT`), **Delete** removes it (`DELETE`); the empty state shows when there are none; **New** creates one.
- [ ] R4. Navigation: the desktop sidebar has **Recurring**; the bottom tab bar still has exactly four tabs; Home always shows "Manage recurring" (mobile and desktop); the header "?" tips modal has a Recurring entry.
- [ ] R5. Due card: at the top of Home, **above** the month header, showing due-today / overdue / upcoming items with the right labels, dates and signed amounts, in the right order (overdue first, then today, then upcoming); the not-yet-visible, missing-category and already-covered templates are absent; "Manage" links to `/recurring`; the card does not appear when nothing is due.
- [ ] R6. **Add:** exactly one `POST /api/transactions` whose `date` is the **due date**, a "Saved · Undo" toast, and the row disappears (it now matches). **Undo** sends the `DELETE` and the row returns.
- [ ] R7. **Edit:** opens the add sheet prefilled with the template values **and the due date** (date choice shows the due date, not Today). Change the **category**, save: one `POST /api/transactions`, then a `POST /api/recurring/{id}/handled` with the period, and the card row clears even though the saved transaction no longer matches the template.
- [ ] R8. **Skip:** one `POST /api/recurring/{id}/handled` with `{ period }`, the row clears, a "Skipped · Undo" toast appears; **Undo** sends `handled` again with the previous value (`null` if there was none) and the row returns.
- [ ] R9. Month-boundary heads-up: using the browser's clock control if available (for example Playwright's clock API), set the date to the last days of a month and confirm a template due on the 1st shows next month's "Due in N days" with the next month's date and, once added, is dated next month. If a clock cannot be controlled, mark this UNVERIFIABLE (the unit tests cover it).
- [ ] R10. Failure handling: make the templates `GET` fail: Home still loads, and the Due card shows the compact "Could not load recurring items" with a working retry.
- [ ] R11. Layout and console: the Due card and `/recurring` are legible in dark mode; the header still fits at 390px; the desktop sheet and form are modals, the mobile ones bottom drawers; no console errors or React warnings; the request log shows **no unexpected writes** (only the calls each action above should make).

- [ ] **Step 4: Update `docs/ROADMAP.md`**

Change the status cell for row C from `Not started` to `Implemented on \`feat/recurring-templates\` (PR pending). Spec: \`superpowers/specs/2026-09-19-recurring-templates-design.md\`, plan: \`superpowers/plans/2026-09-20-recurring-templates.md\``.

Then replace the whole `## C: Recurring templates` section (from that heading up to, but not including, `## D:`) with:

```markdown
## C: Recurring templates

Implemented on `feat/recurring-templates`. Spec: `superpowers/specs/2026-09-19-recurring-templates-design.md`, plan: `superpowers/plans/2026-09-20-recurring-templates.md`.

- **Built:**
  - Monthly recurring templates stored as `RECUR#` items, with five API routes (list, create, update, delete, mark handled) and category reassign moving them. No infra, IAM or dependency changes.
  - A Due card at the top of Home: Add (saved on the due date, with Undo), Edit (the add sheet prefilled, then marked handled), Skip (with Undo). Nothing is created automatically.
  - A Recurring page (list, edit, delete, new) linked from the desktop sidebar and from Home, and a "Repeat monthly" action in a transaction's row menu.
- **Decisions:** the due logic is client-side and pure; "handled" means a marker at or past the month, or a matching transaction (type and category, plus the note when the template has one); monthly on a day only, clamped to short months; per-template lead days (default 3); added transactions are dated on the due date.
- **Follow-ups:**
  - Weekly and yearly cadence, and an end date or pause for a template.
  - Deleting a category does not check references; templates left pointing at one are flagged on the Recurring page and skipped on Home.
  - A hand-entered transaction only clears a due item when its type, category and (if set) note match the template.
```

- [ ] **Step 5: Commit the docs**

```bash
git add docs/ROADMAP.md
git commit -q -F - <<'EOF'
docs: mark recurring templates as implemented

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
```

- [ ] **Step 6: Hand off**

Use superpowers:verification-before-completion, then superpowers:requesting-code-review, then superpowers:finishing-a-development-branch. Do not push or open a PR without the user's go-ahead. The backend is a code deploy through the existing pipeline (no infra step).
