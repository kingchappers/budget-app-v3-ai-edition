import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiError';
import type { Api } from './api';
import { dequeue, listQueue, markQueueEntryError } from './offlineQueue';
import { clearPendingEntry, setPendingEntry } from './pendingEntries';
import { queryKeys } from './queries';

export async function flushQueue(api: Api, qc: QueryClient, userSub: string): Promise<void> {
  const entries = (await listQueue()).filter(entry => entry.userSub === userSub);
  for (const entry of entries) {
    try {
      const created = await api.createTransaction({ ...entry.input, transactionId: entry.id });
      await dequeue(entry.id);
      // Wait for the refetch to land before dropping the pending overlay row,
      // so the real row is already in place and nothing blinks out.
      await qc.invalidateQueries({ queryKey: queryKeys.transactions(created.yearMonth) });
      qc.invalidateQueries({ queryKey: ['pots'] });
      clearPendingEntry(qc, entry.id);
    } catch (error) {
      if (error instanceof ApiError) {
        await markQueueEntryError(entry.id, error.message);
        setPendingEntry(qc, { ...entry, lastError: error.message });
        continue;
      }
      return;
    }
  }
}
