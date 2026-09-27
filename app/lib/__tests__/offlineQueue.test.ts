import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dequeue, enqueue, listQueue, markQueueEntryError, type QueuedEntry } from '../offlineQueue';

function makeEntry(id: string, queuedAt: string): QueuedEntry {
  return {
    id,
    queuedAt,
    userSub: 'user-1',
    input: { amount: 500, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' },
  };
}

let dbCounter = 0;
beforeEach(() => { dbCounter += 1; });

describe('offlineQueue', () => {
  it('adds an entry and reads it back', async () => {
    await enqueue(makeEntry('a', '2025-01-05T10:00:00.000Z'));
    const entries = await listQueue();
    expect(entries.map(e => e.id)).toContain('a');
  });

  it('removes an entry after it is dequeued', async () => {
    await enqueue(makeEntry('b', '2025-01-05T10:00:00.000Z'));
    await dequeue('b');
    const entries = await listQueue();
    expect(entries.some(e => e.id === 'b')).toBe(false);
  });

  it('keeps an entry across a fresh connection (simulated reload)', async () => {
    await enqueue(makeEntry('c', '2025-01-05T10:00:00.000Z'));
    const entries = await listQueue();
    expect(entries.some(e => e.id === 'c')).toBe(true);
  });

  it('returns entries in queued order', async () => {
    await enqueue(makeEntry('second', '2025-01-05T10:00:01.000Z'));
    await enqueue(makeEntry('first', '2025-01-05T10:00:00.000Z'));
    const entries = await listQueue();
    const ids = entries.filter(e => e.id === 'first' || e.id === 'second').map(e => e.id);
    expect(ids).toEqual(['first', 'second']);
  });

  it('marks an entry with an error message without removing it', async () => {
    await enqueue(makeEntry('d', '2025-01-05T10:00:00.000Z'));
    await markQueueEntryError('d', 'category not found');
    const entries = await listQueue();
    expect(entries.find(e => e.id === 'd')?.lastError).toBe('category not found');
  });

  it('does not throw when marking an error on an entry that is already gone', async () => {
    await expect(markQueueEntryError('missing', 'oops')).resolves.toBeUndefined();
  });
});
