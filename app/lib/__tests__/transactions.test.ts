import { describe, it, expect } from 'vitest';
import { filterTransactions } from '../transactions';
import type { Category, Transaction } from '../types';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food & Groceries', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
];

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-07', amount: 1000, type: 'EXPENSE',
    categoryId: 'cat-food', description: '', date: '2026-07-10', createdAt: '', ...over,
  };
}

const noFilter = { query: '', categoryId: null, type: null };

describe('filterTransactions', () => {
  it('returns everything when the filter is empty', () => {
    const items = [txn({ transactionId: 't1' }), txn({ transactionId: 't2' })];
    expect(filterTransactions(items, categories, noFilter)).toHaveLength(2);
  });

  it('matches query against the description, case-insensitively', () => {
    const items = [
      txn({ transactionId: 't1', description: 'Weekly Shop' }),
      txn({ transactionId: 't2', description: 'Petrol' }),
    ];
    const result = filterTransactions(items, categories, { ...noFilter, query: 'shop' });
    expect(result.map(t => t.transactionId)).toEqual(['t1']);
  });

  it('matches query against the resolved category name when description does not match', () => {
    const items = [txn({ transactionId: 't1', description: '', categoryId: 'cat-food' })];
    const result = filterTransactions(items, categories, { ...noFilter, query: 'groceries' });
    expect(result.map(t => t.transactionId)).toEqual(['t1']);
  });

  it('filters by categoryId', () => {
    const items = [
      txn({ transactionId: 't1', categoryId: 'cat-food' }),
      txn({ transactionId: 't2', categoryId: 'cat-salary', type: 'INCOME' }),
    ];
    const result = filterTransactions(items, categories, { ...noFilter, categoryId: 'cat-salary' });
    expect(result.map(t => t.transactionId)).toEqual(['t2']);
  });

  it('filters by type', () => {
    const items = [
      txn({ transactionId: 't1', type: 'EXPENSE' }),
      txn({ transactionId: 't2', type: 'INCOME', categoryId: 'cat-salary' }),
    ];
    const result = filterTransactions(items, categories, { ...noFilter, type: 'INCOME' });
    expect(result.map(t => t.transactionId)).toEqual(['t2']);
  });

  it('combines query and categoryId with AND semantics', () => {
    const items = [
      txn({ transactionId: 't1', categoryId: 'cat-food', description: 'Weekly Shop' }),
      txn({ transactionId: 't2', categoryId: 'cat-salary', type: 'INCOME', description: 'Weekly Shop' }),
    ];
    const result = filterTransactions(items, categories, { query: 'shop', categoryId: 'cat-food', type: null });
    expect(result.map(t => t.transactionId)).toEqual(['t1']);
  });

  it('returns an empty array when nothing matches', () => {
    const items = [txn({ transactionId: 't1', description: 'Weekly Shop' })];
    const result = filterTransactions(items, categories, { ...noFilter, query: 'nonexistent' });
    expect(result).toEqual([]);
  });
});
