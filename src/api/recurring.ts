import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ConditionFailedError, getStore } from '../store';
import { pk, recurringSk } from './db';
import { MAX_AMOUNT_PENCE, SECURITY_HEADERS, VALID_TRANSACTION_TYPES } from './constants';
import type { ApiResponse, Recurring, RecurringFrequency, TransactionType } from './types';
import { ok, err, parseJsonObject } from './http';
import { moveToTrash } from './trash';

const DEFAULT_LEAD_DAYS = 3;
const MAX_NOTE_LENGTH = 200;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = ['WEEKLY', 'FOUR_WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

// How far ahead a reminder may start: a week's bill needs a fortnight at most, a yearly one two months.
export const MAX_LEAD_DAYS: Record<RecurringFrequency, number> = {
  WEEKLY: 14,
  FOUR_WEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 60,
  YEARLY: 60,
};

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// A handled marker is a month for monthly items and an occurrence date for the others.
function isOccurrenceKey(value: string): boolean {
  return PERIOD_PATTERN.test(value) || isRealDate(value);
}

export interface ValidRecurringInput {
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  frequency: RecurringFrequency;
  anchorDate: string | null;
  leadDays: number;
}

type Validation = { ok: true; value: ValidRecurringInput } | { ok: false; message: string };

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validateRecurringInput(body: Record<string, unknown>): Validation {
  const { type, categoryId, amount, description, leadDays } = body;
  const frequency = body.frequency ?? 'MONTHLY';

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_PENCE) {
    return { ok: false, message: `amount must be a positive integer representing pence/cents, at most ${MAX_AMOUNT_PENCE}` };
  }
  if (typeof type !== 'string' || !VALID_TRANSACTION_TYPES.has(type)) {
    return { ok: false, message: 'type must be EXPENSE, INCOME, SET_ASIDE, or TAKE_OUT' };
  }
  if (typeof categoryId !== 'string' || categoryId === '' || categoryId.length > 100) {
    return { ok: false, message: 'categoryId is required' };
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > MAX_NOTE_LENGTH) {
      return { ok: false, message: 'description must be a string of at most 200 characters' };
    }
  }
  if (typeof frequency !== 'string' || !RECURRING_FREQUENCIES.includes(frequency as RecurringFrequency)) {
    return { ok: false, message: `frequency must be one of ${RECURRING_FREQUENCIES.join(', ')}` };
  }
  const schedule = frequency as RecurringFrequency;
  const maxLead = MAX_LEAD_DAYS[schedule];
  if (leadDays !== undefined && leadDays !== null && !isIntegerInRange(leadDays, 0, maxLead)) {
    return { ok: false, message: `leadDays must be an integer from 0 to ${maxLead} for ${schedule} items` };
  }

  let dayOfMonth: number;
  let anchorDate: string | null = null;
  if (schedule === 'MONTHLY') {
    if (!isIntegerInRange(body.dayOfMonth, 1, 31)) {
      return { ok: false, message: 'dayOfMonth must be an integer from 1 to 31' };
    }
    dayOfMonth = body.dayOfMonth;
  } else {
    if (typeof body.anchorDate !== 'string' || !isRealDate(body.anchorDate)) {
      return { ok: false, message: `anchorDate must be a valid YYYY-MM-DD date for ${schedule} items` };
    }
    anchorDate = body.anchorDate;
    dayOfMonth = Number(anchorDate.slice(8, 10));
  }

  return {
    ok: true,
    value: {
      type: type as TransactionType,
      categoryId,
      amount,
      description: typeof description === 'string' ? description.trim() : '',
      dayOfMonth,
      frequency: schedule,
      anchorDate,
      leadDays: typeof leadDays === 'number' ? leadDays : DEFAULT_LEAD_DAYS,
    },
  };
}

export function toRecurring(item: Record<string, unknown>): Recurring {
  return {
    recurringId: item.recurringId as string,
    type: item.type as TransactionType,
    categoryId: item.categoryId as string,
    amount: item.amount as number,
    description: (item.description as string | undefined) ?? '',
    dayOfMonth: item.dayOfMonth as number,
    frequency: (item.frequency as RecurringFrequency | undefined) ?? 'MONTHLY',
    anchorDate: (item.anchorDate as string | null | undefined) ?? null,
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
  const items = await getStore().query(pk(userId), { skPrefix: 'RECUR#' });
  return ok({ recurring: items.map(toRecurring) });
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

  await getStore().put({ PK: pk(userId), SK: recurringSk(recurring.recurringId), ...recurring });

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ recurring }) };
}

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
  const { type, categoryId, amount, description, dayOfMonth, frequency, anchorDate, leadDays } = validation.value;

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
}

export async function deleteRecurring(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { recurringId } = params;
  if (!recurringId) return err(400, 'recurringId is required');

  await moveToTrash(userId, 'RECURRING', recurringSk(recurringId));

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
  if (period !== null && !(typeof period === 'string' && isOccurrenceKey(period))) {
    return err(400, 'period must be YYYY-MM, YYYY-MM-DD or null');
  }

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
}
