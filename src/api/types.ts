export type TransactionType = 'EXPENSE' | 'INCOME' | 'SET_ASIDE' | 'TAKE_OUT';

export type CategoryType = 'EXPENSE' | 'INCOME' | 'POT';
export type CategoryGroup = 'BILLS' | 'SINKING_FUNDS' | 'EVERYDAY' | 'SAVING_INVESTMENT';

export type TargetPeriod = 'MONTHLY' | 'WEEKLY';

export interface Category {
  categoryId: string;
  name: string;
  type: CategoryType;
  icon: string;
  group?: CategoryGroup;
  isDefault: boolean;
  createdAt: string;
  archived?: boolean;
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
  recurringId?: string;
}

export interface CategoryTarget {
  categoryId: string;
  targetAmount: number;
  period: TargetPeriod;
  updatedAt: string;
}

export type RecurringFrequency = 'WEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface Recurring {
  recurringId: string;
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  frequency: RecurringFrequency;
  // The date a non-monthly schedule is counted from. Null for monthly items.
  anchorDate: string | null;
  leadDays: number;
  // The occurrence key handled up to: YYYY-MM for monthly items, YYYY-MM-DD for the rest.
  handledPeriod: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  cookies?: string[];
}

export interface PotAutoEntry { from: string; amount: number }
export interface PotSettings {
  categoryId: string;
  monthlyAmount: number | null;
  goalAmount: number | null;
  autoContribute: PotAutoEntry[];
  archivedAt?: string | null;
  updatedAt: string;
}
export interface PotMonth {
  yearMonth: string; opening: number; setAside: number; autoAdded: number;
  takeOut: number; spent: number; closing: number;
}
export interface PotSummary {
  categoryId: string;
  monthlyAmount: number | null;
  goalAmount: number | null;
  autoAmountNow: number;
  archivedAt: string | null;
  balance: number;
  thisMonth: { setAside: number; autoAdded: number; takeOut: number; spent: number };
  months: PotMonth[];
}

export type AccountKind = 'ASSET' | 'LIABILITY';
export type AccountType = 'CASH' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT_CARD' | 'LOAN';

export interface BalanceEntry {
  date: string;
  pence: number;
}

export interface Account {
  accountId: string;
  name: string;
  kind: AccountKind;
  type: AccountType;
  balances: BalanceEntry[];
  createdAt: string;
}

// One device that has asked for bill reminders, and when it wants them.
export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  // Hours are 0 to 23 in the device's own time zone.
  hour: number;
  quietStart: number | null;
  quietEnd: number | null;
  timeZone: string;
}

