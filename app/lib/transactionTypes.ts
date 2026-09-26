import { formatPence } from './money';
import type { CategoryType, TransactionType } from './types';

export const TYPE_OPTIONS: { label: string; value: TransactionType }[] = [
  { label: 'Spend', value: 'EXPENSE' },
  { label: 'Income', value: 'INCOME' },
  { label: 'Set aside', value: 'SET_ASIDE' },
  { label: 'Take out', value: 'TAKE_OUT' },
];

const CATEGORY_TYPES_BY_TRANSACTION_TYPE: Record<TransactionType, CategoryType[]> = {
  EXPENSE: ['EXPENSE', 'POT'],
  INCOME: ['INCOME'],
  SET_ASIDE: ['POT'],
  TAKE_OUT: ['POT'],
};

export function categoryTypesFor(type: TransactionType): CategoryType[] {
  return CATEGORY_TYPES_BY_TRANSACTION_TYPE[type];
}

const OUTGOING_TYPES: ReadonlySet<TransactionType> = new Set<TransactionType>(['EXPENSE', 'SET_ASIDE']);

export function formatSignedPence(type: TransactionType, pence: number): string {
  return `${OUTGOING_TYPES.has(type) ? '−' : '+'}${formatPence(pence)}`;
}
