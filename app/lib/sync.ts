import { ApiError } from './apiError';
import type { PendingSync, SyncStatus } from './types';

export const SYNC_MAX_WAIT_MS = 6 * 60_000;

export function isSyncFinished(status: SyncStatus | undefined, pending: PendingSync): boolean {
  return status?.state === 'IDLE' && (status.finishedAt ?? null) !== pending.baselineFinishedAt;
}

export function shouldPollSync(status: SyncStatus | undefined, pending: PendingSync | null, nowMs: number): boolean {
  if (status?.state === 'RUNNING') return true;
  if (!pending) return false;
  if (nowMs - pending.requestedAt > SYNC_MAX_WAIT_MS) return false;
  return !isSyncFinished(status, pending);
}

export function syncErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return 'A sync is already running';
  if (error instanceof ApiError && error.status === 429) return 'Synced recently — try again in a few minutes';
  return 'Sync could not start. Please try again.';
}
