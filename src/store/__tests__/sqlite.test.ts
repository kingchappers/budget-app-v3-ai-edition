import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prefixUpperBound, SqliteStore } from '../sqlite';

const PK = 'USER#u1';

describe('SqliteStore on disk', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sqlite-store-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('keeps data across reopening and records the schema version', async () => {
    const path = join(dir, 'budget.sqlite');
    const first = new SqliteStore(path);
    await first.put({ PK, SK: 'CAT#a', name: 'Food' });
    first.close();

    const second = new SqliteStore(path);
    expect(await second.get({ PK, SK: 'CAT#a' })).toMatchObject({ name: 'Food' });
    second.close();

    const raw = new DatabaseSync(path);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    raw.close();
  });

  it('refuses a database created by a newer version of the app', () => {
    const path = join(dir, 'newer.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    expect(() => new SqliteStore(path)).toThrow(/newer version/);
  });
});

describe('purgeExpired', () => {
  it('removes only items whose expiresAt has passed and reports how many', async () => {
    const store = new SqliteStore(':memory:');
    await store.put({ PK, SK: 'TRASH#a', expiresAt: 100 });
    await store.put({ PK, SK: 'TRASH#b', expiresAt: 300 });
    await store.put({ PK, SK: 'CAT#keep', name: 'no expiry' });

    expect(store.purgeExpired(200)).toBe(1);
    expect((await store.query(PK)).map(item => item.SK)).toEqual(['CAT#keep', 'TRASH#b']);
  });

  it('does not hide an expired item from reads before it is purged', async () => {
    const store = new SqliteStore(':memory:');
    await store.put({ PK, SK: 'TRASH#a', expiresAt: 100 });
    expect(await store.get({ PK, SK: 'TRASH#a' })).toMatchObject({ expiresAt: 100 });
  });

  it('follows a patch that changes expiresAt', async () => {
    const store = new SqliteStore(':memory:');
    await store.put({ PK, SK: 'TRASH#a', expiresAt: 100 });
    await store.patch({ PK, SK: 'TRASH#a' }, { expiresAt: 900 });
    expect(store.purgeExpired(200)).toBe(0);
    expect(store.purgeExpired(1000)).toBe(1);
  });
});

describe('prefix ranges', () => {
  it('bumps the last character to form the exclusive upper bound', () => {
    expect(prefixUpperBound('TXN#')).toBe('TXN$');
    expect(prefixUpperBound('a')).toBe('b');
  });

  it('gives up on a last character that cannot be bumped', () => {
    expect(prefixUpperBound('a￿')).toBeNull();
    expect(prefixUpperBound('a\ud83d')).toBeNull();
  });

  it('still finds keys under a prefix that ends in U+FFFF', async () => {
    const store = new SqliteStore(':memory:');
    for (const SK of ['p￿', 'p￿x', 'q', 'p']) await store.put({ PK, SK, n: 1 });
    const items = await store.query(PK, { skPrefix: 'p￿' });
    expect(items.map(item => item.SK)).toEqual(['p￿', 'p￿x']);
  });

  it('finds keys when the prefix ends in the highest ASCII character', async () => {
    const store = new SqliteStore(':memory:');
    for (const SK of ['a~', 'a~z', 'a\u007f', 'b']) await store.put({ PK, SK, n: 1 });
    const items = await store.query(PK, { skPrefix: 'a~' });
    expect(items.map(item => item.SK)).toEqual(['a~', 'a~z']);
  });
});
