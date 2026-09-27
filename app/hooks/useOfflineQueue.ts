import { useCallback } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { flushQueue } from '~/lib/flushQueue';
import { discardQueuedEntry, OFFLINE_QUEUE_KEY, type PendingMap } from '~/lib/pendingEntries';
import { useApi } from '~/lib/queries';
import type { Api } from '~/lib/api';

export interface OfflineQueueState {
  pendingMap: PendingMap;
  flushNow: () => Promise<void>;
  // Removes a still-unsent entry (a row's "Discard" menu action). Exposed
  // here, rather than making every caller import discardQueuedEntry and
  // useQueryClient itself, so a component using this hook needs no
  // QueryClientProvider of its own in tests that already mock this hook.
  discard: (transactionId: string) => Promise<void>;
}

// Module-level, not per-hook-instance: there is only ever one IndexedDB queue
// for the whole app, so every `flushNow` call (from any hook instance) must
// share the same in-flight run. This is what stops `online` and
// `visibilitychange` (or the launch hydration and a manual click) from firing
// two concurrent `flushQueue` runs that could send the same queued entry twice.
let inFlightFlush: Promise<void> | null = null;

function runFlush(api: Api, qc: QueryClient, userSub: string): Promise<void> {
  if (inFlightFlush) return inFlightFlush;
  const run = flushQueue(api, qc, userSub).finally(() => {
    inFlightFlush = null;
  });
  inFlightFlush = run;
  return run;
}

export function useOfflineQueue(): OfflineQueueState {
  const api = useApi();
  const qc = useQueryClient();
  const userSub = useAuth0().user?.sub ?? '';
  const { data: pendingMap = {} } = useQuery<PendingMap>({
    queryKey: OFFLINE_QUEUE_KEY,
    queryFn: () => ({}),
    initialData: {},
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Stable across renders: OfflineQueueBanner's hydration effect depends on
  // flushNow, and a new function identity every render would re-run that
  // effect on every render too — including right after a sign-out clears
  // the pending map, which would immediately re-hydrate it straight back.
  const flushNow = useCallback(async (): Promise<void> => {
    if (!userSub) return;
    await runFlush(api, qc, userSub);
  }, [api, qc, userSub]);

  const discard = useCallback(async (transactionId: string): Promise<void> => {
    await discardQueuedEntry(qc, transactionId);
  }, [qc]);

  return { pendingMap, flushNow, discard };
}
