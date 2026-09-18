import type { ConnectedAccount } from './types';

export type SessionAccount = Pick<ConnectedAccount, 'accountUid' | 'displayName' | 'last4' | 'currency'>;

function findMatch(existing: ConnectedAccount[], account: SessionAccount): ConnectedAccount | undefined {
  return existing.find(e => e.accountUid === account.accountUid)
    ?? existing.find(e => e.last4 !== '' && e.last4 === account.last4 && e.displayName === account.displayName);
}

export function matchAccounts(existing: ConnectedAccount[], incoming: SessionAccount[], today: string): ConnectedAccount[] {
  return incoming.map(account => {
    const match = findMatch(existing, account);
    if (!match) return { ...account, dedupeId: account.accountUid, startDate: today };
    const merged: ConnectedAccount = { ...account, dedupeId: match.dedupeId, startDate: match.startDate };
    if (match.lastSyncedAt) merged.lastSyncedAt = match.lastSyncedAt;
    return merged;
  });
}
