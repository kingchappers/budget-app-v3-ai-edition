import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';
import { listSubscribedUsers, loadReminderData, loadSubscriptions, removeSubscription } from '../store';

let store: SqliteStore;
beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

const subscription = (sk: string, over: Record<string, unknown> = {}) => ({
  SK: sk, endpoint: `https://fcm.googleapis.com/${sk}`, p256dh: 'p', auth: 'a', hour: 8,
  quietStart: null, quietEnd: null, timeZone: 'Europe/London', ...over,
});

describe('listSubscribedUsers', () => {
  it('reads the user ids from the index partition', async () => {
    await store.put({ PK: 'PUSHIDX', SK: 'USER#alice', updatedAt: 'x' });
    await store.put({ PK: 'PUSHIDX', SK: 'USER#bob', updatedAt: 'x' });
    expect(await listSubscribedUsers()).toEqual(['alice', 'bob']);
  });
});

describe('loadSubscriptions', () => {
  it('returns null quiet hours as null and the other settings as numbers and text', async () => {
    await seedUser(store, 'u1', [subscription('PUSHSUB#one'), subscription('PUSHSUB#two', { quietStart: 22, quietEnd: 7 })]);
    const loaded = await loadSubscriptions('u1');
    expect(loaded.map(entry => entry.settings)).toEqual([
      { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' },
      { hour: 8, quietStart: 22, quietEnd: 7, timeZone: 'Europe/London' },
    ]);
    expect(loaded[0]).toMatchObject({ sk: 'PUSHSUB#one', p256dh: 'p', auth: 'a' });
  });

  it('ignores other users and other entity types', async () => {
    await seedUser(store, 'u1', [subscription('PUSHSUB#one'), { SK: 'CAT#a', categoryId: 'a' }]);
    await seedUser(store, 'u2', [subscription('PUSHSUB#other')]);
    expect(await loadSubscriptions('u1')).toHaveLength(1);
  });
});

describe('loadReminderData', () => {
  it('loads bills, category ids and transactions from three months back to the month ahead', async () => {
    await seedUser(store, 'u1', [
      { SK: 'RECUR#r1', recurringId: 'r1', type: 'EXPENSE', categoryId: 'cat-rent', amount: 1, dayOfMonth: 1, createdAt: 'x', updatedAt: 'x' },
      { SK: 'CAT#c1', categoryId: 'c1', name: 'Garden' },
      { SK: 'TXN#2026-07#a', transactionId: 'a' },
      { SK: 'TXN#2026-06#old', transactionId: 'old' },
      { SK: 'TXN#2026-11#next', transactionId: 'next' },
      { SK: 'TXN#2026-12#too-far', transactionId: 'far' },
    ]);
    const data = await loadReminderData('u1', '2026-10-05');
    expect(data.recurring.map(entry => entry.recurringId)).toEqual(['r1']);
    expect(data.categories).toEqual([{ categoryId: 'c1' }]);
    expect(data.transactions.map(entry => entry.transactionId).sort()).toEqual(['a', 'next']);
  });
});

describe('removeSubscription', () => {
  it('keeps the index while another device remains and drops it with the last one', async () => {
    await seedUser(store, 'u1', [subscription('PUSHSUB#one'), subscription('PUSHSUB#two')]);
    await store.put({ PK: 'PUSHIDX', SK: 'USER#u1', updatedAt: 'x' });

    await removeSubscription('u1', 'PUSHSUB#one');
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#u1' })).toBeDefined();

    await removeSubscription('u1', 'PUSHSUB#two');
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#u1' })).toBeUndefined();
  });
});
