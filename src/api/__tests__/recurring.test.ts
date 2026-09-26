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

import { createRecurring, deleteRecurring, getRecurring, setRecurringHandled, updateRecurring, validateRecurringInput } from '../recurring';
import { MAX_AMOUNT_PENCE } from '../constants';
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
    ['SET_ASIDE', { type: 'SET_ASIDE' }],
    ['TAKE_OUT', { type: 'TAKE_OUT' }],
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
    ['the removed INVESTMENT_IN type', { type: 'INVESTMENT_IN' }],
    ['the removed INVESTMENT_OUT type', { type: 'INVESTMENT_OUT' }],
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

describe('validateRecurringInput amount cap', () => {
  const body = { type: 'EXPENSE', categoryId: 'cat-holidays', description: 'Rent', dayOfMonth: 1, leadDays: 3 };

  it('accepts an amount of exactly the cap', () => {
    expect(validateRecurringInput({ ...body, amount: MAX_AMOUNT_PENCE }).ok).toBe(true);
  });

  it('rejects an amount one pence over the cap', () => {
    expect(validateRecurringInput({ ...body, amount: MAX_AMOUNT_PENCE + 1 }).ok).toBe(false);
  });
});
