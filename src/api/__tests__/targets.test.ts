import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getTargets, upsertTarget, deleteTarget } from '../targets';
import { MAX_AMOUNT_PENCE } from '../constants';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';

let store: SqliteStore;
beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

function makeEvent(body?: object): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    queryStringParameters: {},
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('getTargets', () => {
  it('returns all targets for the user', async () => {
    await seedUser(store, 'user-1', [{ SK: 'TARGET#cat-food', categoryId: 'cat-food', targetAmount: 30000, period: 'MONTHLY' }]);
    const res = await getTargets(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).targets).toHaveLength(1);
  });
});

describe('upsertTarget', () => {
  it('creates or updates a target and returns 200', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: 30000, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.target.targetAmount).toBe(30000);
    expect(body.target.period).toBe('MONTHLY');
    expect(await store.get({ PK: 'USER#user-1', SK: 'TARGET#cat-food' })).toMatchObject({ targetAmount: 30000, period: 'MONTHLY' });
  });

  it('accepts a targetAmount at the maximum cap', async () => {
    const res = await upsertTarget(
      makeEvent({ targetAmount: MAX_AMOUNT_PENCE, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for a targetAmount over the maximum cap', async () => {
    const spy = vi.spyOn(store, 'put');
    const res = await upsertTarget(
      makeEvent({ targetAmount: MAX_AMOUNT_PENCE + 1, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 400 for non-integer targetAmount', async () => {
    const spy = vi.spyOn(store, 'put');
    const res = await upsertTarget(
      makeEvent({ targetAmount: 300.50, period: 'MONTHLY' }),
      'user-1',
      { categoryId: 'cat-food' },
    );
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
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
  it('moves the target to the trash and returns 204', async () => {
    await seedUser(store, 'user-1', [{ SK: 'TARGET#cat-food', categoryId: 'cat-food', targetAmount: 30000 }]);
    const res = await deleteTarget(makeEvent(), 'user-1', { categoryId: 'cat-food' });
    expect(res.statusCode).toBe(204);
    expect(await store.get({ PK: 'USER#user-1', SK: 'TARGET#cat-food' })).toBeUndefined();
    expect(await store.get({ PK: 'USER#user-1', SK: 'TRASH#TARGET#cat-food' })).toMatchObject({ entityType: 'TARGET' });
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await deleteTarget(makeEvent(), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });
});
