import type { CategoryType, TransactionType } from './types';

export const TYPE_OPTIONS: { label: string; value: TransactionType }[] = [
  { label: 'Spend', value: 'EXPENSE' },
  { label: 'Income', value: 'INCOME' },
  { label: 'Invest in', value: 'INVESTMENT_IN' },
  { label: 'Invest out', value: 'INVESTMENT_OUT' },
];

const CATEGORY_TYPE_BY_TRANSACTION_TYPE: Record<TransactionType, CategoryType> = {
  EXPENSE: 'EXPENSE',
  INCOME: 'INCOME',
  INVESTMENT_IN: 'INVESTMENT',
  INVESTMENT_OUT: 'INVESTMENT',
};

export function categoryTypeFor(type: TransactionType): CategoryType {
  return CATEGORY_TYPE_BY_TRANSACTION_TYPE[type];
}
