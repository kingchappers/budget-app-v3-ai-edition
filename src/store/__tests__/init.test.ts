import { afterEach, describe, expect, it } from 'vitest';
import { getStore, initStore, setStore } from '..';
import { DynamoStore } from '../dynamo';
import { SqliteStore } from '../sqlite';

afterEach(() => { setStore(undefined); });

describe('initStore', () => {
  it('builds a DynamoStore by default', async () => {
    const store = await initStore({ DYNAMODB_TABLE: 'budget-data' });
    expect(store).toBeInstanceOf(DynamoStore);
    expect(getStore()).toBe(store);
  });

  it('builds a SqliteStore when STORE=sqlite', async () => {
    const store = await initStore({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(store).toBeInstanceOf(SqliteStore);
  });

  it('requires SQLITE_PATH for the sqlite store', async () => {
    await expect(initStore({ STORE: 'sqlite' })).rejects.toThrow('SQLITE_PATH');
  });

  it('rejects an unknown STORE value', async () => {
    await expect(initStore({ STORE: 'postgres' })).rejects.toThrow('Unknown STORE "postgres"');
  });

  it('returns the same store on repeated and concurrent calls', async () => {
    const env = { STORE: 'sqlite', SQLITE_PATH: ':memory:' };
    const [first, second] = await Promise.all([initStore(env), initStore(env)]);
    expect(second).toBe(first);
    expect(await initStore(env)).toBe(first);
  });

  it('can try again after a failed start', async () => {
    await expect(initStore({ STORE: 'sqlite' })).rejects.toThrow();
    const store = await initStore({ STORE: 'sqlite', SQLITE_PATH: ':memory:' });
    expect(store).toBeInstanceOf(SqliteStore);
  });
});
