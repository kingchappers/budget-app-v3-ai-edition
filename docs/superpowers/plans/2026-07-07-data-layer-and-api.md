# Budget App — Data Layer & API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DynamoDB-backed API for categories, transactions, and category targets — the foundational data layer for the budget app.

**Architecture:** Single-table DynamoDB design with composite keys (`PK=USER#{sub}`, `SK=entity-type#...`) enabling all read patterns without a GSI. The existing `api-handler.ts` auth middleware is preserved; a new regex-based router dispatches to handler modules. Amounts are stored as integers (pence/cents) to avoid floating-point errors.

**Tech Stack:** DynamoDB SDK v3 (`@aws-sdk/lib-dynamodb`), Vitest, TypeScript, OpenTofu/Terraform, Node.js 24.x Lambda

---

## DynamoDB Key Design

| Entity | PK | SK |
|---|---|---|
| Category (custom) | `USER#{sub}` | `CAT#{categoryId}` |
| Transaction | `USER#{sub}` | `TXN#{YYYY-MM}#{transactionId}` |
| Category Target | `USER#{sub}` | `TARGET#{categoryId}` |

Default categories are served from code (not DynamoDB) with stable string IDs like `cat-housing`.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | Create | Shared TypeScript interfaces and enums |
| `src/api/constants.ts` | Create | Security headers, shared constants |
| `src/api/db.ts` | Create | DynamoDB DocumentClient, key helpers |
| `src/api/defaults.ts` | Create | Default category seed data |
| `src/api/router.ts` | Create | Regex-based route dispatcher |
| `src/api/categories.ts` | Create | Category CRUD handlers |
| `src/api/transactions.ts` | Create | Transaction CRUD handlers |
| `src/api/targets.ts` | Create | Category target CRUD handlers |
| `src/api/__tests__/router.test.ts` | Create | Router unit tests |
| `src/api/__tests__/categories.test.ts` | Create | Category handler unit tests |
| `src/api/__tests__/transactions.test.ts` | Create | Transaction handler unit tests |
| `src/api/__tests__/targets.test.ts` | Create | Target handler unit tests |
| `api-handler.ts` | Modify | Wire in router, remove old test routes |
| `infra/dynamodb.tf` | Create | DynamoDB table + Lambda IAM policy |
| `infra/api-lambda.tf` | Modify | Add DELETE and PUT API Gateway routes |
| `scripts/build-api-handler.cjs` | Modify | Add DynamoDB SDK to Lambda bundle deps |
| `package.json` | Modify | Add vitest + DynamoDB SDK type deps |

---

## Task 1: Add Vitest and configure test script

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Add Vitest to devDependencies**

Run:
```bash
yarn add --dev vitest @vitest/coverage-v8
```

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify Vitest runs (no tests yet)**

Run:
```bash
yarn test
```
Expected: `No test files found` or similar — exit code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock vitest.config.ts
git commit -m "chore: add Vitest for API handler testing"
```

---

## Task 2: Shared types and constants

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/constants.ts`

- [ ] **Step 1: Create types**

Create `src/api/types.ts`:
```typescript
export type TransactionType = 'EXPENSE' | 'INCOME' | 'INVESTMENT_GAIN' | 'INVESTMENT_LOSS';

export type CategoryType = 'EXPENSE' | 'INCOME' | 'INVESTMENT';

export type TargetPeriod = 'MONTHLY' | 'WEEKLY';

export interface Category {
  categoryId: string;
  name: string;
  type: CategoryType;
  icon: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Transaction {
  transactionId: string;
  yearMonth: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
  createdAt: string;
}

export interface CategoryTarget {
  categoryId: string;
  targetAmount: number;
  period: TargetPeriod;
  updatedAt: string;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
```

- [ ] **Step 2: Create constants**

Create `src/api/constants.ts`:
```typescript
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export const VALID_TRANSACTION_TYPES = new Set([
  'EXPENSE', 'INCOME', 'INVESTMENT_GAIN', 'INVESTMENT_LOSS',
]);

export const VALID_CATEGORY_TYPES = new Set(['EXPENSE', 'INCOME', 'INVESTMENT']);

export const VALID_PERIODS = new Set(['MONTHLY', 'WEEKLY']);
```

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts src/api/constants.ts
git commit -m "feat: add shared API types and constants"
```

---

## Task 3: DynamoDB client helper

**Files:**
- Create: `src/api/db.ts`

No tests needed here — it's thin wiring code. The handlers that use it will be tested with mocks.

- [ ] **Step 1: Add DynamoDB SDK as a dev dependency for type-checking**

```bash
yarn add --dev @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

- [ ] **Step 2: Create the DB helper**

Create `src/api/db.ts`:
```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-2' });
export const docClient = DynamoDBDocumentClient.from(client);

export const TABLE = process.env.DYNAMODB_TABLE || '';

export const pk = (userId: string): string => `USER#${userId}`;
export const catSk = (categoryId: string): string => `CAT#${categoryId}`;
export const txnSk = (yearMonth: string, transactionId: string): string =>
  `TXN#${yearMonth}#${transactionId}`;
export const targetSk = (categoryId: string): string => `TARGET#${categoryId}`;
```

- [ ] **Step 3: Commit**

```bash
git add src/api/db.ts package.json yarn.lock
git commit -m "feat: add DynamoDB client and key helpers"
```

---

## Task 4: Default categories

**Files:**
- Create: `src/api/defaults.ts`

- [ ] **Step 1: Create default categories**

Create `src/api/defaults.ts`:
```typescript
import type { Category } from './types';

export const DEFAULT_CATEGORIES: Category[] = [
  // EXPENSE
  { categoryId: 'cat-housing',       name: 'Housing',             type: 'EXPENSE',    icon: 'home',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-food',          name: 'Food & Groceries',    type: 'EXPENSE',    icon: 'shopping-cart', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-transport',     name: 'Transport',           type: 'EXPENSE',    icon: 'car',         isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-utilities',     name: 'Utilities',           type: 'EXPENSE',    icon: 'bolt',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-health',        name: 'Health & Medical',    type: 'EXPENSE',    icon: 'heart',       isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-entertainment', name: 'Entertainment',       type: 'EXPENSE',    icon: 'device-tv',   isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-clothing',      name: 'Clothing',            type: 'EXPENSE',    icon: 'shirt',       isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-personal-care', name: 'Personal Care',       type: 'EXPENSE',    icon: 'sparkles',    isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-education',     name: 'Education',           type: 'EXPENSE',    icon: 'book',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-dining',        name: 'Restaurants & Dining',type: 'EXPENSE',    icon: 'tools-kitchen-2', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-subscriptions', name: 'Subscriptions',       type: 'EXPENSE',    icon: 'refresh',     isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-travel',        name: 'Travel',              type: 'EXPENSE',    icon: 'plane',       isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-gifts',         name: 'Gifts & Donations',   type: 'EXPENSE',    icon: 'gift',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-insurance',     name: 'Insurance',           type: 'EXPENSE',    icon: 'shield',      isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  // INCOME
  { categoryId: 'cat-salary',        name: 'Salary',              type: 'INCOME',     icon: 'briefcase',   isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-freelance',     name: 'Freelance/Contract',  type: 'INCOME',     icon: 'code',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-rental',        name: 'Rental Income',       type: 'INCOME',     icon: 'building',    isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-other-income',  name: 'Other Income',        type: 'INCOME',     icon: 'cash',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  // INVESTMENT
  { categoryId: 'cat-stocks',        name: 'Stocks',              type: 'INVESTMENT', icon: 'chart-line',  isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-crypto',        name: 'Crypto',              type: 'INVESTMENT', icon: 'currency-bitcoin', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-real-estate',   name: 'Real Estate',         type: 'INVESTMENT', icon: 'building-estate', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-other-investments', name: 'Other Investments', type: 'INVESTMENT', icon: 'trending-up', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
];

export const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.categoryId));
```

- [ ] **Step 2: Commit**

```bash
git add src/api/defaults.ts
git commit -m "feat: add default budget categories"
```

---

## Task 5: Router

**Files:**
- Create: `src/api/router.ts`
- Create: `src/api/__tests__/router.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/api/__tests__/router.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createRouter } from '../router';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(method: string, path: string, body?: string): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    body,
    headers: {},
    queryStringParameters: {},
    pathParameters: {},
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

describe('router', () => {
  it('dispatches to a matching GET route', async () => {
    const router = createRouter();
    router.get('/api/categories', async () => ({
      statusCode: 200, headers: {}, body: '{"ok":true}',
    }));
    const res = await router.dispatch(makeEvent('GET', '/api/categories'), 'user-1');
    expect(res.statusCode).toBe(200);
  });

  it('dispatches to a matching DELETE route with path param', async () => {
    const router = createRouter();
    router.delete('/api/categories/{categoryId}', async (_event, _userId, params) => ({
      statusCode: 204, headers: {}, body: '',
    }));
    const res = await router.dispatch(makeEvent('DELETE', '/api/categories/abc-123'), 'user-1');
    expect(res.statusCode).toBe(204);
  });

  it('extracts path parameters correctly', async () => {
    const router = createRouter();
    let captured: Record<string, string> = {};
    router.delete('/api/transactions/{yearMonth}/{transactionId}', async (_event, _userId, params) => {
      captured = params;
      return { statusCode: 204, headers: {}, body: '' };
    });
    await router.dispatch(makeEvent('DELETE', '/api/transactions/2025-01/txn-uuid'), 'user-1');
    expect(captured).toEqual({ yearMonth: '2025-01', transactionId: 'txn-uuid' });
  });

  it('returns 404 for unknown routes', async () => {
    const router = createRouter();
    const res = await router.dispatch(makeEvent('GET', '/api/unknown'), 'user-1');
    expect(res.statusCode).toBe(404);
  });

  it('does not match a GET route on a POST request', async () => {
    const router = createRouter();
    router.get('/api/categories', async () => ({ statusCode: 200, headers: {}, body: '' }));
    const res = await router.dispatch(makeEvent('POST', '/api/categories'), 'user-1');
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
yarn test
```
Expected: `Cannot find module '../router'`

- [ ] **Step 3: Implement the router**

Create `src/api/router.ts`:
```typescript
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse } from './types';
import { SECURITY_HEADERS } from './constants';

type Handler = (
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
) => Promise<ApiResponse>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export interface Router {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  delete(path: string, handler: Handler): void;
  dispatch(event: APIGatewayProxyEventV2, userId: string): Promise<ApiResponse>;
}

export function createRouter(): Router {
  const routes: Route[] = [];

  function register(method: string, pathTemplate: string, handler: Handler): void {
    const paramNames: string[] = [];
    const regexStr = pathTemplate.replace(/\{(\w+)\}/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ method, pattern: new RegExp(`^${regexStr}$`), paramNames, handler });
  }

  async function dispatch(event: APIGatewayProxyEventV2, userId: string): Promise<ApiResponse> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      return route.handler(event, userId, params);
    }

    return {
      statusCode: 404,
      headers: SECURITY_HEADERS,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  }

  return {
    get: (path, handler) => register('GET', path, handler),
    post: (path, handler) => register('POST', path, handler),
    put: (path, handler) => register('PUT', path, handler),
    delete: (path, handler) => register('DELETE', path, handler),
    dispatch,
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
yarn test
```
Expected: all 5 router tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/router.ts src/api/__tests__/router.test.ts
git commit -m "feat: add regex-based API router with path parameter extraction"
```

---

## Task 6: Categories API handlers

**Files:**
- Create: `src/api/categories.ts`
- Create: `src/api/__tests__/categories.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/api/__tests__/categories.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  catSk: (categoryId: string) => `CAT#${categoryId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(i => i),
  PutCommand: vi.fn(i => i),
  DeleteCommand: vi.fn(i => i),
}));

import { getCategories, createCategory, deleteCategory } from '../categories';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: object, params?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    pathParameters: params,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getCategories', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns default categories plus user custom categories', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ categoryId: 'custom-1', name: 'My Cat', type: 'EXPENSE', icon: 'star', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const res = await getCategories(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.categories.some((c: any) => c.categoryId === 'cat-housing')).toBe(true);
    expect(body.categories.some((c: any) => c.categoryId === 'custom-1')).toBe(true);
  });
});

describe('createCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates a category and returns 201', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createCategory(
      makeEvent({ name: 'My Custom Cat', type: 'EXPENSE', icon: 'star' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.category.name).toBe('My Custom Cat');
    expect(body.category.isDefault).toBe(false);
  });

  it('returns 400 for missing name', async () => {
    const res = await createCategory(makeEvent({ type: 'EXPENSE' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid type', async () => {
    const res = await createCategory(makeEvent({ name: 'X', type: 'INVALID' }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for name over 50 chars', async () => {
    const res = await createCategory(
      makeEvent({ name: 'a'.repeat(51), type: 'EXPENSE' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('deleteCategory', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes a custom category and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteCategory(makeEvent(), 'user-1', { categoryId: 'custom-abc' });
    expect(res.statusCode).toBe(204);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 403 when trying to delete a default category', async () => {
    const res = await deleteCategory(makeEvent(), 'user-1', { categoryId: 'cat-housing' });
    expect(res.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await deleteCategory(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
yarn test
```
Expected: `Cannot find module '../categories'`

- [ ] **Step 3: Implement categories handlers**

Create `src/api/categories.ts`:
```typescript
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, catSk } from './db';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_IDS } from './defaults';
import { SECURITY_HEADERS, VALID_CATEGORY_TYPES } from './constants';
import type { Category, ApiResponse } from './types';

function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function getCategories(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'CAT#' },
  }));

  const custom = (result.Items || []) as Category[];
  return ok({ categories: [...DEFAULT_CATEGORIES, ...custom] });
}

export async function createCategory(
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

  const { name, type, icon } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 50) {
    return err(400, 'name must be a non-empty string of at most 50 characters');
  }
  if (!type || !VALID_CATEGORY_TYPES.has(type as string)) {
    return err(400, 'type must be EXPENSE, INCOME, or INVESTMENT');
  }

  const categoryId = crypto.randomUUID();
  const category: Category = {
    categoryId,
    name: name.trim(),
    type: type as Category['type'],
    icon: typeof icon === 'string' ? icon.slice(0, 50) : 'default',
    isDefault: false,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: catSk(categoryId), ...category },
  }));

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ category }) };
}

export async function deleteCategory(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;

  if (!categoryId) {
    return err(400, 'categoryId is required');
  }
  if (DEFAULT_CATEGORY_IDS.has(categoryId)) {
    return err(403, 'Cannot delete a default category');
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: catSk(categoryId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
yarn test
```
Expected: all category tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/categories.ts src/api/__tests__/categories.test.ts
git commit -m "feat: add categories API handlers (get, create, delete)"
```

---

## Task 7: Transactions API handlers

**Files:**
- Create: `src/api/transactions.ts`
- Create: `src/api/__tests__/transactions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/api/__tests__/transactions.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  txnSk: (ym: string, id: string) => `TXN#${ym}#${id}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(i => i),
  PutCommand: vi.fn(i => i),
  DeleteCommand: vi.fn(i => i),
}));

import { getTransactions, createTransaction, deleteTransaction } from '../transactions';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(opts: {
  body?: object;
  query?: Record<string, string>;
  params?: Record<string, string>;
} = {}): APIGatewayProxyEventV2 {
  return {
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    queryStringParameters: opts.query || {},
    pathParameters: opts.params,
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getTransactions', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns transactions for a valid year and month', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ transactionId: 'txn-1' }] });
    const res = await getTransactions(makeEvent({ query: { year: '2025', month: '1' } }), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).transactions).toHaveLength(1);
  });

  it('returns 400 when year or month is missing', async () => {
    const res = await getTransactions(makeEvent({ query: { year: '2025' } }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid month', async () => {
    const res = await getTransactions(makeEvent({ query: { year: '2025', month: '13' } }), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});

describe('createTransaction', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates a transaction and returns 201', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await createTransaction(
      makeEvent({ body: { amount: 1500, type: 'EXPENSE', categoryId: 'cat-food', description: 'Tesco', date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.transaction.amount).toBe(1500);
    expect(body.transaction.yearMonth).toBe('2025-01');
  });

  it('returns 400 for non-integer amount', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 15.50, type: 'EXPENSE', categoryId: 'cat-food', description: 'Tesco', date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid date format', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 1500, type: 'EXPENSE', categoryId: 'cat-food', description: 'Tesco', date: '15/01/2025' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid transaction type', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 1500, type: 'INVALID', categoryId: 'cat-food', description: 'Tesco', date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for description over 200 chars', async () => {
    const res = await createTransaction(
      makeEvent({ body: { amount: 100, type: 'EXPENSE', categoryId: 'cat-food', description: 'a'.repeat(201), date: '2025-01-15' } }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('deleteTransaction', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes a transaction and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteTransaction(makeEvent(), 'user-1', { yearMonth: '2025-01', transactionId: 'some-uuid' });
    expect(res.statusCode).toBe(204);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid yearMonth format', async () => {
    const res = await deleteTransaction(makeEvent(), 'user-1', { yearMonth: '01-2025', transactionId: 'uuid' });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when transactionId is missing', async () => {
    const res = await deleteTransaction(makeEvent(), 'user-1', { yearMonth: '2025-01' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
yarn test
```
Expected: `Cannot find module '../transactions'`

- [ ] **Step 3: Implement transaction handlers**

Create `src/api/transactions.ts`:
```typescript
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, txnSk } from './db';
import { SECURITY_HEADERS, VALID_TRANSACTION_TYPES } from './constants';
import type { Transaction, ApiResponse } from './types';

function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function getTransactions(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const qs = event.queryStringParameters || {};
  const { year, month } = qs;

  if (!year || !month) {
    return err(400, 'year and month query parameters are required');
  }

  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12 || yearNum < 2000) {
    return err(400, 'Invalid year or month');
  }

  const yearMonth = `${year}-${month.padStart(2, '0')}`;

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': `TXN#${yearMonth}` },
  }));

  return ok({ transactions: result.Items || [] });
}

export async function createTransaction(
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

  const { amount, type, categoryId, description, date } = body;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return err(400, 'amount must be a positive integer representing pence/cents');
  }
  if (!type || !VALID_TRANSACTION_TYPES.has(type as string)) {
    return err(400, 'type must be EXPENSE, INCOME, INVESTMENT_GAIN, or INVESTMENT_LOSS');
  }
  if (!categoryId || typeof categoryId !== 'string' || categoryId.length > 100) {
    return err(400, 'categoryId is required');
  }
  if (!description || typeof description !== 'string' || description.trim().length === 0 || description.length > 200) {
    return err(400, 'description must be a non-empty string of at most 200 characters');
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return err(400, 'date must be in YYYY-MM-DD format');
  }

  const yearMonth = date.slice(0, 7);
  const transactionId = crypto.randomUUID();

  const transaction: Transaction = {
    transactionId,
    yearMonth,
    amount,
    type: type as Transaction['type'],
    categoryId: categoryId as string,
    description: description.trim(),
    date,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: txnSk(yearMonth, transactionId), ...transaction },
  }));

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ transaction }) };
}

export async function deleteTransaction(
  _event: APIGatewayProxyEventV2,
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

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
yarn test
```
Expected: all transaction tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/transactions.ts src/api/__tests__/transactions.test.ts
git commit -m "feat: add transactions API handlers (get, create, delete)"
```

---

## Task 8: Category targets API handlers

**Files:**
- Create: `src/api/targets.ts`
- Create: `src/api/__tests__/targets.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/api/__tests__/targets.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  targetSk: (categoryId: string) => `TARGET#${categoryId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(i => i),
  PutCommand: vi.fn(i => i),
  DeleteCommand: vi.fn(i => i),
}));

import { getTargets, upsertTarget, deleteTarget } from '../targets';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: object): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getTargets', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns all targets for the user', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ categoryId: 'cat-food', targetAmount: 30000, period: 'MONTHLY' }] });
    const res = await getTargets(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).targets).toHaveLength(1);
  });
});

describe('upsertTarget', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('creates or updates a target and returns 200', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.target.targetAmount).toBe(30000);
    expect(body.target.period).toBe('MONTHLY');
  });

  it('returns 400 for non-integer targetAmount', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 300.50, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid period', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'YEARLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'MONTHLY' }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('deleteTarget', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('deletes a target and returns 204', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await deleteTarget(makeEvent(), 'user-1', { categoryId: 'cat-food' });
    expect(res.statusCode).toBe(204);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await deleteTarget(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
yarn test
```
Expected: `Cannot find module '../targets'`

- [ ] **Step 3: Implement targets handlers**

Create `src/api/targets.ts`:
```typescript
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, targetSk } from './db';
import { SECURITY_HEADERS, VALID_PERIODS } from './constants';
import type { CategoryTarget, ApiResponse } from './types';

function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function getTargets(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'TARGET#' },
  }));

  return ok({ targets: result.Items || [] });
}

export async function upsertTarget(
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

  const { targetAmount, period } = body;

  if (typeof targetAmount !== 'number' || !Number.isInteger(targetAmount) || targetAmount <= 0) {
    return err(400, 'targetAmount must be a positive integer representing pence/cents');
  }
  if (!period || !VALID_PERIODS.has(period as string)) {
    return err(400, 'period must be MONTHLY or WEEKLY');
  }

  const target: CategoryTarget = {
    categoryId,
    targetAmount,
    period: period as CategoryTarget['period'],
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: targetSk(categoryId), ...target },
  }));

  return ok({ target });
}

export async function deleteTarget(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;

  if (!categoryId) {
    return err(400, 'categoryId is required');
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: targetSk(categoryId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
yarn test
```
Expected: all target tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/targets.ts src/api/__tests__/targets.test.ts
git commit -m "feat: add category targets API handlers (get, upsert, delete)"
```

---

## Task 9: Wire router into api-handler.ts

**Files:**
- Modify: `api-handler.ts`

- [ ] **Step 1: Replace api-handler.ts with the router-wired version**

Replace the entire contents of `api-handler.ts` with:
```typescript
import { verify } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createRouter } from './src/api/router';
import { SECURITY_HEADERS } from './src/api/constants';
import { getCategories, createCategory, deleteCategory } from './src/api/categories';
import { getTransactions, createTransaction, deleteTransaction } from './src/api/transactions';
import { getTargets, upsertTarget, deleteTarget } from './src/api/targets';

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || '';

const jwks = jwksClient({
  cache: true,
  cacheMaxAge: 600000,
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header: any, callback: any) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) callback(err);
    else callback(null, key?.getPublicKey());
  });
}

const router = createRouter();
router.get('/api/categories', getCategories);
router.post('/api/categories', createCategory);
router.delete('/api/categories/{categoryId}', deleteCategory);
router.get('/api/transactions', getTransactions);
router.post('/api/transactions', createTransaction);
router.delete('/api/transactions/{yearMonth}/{transactionId}', deleteTransaction);
router.get('/api/targets', getTargets);
router.put('/api/targets/{categoryId}', upsertTarget);
router.delete('/api/targets/{categoryId}', deleteTarget);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    console.log('Request:', {
      path: event.rawPath,
      method: event.requestContext.http.method,
      sourceIp: event.requestContext.http.sourceIp,
    });

    const authHeader = event.headers?.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      console.log('Auth failed: No token provided');
      return {
        statusCode: 401,
        headers: SECURITY_HEADERS,
        body: JSON.stringify({ error: 'Missing authorization token' }),
      };
    }

    const decoded: any = await new Promise((resolve, reject) => {
      verify(token, getKey, { audience: AUTH0_AUDIENCE, issuer: `https://${AUTH0_DOMAIN}/`, algorithms: ['RS256'] },
        (err, decoded) => err ? reject(err) : resolve(decoded),
      );
    });

    if (!decoded.sub || typeof decoded.sub !== 'string') {
      console.error('Auth failed: Invalid or missing sub claim');
      return { statusCode: 401, headers: SECURITY_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    return router.dispatch(event, decoded.sub);
  } catch (error) {
    console.error('Auth error:', error instanceof Error ? error.message : String(error));
    return { statusCode: 401, headers: SECURITY_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
};
```

- [ ] **Step 2: Run typecheck to verify no TypeScript errors**

```bash
yarn typecheck
```
Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add api-handler.ts
git commit -m "feat: wire router and all API handlers into api-handler.ts"
```

---

## Task 10: Update build script to include DynamoDB SDK

**Files:**
- Modify: `scripts/build-api-handler.cjs`

- [ ] **Step 1: Add DynamoDB SDK to the Lambda package.json in the build script**

In `scripts/build-api-handler.cjs`, find the `packageJson.dependencies` object and update it:
```javascript
const packageJson = {
  name: 'budget-app-api',
  version: '1.0.0',
  dependencies: {
    'jsonwebtoken': '^9.0.3',
    'jwks-rsa': '^3.2.1',
    '@aws-sdk/client-dynamodb': '^3.0.0',
    '@aws-sdk/lib-dynamodb': '^3.0.0',
  }
};
```

- [ ] **Step 2: Verify the build compiles successfully**

You need Auth0 env vars for the React build but not for the API handler compile step. Run just the API build:
```bash
node scripts/build-api-handler.cjs
```
Expected: `✓ API handler compiled to build/api/index.js` with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-api-handler.cjs
git commit -m "build: add DynamoDB SDK to Lambda bundle dependencies"
```

---

## Task 11: DynamoDB table and IAM policy in infra

**Files:**
- Create: `infra/dynamodb.tf`
- Modify: `infra/lambda.tf` (add IAM policy attachment)
- Modify: `infra/api-lambda.tf` (add DYNAMODB_TABLE env var)

- [ ] **Step 1: Create the DynamoDB table**

Create `infra/dynamodb.tf`:
```hcl
# DynamoDB table — single-table design
# PK: USER#{auth0_sub}, SK: entity-prefix#id
resource "aws_dynamodb_table" "budget_data" {
  name         = "${var.app_name}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
    Application = var.app_name
  }
}

# IAM policy granting the Lambda role least-privilege DynamoDB access (INFRA-01)
resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "${var.app_name}-lambda-dynamodb"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.budget_data.arn
      }
    ]
  })
}

output "dynamodb_table_name" {
  value       = aws_dynamodb_table.budget_data.name
  description = "DynamoDB table name for the budget app data"
}
```

- [ ] **Step 2: Add DYNAMODB_TABLE to the API Lambda environment**

In `infra/api-lambda.tf`, find the `aws_lambda_function "api"` resource's `environment.variables` block and add:
```hcl
      DYNAMODB_TABLE   = aws_dynamodb_table.budget_data.name
```

So the full environment block becomes:
```hcl
  environment {
    variables = {
      NODE_ENV         = "production"
      AUTH0_DOMAIN     = var.auth0_domain
      AUTH0_AUDIENCE   = var.auth0_audience
      DYNAMODB_TABLE   = aws_dynamodb_table.budget_data.name
    }
  }
```

- [ ] **Step 3: Verify the plan is clean**

```bash
cd infra && tofu init && tofu plan
```
Expected: plan shows DynamoDB table creation and IAM policy, no errors.

- [ ] **Step 4: Commit**

```bash
git add infra/dynamodb.tf infra/api-lambda.tf infra/lambda.tf
git commit -m "feat: add DynamoDB table and least-privilege IAM policy for API Lambda (INFRA-01)"
```

---

## Task 12: Add DELETE and PUT API Gateway routes

**Files:**
- Modify: `infra/api-lambda.tf`

The existing `api-lambda.tf` only has GET and POST routes. Targets use PUT and transactions/categories use DELETE.

- [ ] **Step 1: Add DELETE and PUT routes**

In `infra/api-lambda.tf`, after the existing `aws_apigatewayv2_route "api_get"` resource, add:
```hcl
resource "aws_apigatewayv2_route" "api_delete" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "DELETE /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

resource "aws_apigatewayv2_route" "api_put" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "PUT /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}
```

- [ ] **Step 2: Verify plan**

```bash
cd infra && tofu plan
```
Expected: 2 new resources (`aws_apigatewayv2_route.api_delete`, `aws_apigatewayv2_route.api_put`), no errors.

- [ ] **Step 3: Commit**

```bash
git add infra/api-lambda.tf
git commit -m "feat: add DELETE and PUT API Gateway routes for budget API"
```

---

## Final Check

- [ ] Run all tests one more time from the repo root:
  ```bash
  yarn test
  ```
  Expected: all tests pass, 0 failures.

- [ ] Run typecheck:
  ```bash
  yarn typecheck
  ```
  Expected: exits 0.

- [ ] Push branch and confirm CI passes:
  ```bash
  git push origin docs/add-security-controls
  ```
