import { describe, it, expect } from 'vitest';
import { computeInsights, MAX_TOP_NOTES } from '../insightsCalc';
import type { Category, Transaction } from '../types';

function category(categoryId: string, type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name: categoryId, type, icon: 'tag', isDefault: false, createdAt: '' };
}

function txn(overrides: Partial<Transaction> & { yearMonth: string; categoryId: string }): Transaction {
  return {
    transactionId: `${overrides.yearMonth}-${overrides.categoryId}-${Math.random()}`,
    amount: 1000,
    type: 'EXPENSE',
    description: '',
    date: `${overrides.yearMonth}-15`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeInsights', () => {
  it('returns a zero-filled window with no gaps for a category with no activity', () => {
    const result = computeInsights({
      transactions: [], categories: [category('cat-a')], asOfMonth: '2026-09', months: 3,
    });
    expect(result.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(result.categories).toEqual([
      { categoryId: 'cat-a', months: [
        { yearMonth: '2026-07', spent: 0 }, { yearMonth: '2026-08', spent: 0 }, { yearMonth: '2026-09', spent: 0 },
      ], total: 0, average: 0 },
    ]);
  });

  it('spans a year boundary without gaps', () => {
    const result = computeInsights({
      transactions: [], categories: [], asOfMonth: '2027-01', months: 3,
    });
    expect(result.months).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('sums EXPENSE transactions per month per category and computes total/average', () => {
    const result = computeInsights({
      transactions: [
        txn({ yearMonth: '2026-08', categoryId: 'cat-a', amount: 2000 }),
        txn({ yearMonth: '2026-09', categoryId: 'cat-a', amount: 1000 }),
      ],
      categories: [category('cat-a')],
      asOfMonth: '2026-09',
      months: 2,
    });
    const cat = result.categories[0];
    expect(cat.months).toEqual([{ yearMonth: '2026-08', spent: 2000 }, { yearMonth: '2026-09', spent: 1000 }]);
    expect(cat.total).toBe(3000);
    expect(cat.average).toBe(1500);
  });

  it('excludes entries outside the window', () => {
    const result = computeInsights({
      transactions: [txn({ yearMonth: '2026-01', categoryId: 'cat-a', amount: 9999 })],
      categories: [category('cat-a')],
      asOfMonth: '2026-09',
      months: 3,
    });
    expect(result.categories[0].total).toBe(0);
  });

  it('ignores non-EXPENSE transactions and non-EXPENSE categories', () => {
    const result = computeInsights({
      transactions: [
        txn({ yearMonth: '2026-09', categoryId: 'cat-a', type: 'INCOME', amount: 50000 }),
        txn({ yearMonth: '2026-09', categoryId: 'pot-a', amount: 500 }),
      ],
      categories: [category('cat-a'), category('pot-a', 'POT')],
      asOfMonth: '2026-09',
      months: 1,
    });
    expect(result.categories).toEqual([{ categoryId: 'cat-a', months: [{ yearMonth: '2026-09', spent: 0 }], total: 0, average: 0 }]);
  });

  it('sorts categories by total descending', () => {
    const result = computeInsights({
      transactions: [
        txn({ yearMonth: '2026-09', categoryId: 'small', amount: 100 }),
        txn({ yearMonth: '2026-09', categoryId: 'big', amount: 5000 }),
      ],
      categories: [category('small'), category('big')],
      asOfMonth: '2026-09',
      months: 1,
    });
    expect(result.categories.map(c => c.categoryId)).toEqual(['big', 'small']);
  });

  describe('topNotes', () => {
    it('groups by the normalised note, ignoring case and spacing', () => {
      const result = computeInsights({
        transactions: [
          txn({ yearMonth: '2026-09', categoryId: 'cat-a', description: 'Tesco', amount: 1000, date: '2026-09-01', createdAt: 't1' }),
          txn({ yearMonth: '2026-09', categoryId: 'cat-a', description: '  tesco  ', amount: 500, date: '2026-09-10', createdAt: 't2' }),
        ],
        categories: [category('cat-a')],
        asOfMonth: '2026-09',
        months: 1,
      });
      expect(result.topNotes).toEqual([{ note: 'tesco', count: 2, total: 1500 }]);
    });

    it('keeps the most recent transaction\'s original casing for display', () => {
      const result = computeInsights({
        transactions: [
          txn({ yearMonth: '2026-09', categoryId: 'cat-a', description: 'tesco', amount: 1000, date: '2026-09-01', createdAt: 't1' }),
          txn({ yearMonth: '2026-09', categoryId: 'cat-a', description: 'TESCO', amount: 500, date: '2026-09-10', createdAt: 't2' }),
        ],
        categories: [category('cat-a')],
        asOfMonth: '2026-09',
        months: 1,
      });
      expect(result.topNotes[0].note).toBe('TESCO');
    });

    it('ignores blank notes', () => {
      const result = computeInsights({
        transactions: [txn({ yearMonth: '2026-09', categoryId: 'cat-a', description: '   ', amount: 1000 })],
        categories: [category('cat-a')],
        asOfMonth: '2026-09',
        months: 1,
      });
      expect(result.topNotes).toEqual([]);
    });

    it('sorts by total descending, then count descending, and caps at MAX_TOP_NOTES', () => {
      const transactions: Transaction[] = [];
      for (let i = 0; i < MAX_TOP_NOTES + 2; i++) {
        transactions.push(txn({ yearMonth: '2026-09', categoryId: 'cat-a', description: `note-${i}`, amount: 100 + i }));
      }
      const result = computeInsights({
        transactions, categories: [category('cat-a')], asOfMonth: '2026-09', months: 1,
      });
      expect(result.topNotes).toHaveLength(MAX_TOP_NOTES);
      expect(result.topNotes[0].total).toBe(100 + MAX_TOP_NOTES + 1);
    });

    it('excludes SET_ASIDE/TAKE_OUT/INCOME transactions from note aggregation', () => {
      const result = computeInsights({
        transactions: [txn({ yearMonth: '2026-09', categoryId: 'cat-a', type: 'SET_ASIDE', description: 'Holiday fund', amount: 1000 })],
        categories: [category('cat-a')],
        asOfMonth: '2026-09',
        months: 1,
      });
      expect(result.topNotes).toEqual([]);
    });
  });
});
