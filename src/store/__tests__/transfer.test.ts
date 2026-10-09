import { describe, expect, it } from 'vitest';
import { SqliteStore } from '../sqlite';
import { exportUser, importUser, parseJsonl, toJsonl } from '../transfer';

const seed = async (store: SqliteStore): Promise<void> => {
  await store.put({ PK: 'USER#auth0|abc', SK: 'CAT#c1', name: 'Garden', archivedAt: null });
  await store.put({ PK: 'USER#auth0|abc', SK: 'TXN#2026-10#t1', amount: 350 });
  await store.put({ PK: 'USER#auth0|abc', SK: 'TRASH#TARGET#c1', expiresAt: 4102444800 });
  await store.put({ PK: 'USER#auth0|abc', SK: 'PUSHSUB#hash', endpoint: 'https://fcm.googleapis.com/x' });
  await store.put({ PK: 'PUSHIDX', SK: 'USER#auth0|abc', updatedAt: 'x' });
  await store.put({ PK: 'USER#someone-else', SK: 'CAT#other', name: 'Other' });
};

describe('exportUser', () => {
  it('exports one partition, keeping trash and leaving out push subscriptions', async () => {
    const store = new SqliteStore(':memory:');
    await seed(store);
    const items = await exportUser(store, 'auth0|abc');
    expect(items.map(item => item.SK)).toEqual(['CAT#c1', 'TRASH#TARGET#c1', 'TXN#2026-10#t1']);
  });
});

describe('JSONL', () => {
  it('round-trips items, including null and expiry', async () => {
    const store = new SqliteStore(':memory:');
    await seed(store);
    const items = await exportUser(store, 'auth0|abc');
    expect(parseJsonl(toJsonl(items))).toEqual(items);
  });

  it('names the line of a malformed record', () => {
    expect(() => parseJsonl('{"PK":"USER#a","SK":"x"}\nnot json\n')).toThrow('Line 2 is not valid JSON');
    expect(() => parseJsonl('{"PK":"USER#a"}\n')).toThrow('Line 1 is missing PK or SK');
    expect(() => parseJsonl('[1]\n')).toThrow('Line 1 is not an object');
  });

  it('ignores blank lines', () => {
    expect(parseJsonl('\n{"PK":"USER#a","SK":"x"}\n\n')).toHaveLength(1);
  });
});

describe('importUser', () => {
  it('moves the data to the new user id, including between backends', async () => {
    const source = new SqliteStore(':memory:');
    await seed(source);
    const target = new SqliteStore(':memory:');

    const count = await importUser(target, await exportUser(source, 'auth0|abc'), { asUser: 'local-1' });

    expect(count).toBe(3);
    const copied = await target.query('USER#local-1');
    expect(copied.map(item => item.SK)).toEqual(['CAT#c1', 'TRASH#TARGET#c1', 'TXN#2026-10#t1']);
    expect(copied[0]).toEqual({ PK: 'USER#local-1', SK: 'CAT#c1', name: 'Garden', archivedAt: null });
    expect(copied[1]).toMatchObject({ expiresAt: 4102444800 });
    expect(await target.query('USER#auth0|abc')).toEqual([]);
  });

  it('refuses to write into a user that already has data', async () => {
    const target = new SqliteStore(':memory:');
    await target.put({ PK: 'USER#local-1', SK: 'CAT#existing', name: 'Keep me' });
    await expect(importUser(target, [{ PK: 'USER#a', SK: 'CAT#x' }], { asUser: 'local-1' }))
      .rejects.toThrow('already has data');
    expect(await target.get({ PK: 'USER#local-1', SK: 'CAT#existing' })).toBeDefined();
  });

  it('replaces the existing data when asked', async () => {
    const target = new SqliteStore(':memory:');
    await target.put({ PK: 'USER#local-1', SK: 'CAT#old', name: 'Old' });
    await importUser(target, [{ PK: 'USER#a', SK: 'CAT#new', name: 'New' }], { asUser: 'local-1', replace: true });
    expect((await target.query('USER#local-1')).map(item => item.SK)).toEqual(['CAT#new']);
  });

  it('rejects a file with more than one partition or a non-user partition', async () => {
    const target = new SqliteStore(':memory:');
    await expect(importUser(target, [{ PK: 'USER#a', SK: 'x' }, { PK: 'USER#b', SK: 'y' }], { asUser: 'z' }))
      .rejects.toThrow('more than one user');
    await expect(importUser(target, [{ PK: 'PUSHIDX', SK: 'USER#a' }], { asUser: 'z' }))
      .rejects.toThrow('USER#');
  });

  it('skips push subscriptions if a hand-edited file contains them', async () => {
    const target = new SqliteStore(':memory:');
    const count = await importUser(
      target,
      [{ PK: 'USER#a', SK: 'CAT#x' }, { PK: 'USER#a', SK: 'PUSHSUB#h', endpoint: 'e' }],
      { asUser: 'z' },
    );
    expect(count).toBe(1);
    expect(await target.query('USER#z', { skPrefix: 'PUSHSUB#' })).toEqual([]);
  });
});
