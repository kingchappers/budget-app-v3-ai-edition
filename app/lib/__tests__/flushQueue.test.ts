import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '~/lib/apiError';
import { dequeue, enqueue, listQueue } from '../offlineQueue';
import { flushQueue } from '../flushQueue';
import { queryKeys } from '../queries';
import type { Api } from '../api';

function makeApi(overrides: Partial<Api> = {}): Api {
  return { createTransaction: vi.fn() } as unknown as Api & typeof overrides;
}

async function clearQueue(): Promise<void> {
  const entries = await listQueue();
  await Promise.all(entries.map(e => dequeue(e.id)));
}

describe('flushQueue', () => {
  let qc: QueryClient;
  beforeEach(async () => {
    qc = new QueryClient();
    await clearQueue();
  });

  it('sends queued entries in order and clears them on success', async () => {
    const order: string[] = [];
    await enqueue({ id: 'first', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'second', queuedAt: '2025-01-05T10:00:01.000Z', userSub: 'user-1', input: { amount: 200, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockImplementation(async (input) => {
      order.push(input.transactionId);
      return { ...input, transactionId: input.transactionId, yearMonth: '2025-01', createdAt: '' };
    });

    await flushQueue(api, qc, 'user-1');

    expect(order).toEqual(['first', 'second']);
    expect(await listQueue()).toHaveLength(0);
  });

  it('never sends the next entry before the previous one settles', async () => {
    await enqueue({ id: 'a', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'b', queuedAt: '2025-01-05T10:00:01.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    let inFlight = 0;
    let sawOverlap = false;
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockImplementation(async (input) => {
      inFlight += 1;
      if (inFlight > 1) sawOverlap = true;
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight -= 1;
      return { ...input, yearMonth: '2025-01', createdAt: '' };
    });

    await flushQueue(api, qc, 'user-1');

    expect(sawOverlap).toBe(false);
  });

  it('stops the whole run on a network failure, leaving remaining entries queued', async () => {
    await enqueue({ id: 'a', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'b', queuedAt: '2025-01-05T10:00:01.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    await flushQueue(api, qc, 'user-1');

    const remaining = await listQueue();
    expect(remaining.map(e => e.id).sort()).toEqual(['a', 'b']);
  });

  it('marks a real-error entry and continues to the next one', async () => {
    await enqueue({ id: 'bad', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'gone', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'good', queuedAt: '2025-01-05T10:00:01.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new ApiError(400, 'categoryId must be an existing category'))
      .mockResolvedValueOnce({ transactionId: 'good', yearMonth: '2025-01', createdAt: '', amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' });

    await flushQueue(api, qc, 'user-1');

    const remaining = await listQueue();
    expect(remaining.map(e => e.id)).toEqual(['bad']);
    expect(remaining[0].lastError).toMatch(/categoryId/);
    expect(qc.getQueryData(queryKeys.offlineQueue)).toMatchObject({ bad: { lastError: expect.stringContaining('categoryId') } });
  });

  it('never sends another user\'s queued entries, on a shared device', async () => {
    await enqueue({ id: 'mine', queuedAt: '2025-01-05T10:00:00.000Z', userSub: 'user-1', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    await enqueue({ id: 'theirs', queuedAt: '2025-01-05T10:00:01.000Z', userSub: 'user-2', input: { amount: 100, type: 'EXPENSE', categoryId: 'cat-1', description: '', date: '2025-01-05' } });
    const api = makeApi();
    (api.createTransaction as ReturnType<typeof vi.fn>).mockImplementation(async (input) => (
      { ...input, yearMonth: '2025-01', createdAt: '' }
    ));

    await flushQueue(api, qc, 'user-1');

    expect(api.createTransaction).toHaveBeenCalledTimes(1);
    expect(api.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'mine' }));
    const remaining = await listQueue();
    expect(remaining.map(e => e.id)).toEqual(['theirs']);
  });
});
