export type TransactionType = 'EXPENSE' | 'INCOME' | 'INVESTMENT_IN' | 'INVESTMENT_OUT';
export type CategoryType = 'EXPENSE' | 'INCOME' | 'INVESTMENT';
export type TargetPeriod = 'MONTHLY' | 'WEEKLY';

export interface Category {
  categoryId: string;
  name: string;
  type: CategoryType;
  icon: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Transaction {
  transactionId: string;
  yearMonth: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
  createdAt: string;
}

export interface CategoryTarget {
  categoryId: string;
  targetAmount: number;
  period: TargetPeriod;
  updatedAt: string;
}

export type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'ERROR';

export interface ConnectedAccount {
  accountUid: string;
  dedupeId: string;
  displayName: string;
  last4: string;
  currency: string;
  startDate: string;
  lastSyncedAt?: string;
}

export interface BankConnection {
  connectionId: string;
  provider: 'truelayer';
  displayName: string;
  status: ConnectionStatus;
  consecutiveFailures: number;
  lastError?: { type: string; at: string };
  accounts: ConnectedAccount[];
  createdAt: string;
  updatedAt: string;
  needsAttention: boolean;
}

export interface InboxItem {
  txnKey: string;
  amount: number;
  direction: 'IN' | 'OUT';
  suggestedType: 'INCOME' | 'EXPENSE';
  description: string;
  bookingDate: string;
  connectionId: string;
  accountUid: string;
  importedAt: string;
  suggestion?: { type: TransactionType; categoryId: string; ruleId: string };
}

export interface InboxPage {
  items: InboxItem[];
  cursor?: string;
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

export interface PendingSync {
  baselineFinishedAt: string | null;
  requestedAt: number;
}
