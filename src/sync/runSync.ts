import { classifyProviderError } from './errors';
import type { Logger } from './log';
import type { SyncStore } from './store';
import { deriveTxnKeys } from './txnKey';
import type {
  BankProvider, ConnectedAccount, Connection, ConnectionStatus, InboxItem,
  ProviderId, ProviderTransaction, PsuContext, SyncResult,
} from './types';
import { syncWindow } from './window';

export const LOCK_STALE_MS = 10 * 60_000;
export const MIN_ACCOUNT_BUDGET_MS = 60_000;
export const ERROR_THRESHOLD = 3;

export interface RunSyncDeps {
  store: SyncStore;
  providers: Record<ProviderId, BankProvider>;
  now: () => number;
  deadline: number;
  log: Logger;
}

export type UserSyncOutcome = SyncResult | 'LOCKED' | 'FAILED';

type ConnectionPatch = Partial<Pick<Connection, 'accounts' | 'status' | 'consecutiveFailures' | 'lastError'>>;

const toIso = (ms: number): string => new Date(ms).toISOString();

export function toInboxItem(
  transaction: ProviderTransaction,
  txnKey: string,
  connectionId: string,
  accountUid: string,
  importedAt: string,
): InboxItem {
  return {
    txnKey,
    amount: transaction.amountPence,
    direction: transaction.direction,
    suggestedType: transaction.direction === 'IN' ? 'INCOME' : 'EXPENSE',
    description: transaction.description,
    bookingDate: transaction.bookingDate,
    connectionId,
    accountUid,
    importedAt,
  };
}

export async function runSync(deps: RunSyncDeps, userIds: string[], psu?: PsuContext): Promise<Record<string, UserSyncOutcome>> {
  const results: Record<string, UserSyncOutcome> = {};
  for (const userId of userIds) {
    try {
      results[userId] = await syncUser(deps, userId, psu);
    } catch (error) {
      results[userId] = 'FAILED';
      deps.log('sync.user_failed', { errorType: classifyProviderError(error) });
    }
  }
  return results;
}

async function syncUser(deps: RunSyncDeps, userId: string, psu?: PsuContext): Promise<SyncResult | 'LOCKED'> {
  const startedAt = deps.now();
  const acquired = await deps.store.acquireLock(userId, toIso(startedAt), toIso(startedAt - LOCK_STALE_MS));
  if (!acquired) return 'LOCKED';

  const result: SyncResult = { imported: 0, skipped: 0, failedAccounts: 0, partial: false };
  try {
    const connections = await deps.store.listConnections(userId);
    for (const connection of connections) {
      await syncConnection(deps, userId, connection, result, psu);
      if (result.partial) break;
    }
  } finally {
    await deps.store.releaseLock(userId, toIso(deps.now()), result);
  }

  deps.log('sync.user_done', {
    imported: result.imported,
    skipped: result.skipped,
    failedAccounts: result.failedAccounts,
    partial: result.partial,
    durationMs: deps.now() - startedAt,
  });
  return result;
}

async function syncConnection(
  deps: RunSyncDeps,
  userId: string,
  initial: Connection,
  result: SyncResult,
  psu?: PsuContext,
): Promise<void> {
  if (initial.status === 'EXPIRED') return;

  let connection = initial;
  let failureRecorded = false;

  const save = async (patch: ConnectionPatch): Promise<boolean> => {
    const next: Connection = { ...connection, ...patch, updatedAt: toIso(deps.now()) };
    const saved = await deps.store.replaceConnectionIfUnchanged(userId, next, connection.updatedAt);
    if (saved) connection = next;
    return saved;
  };

  if (Date.parse(connection.auth.consentValidUntil) <= deps.now()) {
    await save({ status: 'EXPIRED' });
    return;
  }

  const provider = deps.providers[connection.provider];

  for (const account of initial.accounts) {
    if (deps.deadline - deps.now() < MIN_ACCOUNT_BUDGET_MS) {
      result.partial = true;
      return;
    }

    try {
      const window = syncWindow(account, toIso(deps.now()).slice(0, 10));
      const transactions = await provider.fetchTransactions(connection, account, window, { psu, deadline: deps.deadline });
      const counts = await importTransactions(deps, userId, connection, account, transactions);
      result.imported += counts.imported;
      result.skipped += counts.skipped;

      const syncedAt = toIso(deps.now());
      const accounts = connection.accounts.map(a => (a.accountUid === account.accountUid ? { ...a, lastSyncedAt: syncedAt } : a));
      const patch: ConnectionPatch = failureRecorded
        ? { accounts }
        : { accounts, status: 'ACTIVE', consecutiveFailures: 0, lastError: undefined };
      const saved = await save(patch);
      if (!saved) return;
    } catch (error) {
      const type = classifyProviderError(error);
      result.failedAccounts += 1;
      deps.log('sync.account_failed', { connectionId: connection.connectionId, errorType: type });
      const lastError = { type, at: toIso(deps.now()) };

      if (type === 'EXPIRED') {
        await save({ status: 'EXPIRED', lastError });
        return;
      }

      if (!failureRecorded) {
        failureRecorded = true;
        const consecutiveFailures = initial.consecutiveFailures + 1;
        const status: ConnectionStatus = consecutiveFailures >= ERROR_THRESHOLD ? 'ERROR' : connection.status;
        const saved = await save({ consecutiveFailures, status, lastError });
        if (!saved) return;
      }

      if (type === 'RATE_LIMITED') return;
    }
  }
}

async function importTransactions(
  deps: RunSyncDeps,
  userId: string,
  connection: Connection,
  account: ConnectedAccount,
  transactions: ProviderTransaction[],
): Promise<{ imported: number; skipped: number }> {
  const keys = deriveTxnKeys(connection.provider, account.dedupeId, transactions);
  const unseen = await deps.store.filterUnseen(userId, keys);
  const importedAt = toIso(deps.now());
  let imported = 0;
  let skipped = 0;

  for (const [index, transaction] of transactions.entries()) {
    const txnKey = keys[index];
    if (!unseen.has(txnKey)) {
      skipped += 1;
      continue;
    }
    const item = toInboxItem(transaction, txnKey, connection.connectionId, account.accountUid, importedAt);
    const outcome = await deps.store.importItem(userId, item);
    if (outcome === 'IMPORTED') imported += 1;
    else skipped += 1;
  }

  return { imported, skipped };
}
