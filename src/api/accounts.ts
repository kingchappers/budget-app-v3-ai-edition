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
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  // `new Date` rolls an out-of-range day/month over into the next one
  // (2026-02-31 silently becomes 2026-03-03) rather than rejecting it, so
  // round-trip through ISO formatting and require it to match verbatim.
  return date.toISOString().slice(0, 10) === value;
}

function toAccount(item: Record<string, unknown>): Account {
  return {
    accountId: String(item.accountId),
    name: String(item.name),
    kind: item.kind as AccountKind,
    type: item.type as AccountType,
    balances: Array.isArray(item.balances) ? (item.balances as BalanceEntry[]) : [],
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

function tomorrowIso(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + 1);
  return now.toISOString().slice(0, 10);
}

function isValidPence(value: unknown): value is number {
  // Unlike a transaction amount, a balance may be zero (an account paid off
  // or closed) or negative (an overdrawn current account), so only its
  // magnitude is capped.
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_AMOUNT_PENCE;
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
  return ok({ accounts: items.map(toAccount) });
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
  const existing = toAccount(existingItem);

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
  const existing = toAccount(existingItem);

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
