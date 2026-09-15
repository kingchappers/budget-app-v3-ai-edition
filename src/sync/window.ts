import type { ConnectedAccount, SyncWindow } from './types';

export const OVERLAP_DAYS = 5;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function syncWindow(account: ConnectedAccount, today: string): SyncWindow {
  if (!account.lastSyncedAt) return { from: account.startDate, to: today };
  const overlapStart = addDays(account.lastSyncedAt.slice(0, 10), -OVERLAP_DAYS);
  return { from: overlapStart > account.startDate ? overlapStart : account.startDate, to: today };
}
