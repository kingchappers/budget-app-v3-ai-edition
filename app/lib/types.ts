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

export interface Recurring {
  recurringId: string;
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  leadDays: number;
  handledPeriod: string | null;
  createdAt: string;
  updatedAt: string;
}
