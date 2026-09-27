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
//
// `queued` distinguishes a genuinely durable (in IndexedDB) offline entry
// from the split-second an ordinary online save spends here before its
// request resolves. Only a `queued: true` entry counts toward the banner,
// the row's pending badge, or the Discard action — otherwise every normal
// save would flash all three for the length of its round trip.
export interface PendingEntry extends QueuedEntry {
  queued: boolean;
}

export type PendingMap = Record<string, PendingEntry>;

export function setPendingEntry(qc: QueryClient, entry: PendingEntry): void {
  qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, (current = {}) => ({ ...current, [entry.id]: entry }));
}

export function clearPendingEntry(qc: QueryClient, id: string): void {
  qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, (current = {}) => {
    const { [id]: _removed, ...rest } = current;
    return rest;
  });
}

// Discard/Undo can land while flushQueue is midway through a run it already
// took a snapshot of (a flush of several entries takes real time). This set
// is how flushQueue learns "skip this one" without a second IndexedDB read
// per entry — an in-memory check right before sending, not a race-prone
// round trip against storage that could itself go stale between the check
// and the send.
const discardedIds = new Set<string>();

export function wasDiscarded(id: string): boolean {
  return discardedIds.has(id);
}

// Undo on an entry that never reached the server: drop it from IndexedDB and
// the reactive map. Nothing to invalidate — it was never written server-side.
export async function discardQueuedEntry(qc: QueryClient, id: string): Promise<void> {
  discardedIds.add(id);
  await dequeue(id);
  clearPendingEntry(qc, id);
}

// Guards against re-running on every DefaultLayout remount (every route
// renders its own <DefaultLayout>, so a per-component ref resets on each
// navigation). A module-level flag, like flushQueue's own in-flight guard,
// is what makes this run once per signed-in user, not once per remount;
// clearPendingEntriesForLogout resets it so a later sign-in (same user or a
// different one) hydrates again.
let hydratedForSub: string | null = null;

export async function hydrateOnce(qc: QueryClient, userSub: string): Promise<void> {
  if (hydratedForSub === userSub) return;
  hydratedForSub = userSub;
  try {
    const entries = (await listQueue()).filter(entry => entry.userSub === userSub);
    // Merge onto whatever is already there rather than replacing the map
    // outright: a save made in the moment between this function being called
    // and listQueue() resolving would otherwise have its (still in-flight,
    // not-yet-queued) overlay row wiped out from under it.
    qc.setQueryData<PendingMap>(OFFLINE_QUEUE_KEY, (current = {}) => ({
      ...current,
      ...Object.fromEntries(entries.map(e => [e.id, { ...e, queued: true }])),
    }));
  } catch (error) {
    // IndexedDB unavailable or the read otherwise failed: allow a later
    // trigger (a sign-out/sign-in, a fresh mount) to retry instead of
    // silently never hydrating again for this user for the rest of the session.
    console.error('Failed to hydrate the offline transaction queue:', error);
    hydratedForSub = null;
  }
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
