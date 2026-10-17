import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../memory';

describe('MemoryStore isolation', () => {
  it('does not let a caller change stored data through the object it put', async () => {
    const store = new MemoryStore();
    const item = { PK: 'U#1', SK: 'CAT#a', nested: { n: 1 }, list: [1] };
    await store.put(item);
    item.nested.n = 99;
    item.list.push(2);
    expect(await store.get({ PK: 'U#1', SK: 'CAT#a' })).toEqual({ PK: 'U#1', SK: 'CAT#a', nested: { n: 1 }, list: [1] });
  });

  it('does not let a caller change stored data through an object it read', async () => {
    const store = new MemoryStore();
    await store.put({ PK: 'U#1', SK: 'CAT#a', nested: { n: 1 } });
    const read = await store.get({ PK: 'U#1', SK: 'CAT#a' });
    (read as unknown as { nested: { n: number } }).nested.n = 99;
    const queried = await store.query('U#1');
    (queried[0] as unknown as { nested: { n: number } }).nested.n = 77;
    expect(await store.get({ PK: 'U#1', SK: 'CAT#a' })).toMatchObject({ nested: { n: 1 } });
  });

  it('keeps separate stores separate', async () => {
    const first = new MemoryStore();
    const second = new MemoryStore();
    await first.put({ PK: 'U#1', SK: 'CAT#a', name: 'x' });
    expect(await second.get({ PK: 'U#1', SK: 'CAT#a' })).toBeUndefined();
  });

  it('applies nothing when transact is given the same item twice', async () => {
    const store = new MemoryStore();
    await expect(store.transact([
      { put: { PK: 'U#1', SK: 'A', n: 1 } },
      { put: { PK: 'U#1', SK: 'B', n: 2 } },
      { delete: { PK: 'U#1', SK: 'A' } },
    ])).rejects.toThrow();
    expect(await store.query('U#1')).toEqual([]);
  });
});
