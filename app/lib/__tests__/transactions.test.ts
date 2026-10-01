import { describe, it, expect } from 'vitest';
import { filterTransactions, parseTransactionsParams, topCategories, UNTARGETED_FILTER } from '../transactions';
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

function cat(categoryId: string, type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name: categoryId, type, icon: 'x', isDefault: true, createdAt: '' };
}

describe('topCategories', () => {
  const list = [cat('a'), cat('b'), cat('c'), cat('salary', 'INCOME'), cat('holidays', 'POT')];

  it('ranks categories by transaction count, most used first', () => {
    const items = [txn({ categoryId: 'c' }), txn({ categoryId: 'c' }), txn({ categoryId: 'b' })];
    const result = topCategories(items, list, 'EXPENSE', 5);
    expect(result.map(c => c.categoryId)).toEqual(['c', 'b', 'a', 'holidays']);
  });

  it('keeps default category order when counts are equal, including with no history', () => {
    const result = topCategories([], list, 'EXPENSE', 5);
    expect(result.map(c => c.categoryId)).toEqual(['a', 'b', 'c', 'holidays']);
  });

  it('only returns categories of the matching category type', () => {
    expect(topCategories([], list, 'INCOME', 5).map(c => c.categoryId)).toEqual(['salary']);
  });

  it('maps set aside and take out to pot categories and spending to spending plus pots', () => {
    expect(topCategories([], list, 'SET_ASIDE', 5).map(c => c.categoryId)).toEqual(['holidays']);
    expect(topCategories([], list, 'TAKE_OUT', 5).map(c => c.categoryId)).toEqual(['holidays']);
    expect(topCategories([], list, 'EXPENSE', 5).map(c => c.categoryId)).toEqual(['a', 'b', 'c', 'holidays']);
  });

  it('respects the limit', () => {
    const items = [txn({ categoryId: 'c' }), txn({ categoryId: 'b' })];
    const result = topCategories(items, list, 'EXPENSE', 2);
    expect(result.map(c => c.categoryId)).toEqual(['b', 'c']);
  });
});

describe('topCategories with pinned categories', () => {
  const list = [cat('a'), cat('b'), cat('c'), cat('d'), cat('salary', 'INCOME'), cat('holidays', 'POT')];
  const busyC = [txn({ categoryId: 'c' }), txn({ categoryId: 'c' }), txn({ categoryId: 'c' })];

  it('puts pinned categories first, in the order they were pinned, whatever the usage', () => {
    const result = topCategories(busyC, list, 'EXPENSE', 5, ['d', 'a']);
    expect(result.map(c => c.categoryId)).toEqual(['d', 'a', 'c', 'b', 'holidays']);
  });

  it('fills the remaining places by usage and never lists a category twice', () => {
    const result = topCategories(busyC, list, 'EXPENSE', 5, ['c', 'c', 'a']);
    expect(result.map(c => c.categoryId)).toEqual(['c', 'a', 'b', 'd', 'holidays']);
  });

  it('skips pins that no longer exist or do not fit the transaction type', () => {
    const result = topCategories([], list, 'EXPENSE', 5, ['gone', 'salary', 'b']);
    expect(result.map(c => c.categoryId)).toEqual(['b', 'a', 'c', 'd', 'holidays']);
    expect(topCategories([], list, 'INCOME', 5, ['b', 'salary']).map(c => c.categoryId)).toEqual(['salary']);
  });

  it('keeps pins within the limit', () => {
    const result = topCategories([], list, 'EXPENSE', 2, ['d', 'c', 'b']);
    expect(result.map(c => c.categoryId)).toEqual(['d', 'c']);
  });

  it('gives the same order for the same history however the months fall', () => {
    const early = [txn({ categoryId: 'b', date: '2026-01-31' }), txn({ categoryId: 'b', date: '2026-02-01' }), txn({ categoryId: 'a', date: '2026-02-01' })];
    const late = [...early].reverse();
    expect(topCategories(early, list, 'EXPENSE', 5).map(c => c.categoryId))
      .toEqual(topCategories(late, list, 'EXPENSE', 5).map(c => c.categoryId));
  });
});

describe('filterTransactions untargeted spending', () => {
  const withDining: Category[] = [
    ...categories,
    { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'tag', isDefault: true, createdAt: '' },
  ];

  it('keeps only expenses in categories without a target', () => {
    const items = [
      txn({ transactionId: 'food', categoryId: 'cat-food' }),
      txn({ transactionId: 'dining', categoryId: 'cat-dining' }),
      txn({ transactionId: 'pay', categoryId: 'cat-salary', type: 'INCOME' }),
    ];
    const result = filterTransactions(items, withDining, { ...noFilter, categoryId: UNTARGETED_FILTER }, new Set(['cat-food']));
    expect(result.map(t => t.transactionId)).toEqual(['dining']);
  });
});

describe('parseTransactionsParams', () => {
  it('reads a month and a category', () => {
    expect(parseTransactionsParams(new URLSearchParams('month=2026-08&category=cat-food')))
      .toEqual({ yearMonth: '2026-08', categoryId: 'cat-food' });
  });

  it('reads untargeted spending', () => {
    expect(parseTransactionsParams(new URLSearchParams('month=2026-08&spending=untargeted')))
      .toEqual({ yearMonth: '2026-08', categoryId: UNTARGETED_FILTER });
  });

  it('ignores values that are not valid', () => {
    expect(parseTransactionsParams(new URLSearchParams('month=2026-13&category=%3Cscript%3E&spending=other')))
      .toEqual({ yearMonth: null, categoryId: null });
    expect(parseTransactionsParams(new URLSearchParams(`category=${'a'.repeat(65)}`)))
      .toEqual({ yearMonth: null, categoryId: null });
  });

  it('returns nothing for an empty query string', () => {
    expect(parseTransactionsParams(new URLSearchParams(''))).toEqual({ yearMonth: null, categoryId: null });
  });
});
