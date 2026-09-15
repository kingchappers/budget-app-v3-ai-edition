import type { SyncStore } from '../store';
import type {
  BankProvider, ConnectedAccount, Connection, EnableBankingConnection, FetchContext, InboxItem,
  PendingAuth, ProviderTransaction, PsuContext, SeenOutcome, SyncResult, SyncStatus, SyncWindow,
} from '../types';

const key = (userId: string, id: string) => `${userId}|${id}`;

export class FakeSyncStore implements SyncStore {
  users = new Set<string>();
  statuses = new Map<string, SyncStatus>();
  connections = new Map<string, Connection>();
  pendingAuths = new Map<string, PendingAuth>();
  seen = new Map<string, SeenOutcome>();
  inbox = new Map<string, InboxItem>();

  async listSyncUserIds() { return [...this.users]; }
  async registerSyncUser(userId: string) { this.users.add(userId); }
  async unregisterSyncUser(userId: string) { this.users.delete(userId); }

  async acquireLock(userId: string, nowIso: string, staleBeforeIso: string) {
    const current = this.statuses.get(userId);
    if (current?.state === 'RUNNING' && current.startedAt && current.startedAt >= staleBeforeIso) return false;
    this.statuses.set(userId, { ...current, state: 'RUNNING', startedAt: nowIso });
    return true;
  }

  async releaseLock(userId: string, nowIso: string, result: SyncResult) {
    const current = this.statuses.get(userId);
    this.statuses.set(userId, { ...current, state: 'IDLE', finishedAt: nowIso, lastResult: { ...result } });
  }

  async getSyncStatus(userId: string) { return this.statuses.get(userId) ?? null; }

  async listConnections(userId: string) {
    return [...this.connections.entries()]
      .filter(([k]) => k.startsWith(`${userId}|`))
      .map(([, c]) => structuredClone(c));
  }

  async getConnection(userId: string, connectionId: string) {
    const found = this.connections.get(key(userId, connectionId));
    return found ? structuredClone(found) : null;
  }

  async putConnection(userId: string, connection: Connection) {
    this.connections.set(key(userId, connection.connectionId), structuredClone(connection));
  }

  async replaceConnectionIfUnchanged(userId: string, connection: Connection, expectedUpdatedAt: string) {
    const current = this.connections.get(key(userId, connection.connectionId));
    if (!current || current.updatedAt !== expectedUpdatedAt) return false;
    this.connections.set(key(userId, connection.connectionId), structuredClone(connection));
    return true;
  }

  async deleteConnection(userId: string, connectionId: string) {
    this.connections.delete(key(userId, connectionId));
  }

  async putPendingAuth(userId: string, auth: PendingAuth) { this.pendingAuths.set(key(userId, auth.state), { ...auth }); }

  async getPendingAuth(userId: string, state: string, nowMs: number) {
    const found = this.pendingAuths.get(key(userId, state));
    return found && found.expiresAt > Math.floor(nowMs / 1000) ? { ...found } : null;
  }

  async deletePendingAuth(userId: string, state: string) { this.pendingAuths.delete(key(userId, state)); }

  async filterUnseen(userId: string, txnKeys: string[]) {
    return new Set(txnKeys.filter(txnKey => !this.seen.has(key(userId, txnKey))));
  }

  async importItem(userId: string, item: InboxItem) {
    const k = key(userId, item.txnKey);
    if (this.seen.has(k)) return 'ALREADY_SEEN' as const;
    this.seen.set(k, 'PENDING');
    this.inbox.set(k, structuredClone(item));
    return 'IMPORTED' as const;
  }

  async deletePendingItemsForConnection(userId: string, connectionId: string) {
    let deleted = 0;
    for (const [k, item] of this.inbox) {
      if (!k.startsWith(`${userId}|`) || item.connectionId !== connectionId) continue;
      this.inbox.delete(k);
      this.seen.delete(k);
      deleted += 1;
    }
    return deleted;
  }

  inboxFor(userId: string): InboxItem[] {
    return [...this.inbox.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, item]) => item);
  }

  connectionFor(userId: string, connectionId: string): Connection | undefined {
    return this.connections.get(key(userId, connectionId));
  }
}

export type ScriptedResponse = ProviderTransaction[] | Error;

export class FakeProvider implements BankProvider {
  readonly id = 'enable-banking' as const;
  readonly calls: { accountUid: string; window: SyncWindow; psu?: PsuContext }[] = [];
  private readonly scripts = new Map<string, ScriptedResponse[]>();

  script(accountUid: string, ...responses: ScriptedResponse[]): this {
    this.scripts.set(accountUid, responses);
    return this;
  }

  async fetchTransactions(_connection: Connection, account: ConnectedAccount, window: SyncWindow, ctx: FetchContext) {
    this.calls.push({ accountUid: account.accountUid, window, psu: ctx.psu });
    const next = this.scripts.get(account.accountUid)?.shift() ?? [];
    if (next instanceof Error) throw next;
    return next.map(t => ({ ...t }));
  }
}

export function makeTxn(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  const t = {
    entryReference: 'ref-1', amountPence: 1234, direction: 'OUT' as const,
    bookingDate: '2026-09-10', description: 'TESCO STORES', currency: 'GBP', ...overrides,
  };
  return { ...t, fallbackBasis: overrides.fallbackBasis ?? [t.bookingDate, t.amountPence, t.direction, t.description].join('|') };
}

export function makeAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  const accountUid = overrides.accountUid ?? 'acc-1';
  return {
    accountUid, dedupeId: accountUid, displayName: 'Current Account', last4: '1234',
    currency: 'GBP', startDate: '2026-09-01', ...overrides,
  };
}

export function makeConnection(overrides: Partial<EnableBankingConnection> = {}): EnableBankingConnection {
  return {
    connectionId: '11111111-1111-4111-8111-111111111111',
    provider: 'enable-banking',
    displayName: 'Lloyds Bank',
    status: 'ACTIVE',
    consecutiveFailures: 0,
    accounts: [makeAccount()],
    auth: { sessionId: 'session-1', consentValidUntil: '2027-03-01T00:00:00.000Z' },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}
