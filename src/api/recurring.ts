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
