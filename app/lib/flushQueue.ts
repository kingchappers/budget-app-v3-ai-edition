import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiError';
import type { Api } from './api';
import { dequeue, listQueue, markQueueEntryError } from './offlineQueue';
import { queryKeys } from './queries';

type PendingMap = Record<string, { lastError?: string }>;

function setPending(qc: QueryClient, id: string, entry: { lastError?: string } | null): void {
  qc.setQueryData<PendingMap>(queryKeys.offlineQueue, (current = {}) => {
    if (entry === null) {
      const { [id]: _removed, ...rest } = current;
      return rest;
    }
    return { ...current, [id]: entry };
  });
}

export async function flushQueue(api: Api, qc: QueryClient): Promise<void> {
  const entries = await listQueue();
  for (const entry of entries) {
    try {
      const created = await api.createTransaction({ ...entry.input, transactionId: entry.id });
      await dequeue(entry.id);
      setPending(qc, entry.id, null);
      qc.invalidateQueries({ queryKey: queryKeys.transactions(created.yearMonth) });
      qc.invalidateQueries({ queryKey: ['pots'] });
    } catch (error) {
      if (error instanceof ApiError) {
        await markQueueEntryError(entry.id, error.message);
        setPending(qc, entry.id, { lastError: error.message });
        continue;
      }
      return;
    }
  }
}
