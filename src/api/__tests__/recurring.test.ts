import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';
import { createRecurring, deleteRecurring, getRecurring, setRecurringHandled, updateRecurring, validateRecurringInput } from '../recurring';
import { MAX_AMOUNT_PENCE } from '../constants';

let store: SqliteStore;
beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

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
  it('returns the caller\'s templates without storage keys', async () => {
    await seedUser(store, 'user-1', [{
      SK: 'RECUR#r1', recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary',
      amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3, handledPeriod: null,
      createdAt: 'c', updatedAt: 'u',
    }]);

    const res = await getRecurring(makeEvent(), 'user-1', {});

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recurring).toHaveLength(1);
    expect(body.recurring[0]).not.toHaveProperty('PK');
    expect(body.recurring[0]).not.toHaveProperty('SK');
    expect(body.recurring[0].recurringId).toBe('r1');
  });

  it('returns only the caller\'s RECUR# items', async () => {
    await seedUser(store, 'user-1', [
      { SK: 'RECUR#r1', recurringId: 'r1', type: 'INCOME', categoryId: 'c', amount: 1, dayOfMonth: 1, leadDays: 3, handledPeriod: null },
      { SK: 'CAT#c1', categoryId: 'c1' },
    ]);
    await seedUser(store, 'user-2', [
      { SK: 'RECUR#r2', recurringId: 'r2', type: 'INCOME', categoryId: 'c', amount: 1, dayOfMonth: 1, leadDays: 3, handledPeriod: null },
    ]);
    const res = await getRecurring(makeEvent(), 'user-1', {});
    const ids = JSON.parse(res.body).recurring.map((r: { recurringId: string }) => r.recurringId);
    expect(ids).toEqual(['r1']);
  });

  it('returns an empty list when there are no templates', async () => {
    const res = await getRecurring(makeEvent(), 'user-1', {});
    expect(JSON.parse(res.body).recurring).toEqual([]);
  });
});

describe('createRecurring', () => {
  it('creates a template and returns 201', async () => {
    const res = await createRecurring(makeEvent(validBody), 'user-1', {});

    expect(res.statusCode).toBe(201);
    const { recurring } = JSON.parse(res.body);
    expect(recurring).toMatchObject({ ...validBody, handledPeriod: null });
    expect(recurring.recurringId).toMatch(/^[0-9a-f-]{36}$/);
    expect(recurring.createdAt).toBe(recurring.updatedAt);
  });

  it('stores the item under the caller\'s key, ignoring key fields in the body', async () => {
    const res = await createRecurring(makeEvent({ ...validBody, PK: 'USER#evil', SK: 'RECUR#x', userId: 'evil' }), 'user-1', {});

    const { recurringId } = JSON.parse(res.body).recurring;
    const item = await store.get({ PK: 'USER#user-1', SK: `RECUR#${recurringId}` });
    expect(item).toMatchObject({ PK: 'USER#user-1', SK: `RECUR#${recurringId}` });
    expect(item).not.toHaveProperty('userId');
    expect(await store.query('USER#evil')).toEqual([]);
  });

  it('defaults the note to empty and leadDays to 3, and trims the note', async () => {
    const { description: _omit, leadDays: _omit2, ...rest } = validBody;
    const res = await createRecurring(makeEvent(rest), 'user-1', {});
    expect(JSON.parse(res.body).recurring).toMatchObject({ description: '', leadDays: 3 });

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
    ['leadDays 31 for a monthly item', { leadDays: 31 }],
    ['fractional leadDays', { leadDays: 2.5 }],
    ['a 201 character note', { description: 'a'.repeat(201) }],
    ['a non-string note', { description: 42 }],
  ])('rejects %s with 400 and writes nothing', async (_label, override) => {
    const res = await createRecurring(makeEvent({ ...validBody, ...override }), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(await store.query('USER#user-1')).toEqual([]);
  });

  it.each([
    ['malformed JSON', undefined, '{'],
    ['a JSON array', [1, 2], undefined],
    ['a JSON string', 'hello', undefined],
  ])('rejects %s with 400', async (_label, body, rawBody) => {
    const res = await createRecurring(makeEvent(body, rawBody), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Invalid JSON body');
    expect(await store.query('USER#user-1')).toEqual([]);
  });
});
const storedItem = {
  SK: 'RECUR#r1', recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 3, handledPeriod: '2026-08', createdAt: 'c', updatedAt: 'u',
};
const r1Key = { PK: 'USER#user-1', SK: 'RECUR#r1' };

describe('updateRecurring', () => {
  it('replaces the editable fields and returns the updated item', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await updateRecurring(makeEvent({ ...validBody, amount: 250000 }), 'user-1', { recurringId: 'r1' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recurring.amount).toBe(250000);
    expect(await store.get(r1Key)).toMatchObject({ amount: 250000 });
  });

  it('never overwrites handledPeriod or createdAt', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    await updateRecurring(makeEvent({ ...validBody, handledPeriod: '2030-01', createdAt: 'x' }), 'user-1', { recurringId: 'r1' });
    expect(await store.get(r1Key)).toMatchObject({ handledPeriod: '2026-08', createdAt: 'c' });
  });

  it('requires the item to exist and returns 404 without creating it', async () => {
    const res = await updateRecurring(makeEvent(validBody), 'user-1', { recurringId: 'missing' });
    expect(res.statusCode).toBe(404);
    expect(await store.query('USER#user-1')).toEqual([]);
  });

  it('builds the key from the caller, so another user\'s id is not found for them', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await updateRecurring(makeEvent({ ...validBody, PK: 'USER#user-1' }), 'user-2', { recurringId: 'r1' });
    expect(res.statusCode).toBe(404);
    expect(await store.query('USER#user-2')).toEqual([]);
    expect(await store.get(r1Key)).toMatchObject({ amount: 240000 });
  });

  it('rejects invalid input with 400 and writes nothing', async () => {
    const spy = vi.spyOn(store, 'patch');
    const res = await updateRecurring(makeEvent({ ...validBody, dayOfMonth: 40 }), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a missing id and malformed JSON with 400', async () => {
    expect((await updateRecurring(makeEvent(validBody), 'user-1', {})).statusCode).toBe(400);
    expect((await updateRecurring(makeEvent(undefined, '{'), 'user-1', { recurringId: 'r1' })).statusCode).toBe(400);
  });

  it('rethrows unexpected errors', async () => {
    vi.spyOn(store, 'patch').mockRejectedValueOnce(new Error('boom'));
    await expect(updateRecurring(makeEvent(validBody), 'user-1', { recurringId: 'r1' })).rejects.toThrow('boom');
  });
});

describe('updateRecurring on a monthly bill', () => {
  it('stores anchorDate as null and keeps createdAt', async () => {
    await seedUser(store, 'user-1', [{
      SK: 'RECUR#r1', recurringId: 'r1', type: 'EXPENSE', categoryId: 'cat-rent', amount: 1000, description: 'Rent',
      dayOfMonth: 1, frequency: 'MONTHLY', anchorDate: null, leadDays: 3, handledPeriod: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
    const res = await updateRecurring(
      makeEvent({ type: 'EXPENSE', categoryId: 'cat-rent', amount: 1200, description: 'Rent', dayOfMonth: 2, frequency: 'MONTHLY' }),
      'user-1',
      { recurringId: 'r1' },
    );
    expect(res.statusCode).toBe(200);
    expect(await store.get({ PK: 'USER#user-1', SK: 'RECUR#r1' })).toMatchObject({
      amount: 1200, dayOfMonth: 2, anchorDate: null, createdAt: '2026-01-01T00:00:00.000Z', handledPeriod: null,
    });
  });

  it('answers 404 and creates nothing for an unknown id', async () => {
    const res = await updateRecurring(
      makeEvent({ type: 'EXPENSE', categoryId: 'cat-rent', amount: 1200, dayOfMonth: 2, frequency: 'MONTHLY' }),
      'user-1',
      { recurringId: 'nope' },
    );
    expect(res.statusCode).toBe(404);
    expect(await store.query('USER#user-1')).toEqual([]);
  });
});

describe('deleteRecurring', () => {
  it('moves the item under the caller\'s key to the trash and returns 204', async () => {
    await seedUser(store, 'user-1', [{ SK: 'RECUR#r1', recurringId: 'r1' }]);
    const res = await deleteRecurring(makeEvent(), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(204);
    expect(await store.get(r1Key)).toBeUndefined();
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#RECURRING#r1' })).toMatchObject({ entityType: 'RECURRING' });
  });

  it('is idempotent and scoped to the caller', async () => {
    await seedUser(store, 'user-1', [{ SK: 'RECUR#r1', recurringId: 'r1' }]);
    const res = await deleteRecurring(makeEvent(), 'user-2', { recurringId: 'r1' });
    expect(res.statusCode).toBe(204);
    expect(await store.get(r1Key)).toMatchObject({ recurringId: 'r1' });
    expect(await store.query('USER#user-2')).toEqual([]);
  });

  it('rejects a missing id with 400', async () => {
    const spy = vi.spyOn(store, 'get');
    expect((await deleteRecurring(makeEvent(), 'user-1', {})).statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('setRecurringHandled', () => {
  it('sets the handled period and returns the item', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await setRecurringHandled(makeEvent({ period: '2026-09' }), 'user-1', { recurringId: 'r1' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recurring.handledPeriod).toBe('2026-09');
    expect(await store.get(r1Key)).toMatchObject({ handledPeriod: '2026-09' });
  });

  it('accepts null to clear the marker', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await setRecurringHandled(makeEvent({ period: null }), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(200);
    expect(await store.get(r1Key)).toMatchObject({ handledPeriod: null });
  });

  it.each([
    ['month 13', { period: '2026-13' }],
    ['month 00', { period: '2026-00' }],
    ['a one-digit month', { period: '2026-1' }],
    ['an impossible date', { period: '2026-02-30' }],
    ['a date with a one-digit day', { period: '2026-09-1' }],
    ['a number', { period: 202609 }],
    ['text', { period: 'abc' }],
    ['a missing period', {}],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const spy = vi.spyOn(store, 'patch');
    const res = await setRecurringHandled(makeEvent(body), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 404 when the item does not exist for the caller', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await setRecurringHandled(makeEvent({ period: '2026-09' }), 'user-2', { recurringId: 'r1' });
    expect(res.statusCode).toBe(404);
    expect(await store.query('USER#user-2')).toEqual([]);
    expect(await store.get(r1Key)).toMatchObject({ handledPeriod: '2026-08' });
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

describe('validateRecurringInput schedules', () => {
  const base = { type: 'EXPENSE', categoryId: 'cat-insurance', amount: 36000, description: 'Insurance', leadDays: 3 };

  it('treats a missing frequency as monthly, keeping dayOfMonth and no anchor', () => {
    const result = validateRecurringInput({ ...base, dayOfMonth: 14 });
    expect(result).toMatchObject({ ok: true, value: { frequency: 'MONTHLY', anchorDate: null, dayOfMonth: 14 } });
  });

  it('ignores an anchor date on a monthly item', () => {
    const result = validateRecurringInput({ ...base, frequency: 'MONTHLY', dayOfMonth: 5, anchorDate: '2026-03-14' });
    expect(result).toMatchObject({ ok: true, value: { anchorDate: null, dayOfMonth: 5 } });
  });

  it.each(['WEEKLY', 'FOUR_WEEKLY', 'QUARTERLY', 'YEARLY'])('accepts %s with an anchor date and takes the day from it', frequency => {
    const result = validateRecurringInput({ ...base, frequency, anchorDate: '2026-03-14' });
    expect(result).toMatchObject({ ok: true, value: { frequency, anchorDate: '2026-03-14', dayOfMonth: 14 } });
  });

  it.each(['WEEKLY', 'FOUR_WEEKLY', 'QUARTERLY', 'YEARLY'])('requires an anchor date for %s', frequency => {
    expect(validateRecurringInput({ ...base, frequency }).ok).toBe(false);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-3-14', '14/03/2026', 20260314, null])('rejects the anchor date %s', anchorDate => {
    expect(validateRecurringInput({ ...base, frequency: 'YEARLY', anchorDate }).ok).toBe(false);
  });

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(validateRecurringInput({ ...base, frequency: 'YEARLY', anchorDate: '2028-02-29' }).ok).toBe(true);
    expect(validateRecurringInput({ ...base, frequency: 'YEARLY', anchorDate: '2027-02-29' }).ok).toBe(false);
  });

  it.each(['HOURLY', 'weekly', 7, ''])('rejects the frequency %s', frequency => {
    expect(validateRecurringInput({ ...base, frequency, anchorDate: '2026-03-14', dayOfMonth: 14 }).ok).toBe(false);
  });

  it.each([
    ['WEEKLY', 14, 15],
    ['FOUR_WEEKLY', 14, 15],
    ['MONTHLY', 30, 31],
    ['QUARTERLY', 60, 61],
    ['YEARLY', 60, 61],
  ])('allows %s warnings up to %i days and rejects %i', (frequency, max, over) => {
    const extra = { ...base, frequency, anchorDate: '2026-03-14', dayOfMonth: 14 };
    expect(validateRecurringInput({ ...extra, leadDays: max }).ok).toBe(true);
    expect(validateRecurringInput({ ...extra, leadDays: over }).ok).toBe(false);
  });

  it('defaults the warning to three days', () => {
    const result = validateRecurringInput({ ...base, leadDays: undefined, dayOfMonth: 1 });
    expect(result).toMatchObject({ ok: true, value: { leadDays: 3 } });
  });
});

describe('recurring schedules over the API', () => {
  it('stores the frequency and anchor on create and returns them', async () => {
    const res = await createRecurring(
      makeEvent({ ...validBody, type: 'EXPENSE', frequency: 'YEARLY', anchorDate: '2027-03-14', leadDays: 30 }),
      'user-1',
      {},
    );
    expect(res.statusCode).toBe(201);
    const { recurring } = JSON.parse(res.body);
    expect(recurring).toMatchObject({ frequency: 'YEARLY', anchorDate: '2027-03-14' });
    expect(await store.get({ PK: 'USER#user-1', SK: `RECUR#${recurring.recurringId}` })).toMatchObject({
      frequency: 'YEARLY', anchorDate: '2027-03-14', dayOfMonth: 14,
    });
  });

  it('updates the schedule fields', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    await updateRecurring(
      makeEvent({ ...validBody, frequency: 'WEEKLY', anchorDate: '2026-09-07' }),
      'user-1',
      { recurringId: 'r1' },
    );
    expect(await store.get(r1Key)).toMatchObject({ frequency: 'WEEKLY', anchorDate: '2026-09-07' });
  });

  it('clears the anchor when an item goes back to monthly', async () => {
    await seedUser(store, 'user-1', [{ ...storedItem, frequency: 'WEEKLY', anchorDate: '2026-09-07' }]);
    await updateRecurring(makeEvent({ ...validBody, frequency: 'MONTHLY', anchorDate: '2026-09-07' }), 'user-1', { recurringId: 'r1' });
    expect(await store.get(r1Key)).toMatchObject({ frequency: 'MONTHLY', anchorDate: null });
  });

  it('reads an item saved before schedules existed as monthly', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await getRecurring(makeEvent(), 'user-1', {});
    expect(JSON.parse(res.body).recurring[0]).toMatchObject({ frequency: 'MONTHLY', anchorDate: null, handledPeriod: '2026-08' });
  });

  it('accepts an occurrence date as the handled marker', async () => {
    await seedUser(store, 'user-1', [storedItem]);
    const res = await setRecurringHandled(makeEvent({ period: '2026-09-14' }), 'user-1', { recurringId: 'r1' });
    expect(res.statusCode).toBe(200);
    expect(await store.get(r1Key)).toMatchObject({ handledPeriod: '2026-09-14' });
  });
});
