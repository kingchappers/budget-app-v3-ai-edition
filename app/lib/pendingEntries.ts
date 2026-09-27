import type { QueryClient } from '@tanstack/react-query';
import { dequeue, listQueue, type QueuedEntry } from './offlineQueue';
import type { Transaction } from './types';

// Lives here, not in queries.ts, so queries.ts can import this module without
// creating a cycle (this module has no dependency on queries.ts at all).
export const OFFLINE_QUEUE_KEY = ['offlineQueue'] as const;

// Keyed by transactionId. An entry appears here from the moment a save is
// attempted (online or offline) until it's either confirmed by the server
// (cleared once the refetch that replaces it has completed) or discarded by
// Undo. This is the single source of truth the UI overlays onto a month's
// transaction list — there is no separate "optimistic row written into the
// cache" step anymore, which is what let a refetch silently wipe a pending
// row before.
export type PendingMap = Record<string, QueuedEntry>;

export function setPendingEntry(qc: QueryClient, entry: QueuedEntry): void {
  qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, (current = {}) => ({ ...current, [entry.id]: entry }));
}

export function clearPendingEntry(qc: QueryClient, id: string): void {
  qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, (current = {}) => {
    const { [id]: _removed, ...rest } = current;
    return rest;
  });
}

// Undo on an entry that never reached the server: drop it from IndexedDB and
// the reactive map. Nothing to invalidate — it was never written server-side.
export async function discardQueuedEntry(qc: QueryClient, id: string): Promise<void> {
  await dequeue(id);
  clearPendingEntry(qc, id);
}

// Guards against re-running on every DefaultLayout remount (every route
// renders its own <DefaultLayout>, so a per-component ref resets on each
// navigation). A module-level flag, like flushQueue's own in-flight guard,
// is what actually makes this run once per app lifetime.
let hydratedForSub: string | null = null;

export async function hydrateOnce(qc: QueryClient, userSub: string): Promise<void> {
  if (hydratedForSub === userSub) return;
  hydratedForSub = userSub;
  const entries = (await listQueue()).filter(entry => entry.userSub === userSub);
  qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, () => Object.fromEntries(entries.map(e => [e.id, e])));
}

// Only the reactive map is cleared, never the durable IndexedDB queue: user
// A's unsent entries stay tagged with A's sub and simply don't show or flush
// while B is signed in, then hydrate back in correctly next time A signs in.
export function clearPendingEntriesForLogout(qc: QueryClient): void {
  hydratedForSub = null;
  qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, {});
}

function pendingRow(entry: QueuedEntry): Transaction {
  return {
    ...entry.input,
    transactionId: entry.id,
    yearMonth: entry.input.date.slice(0, 7),
    createdAt: entry.queuedAt,
  };
}

export function pendingRowsForMonth(pendingMap: PendingMap, yearMonth: string): Transaction[] {
  return Object.values(pendingMap)
    .filter(entry => entry.input.date.slice(0, 7) === yearMonth)
    .map(pendingRow);
}
