import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { flushQueue } from '~/lib/flushQueue';
import { queryKeys, useApi } from '~/lib/queries';
import type { Api } from '~/lib/api';

type PendingMap = Record<string, { lastError?: string }>;

export interface OfflineQueueState {
  pendingMap: PendingMap;
  flushNow: () => Promise<void>;
}

// Module-level, not per-hook-instance: there is only ever one IndexedDB queue
// for the whole app, so every `flushNow` call (from any hook instance) must
// share the same in-flight run. This is what stops `online` and
// `visibilitychange` (or the launch hydration and a manual click) from firing
// two concurrent `flushQueue` runs that could send the same queued entry twice.
let inFlightFlush: Promise<void> | null = null;

function runFlush(api: Api, qc: QueryClient): Promise<void> {
  if (inFlightFlush) return inFlightFlush;
  const run = flushQueue(api, qc).finally(() => {
    inFlightFlush = null;
  });
  inFlightFlush = run;
  return run;
}

export function useOfflineQueue(): OfflineQueueState {
  const api = useApi();
  const qc = useQueryClient();
  const { data: pendingMap = {} } = useQuery<PendingMap>({
    queryKey: queryKeys.offlineQueue,
    queryFn: () => ({}),
    initialData: {},
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function flushNow(): Promise<void> {
    await runFlush(api, qc);
  }

  return { pendingMap, flushNow };
}
