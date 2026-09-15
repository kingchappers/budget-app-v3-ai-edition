import type { TransactionType } from '../api/types';
import type { ProviderErrorType } from './errors';

export type ProviderId = 'enable-banking';
export type Direction = 'IN' | 'OUT';
export type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'ERROR';
export type SeenOutcome = 'PENDING' | 'CONFIRMED' | 'IGNORED';

export interface PsuContext {
  ipAddress: string;
  userAgent: string;
}

export interface ConnectedAccount {
  accountUid: string;
  dedupeId: string;
  displayName: string;
  last4: string;
  currency: string;
  startDate: string;
  lastSyncedAt?: string;
}

interface ConnectionBase {
  connectionId: string;
  displayName: string;
  status: ConnectionStatus;
  consecutiveFailures: number;
  lastError?: { type: ProviderErrorType; at: string };
  accounts: ConnectedAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface EnableBankingConnection extends ConnectionBase {
  provider: 'enable-banking';
  auth: { sessionId: string; consentValidUntil: string };
}

export type Connection = EnableBankingConnection;

export interface ProviderTransaction {
  entryReference: string | null;
  amountPence: number;
  direction: Direction;
  bookingDate: string;
  description: string;
  currency: string;
  fallbackBasis: string;
}

export interface SyncWindow {
  from: string;
  to: string;
}

export interface FetchContext {
  psu?: PsuContext;
  deadline: number;
}

export interface BankProvider {
  id: ProviderId;
  fetchTransactions(
    connection: Connection,
    account: ConnectedAccount,
    window: SyncWindow,
    ctx: FetchContext,
  ): Promise<ProviderTransaction[]>;
}

export interface InboxItem {
  txnKey: string;
  amount: number;
  direction: Direction;
  suggestedType: Extract<TransactionType, 'INCOME' | 'EXPENSE'>;
  description: string;
  bookingDate: string;
  connectionId: string;
  accountUid: string;
  importedAt: string;
  suggestion?: { type: TransactionType; categoryId: string; ruleId: string };
}

export interface PendingAuth {
  state: string;
  aspspName: string;
  aspspCountry: string;
  startDate: string;
  connectionId?: string;
  expiresAt: number;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  failedAccounts: number;
  partial: boolean;
}

export interface SyncStatus {
  state: 'IDLE' | 'RUNNING';
  startedAt?: string;
  finishedAt?: string;
  lastResult?: SyncResult;
}
