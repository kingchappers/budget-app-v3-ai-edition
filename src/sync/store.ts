import type { Connection, InboxItem, PendingAuth, SyncResult, SyncStatus } from './types';

export interface SyncStore {
  listSyncUserIds(): Promise<string[]>;
  registerSyncUser(userId: string, nowIso: string): Promise<void>;
  unregisterSyncUser(userId: string): Promise<void>;

  acquireLock(userId: string, nowIso: string, staleBeforeIso: string): Promise<boolean>;
  releaseLock(userId: string, nowIso: string, result: SyncResult): Promise<void>;
  getSyncStatus(userId: string): Promise<SyncStatus | null>;

  listConnections(userId: string): Promise<Connection[]>;
  getConnection(userId: string, connectionId: string): Promise<Connection | null>;
  putConnection(userId: string, connection: Connection): Promise<void>;
  replaceConnectionIfUnchanged(userId: string, connection: Connection, expectedUpdatedAt: string): Promise<boolean>;
  deleteConnection(userId: string, connectionId: string): Promise<void>;

  putPendingAuth(userId: string, auth: PendingAuth): Promise<void>;
  getPendingAuth(userId: string, state: string, nowMs: number): Promise<PendingAuth | null>;
  deletePendingAuth(userId: string, state: string): Promise<void>;

  filterUnseen(userId: string, txnKeys: string[]): Promise<Set<string>>;
  importItem(userId: string, item: InboxItem): Promise<'IMPORTED' | 'ALREADY_SEEN'>;
  deletePendingItemsForConnection(userId: string, connectionId: string): Promise<number>;
}
