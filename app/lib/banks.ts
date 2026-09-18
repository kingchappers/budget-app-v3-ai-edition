import type { BankConnection } from './types';

const DAY_MS = 86_400_000;
const MAX_HISTORY_DAYS = 730;

export function earliestStartDate(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - MAX_HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
}

export function lastSyncedAt(connection: BankConnection): string | null {
  const times = connection.accounts.map(a => a.lastSyncedAt).filter((t): t is string => Boolean(t));
  if (times.length === 0) return null;
  return times.sort().at(-1) ?? null;
}

export function describeSyncAge(iso: string | null, nowMs: number): string {
  if (!iso) return 'Never synced';
  const minutes = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function statusBadge(connection: BankConnection): { label: string; color: 'success' | 'warning' | 'danger' } {
  if (connection.status === 'EXPIRED') return { label: 'Reconnect needed', color: 'danger' };
  if (connection.status === 'ERROR') return { label: 'Sync problem', color: 'warning' };
  return { label: 'Connected', color: 'success' };
}

export function accountLabel(connections: BankConnection[], connectionId: string, accountUid: string): string {
  const connection = connections.find(c => c.connectionId === connectionId);
  const account = connection?.accounts.find(a => a.accountUid === accountUid);
  if (!connection || !account) return 'Bank account';
  const mask = account.last4 ? ` ••${account.last4}` : '';
  return `${connection.displayName} · ${account.displayName}${mask}`;
}
