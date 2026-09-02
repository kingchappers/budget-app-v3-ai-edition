import { describe, it, expect } from 'vitest';
import { buildMonthSummary, normaliseTargetToMonth } from '../summary';
import type { Category, Transaction, CategoryTarget } from '../types';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '' },
  { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'tools-kitchen-2', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
  { categoryId: 'cat-stocks', name: 'Stocks', type: 'INVESTMENT', icon: 'chart-line', isDefault: true, createdAt: '' },
];

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't', yearMonth: '2026-07', amount: 100, type: 'EXPENSE',
    categoryId: 'cat-food', description: '', date: '2026-07-10', createdAt: '', ...over,
  };
}

describe('normaliseTargetToMonth', () => {
  it('leaves a monthly target unchanged', () => {
    expect(normaliseTargetToMonth(40000, 'MONTHLY', '2026-07')).toBe(40000);
  });

  it('scales a weekly target by days in a 31-day month', () => {
    // 5000p * 31/7 = 22142.85 -> 22143
    expect(normaliseTargetToMonth(5000, 'WEEKLY', '2026-07')).toBe(22143);
  });

  it('scales a weekly target by days in February', () => {
    // 5000p * 28/7 = 20000
    expect(normaliseTargetToMonth(5000, 'WEEKLY', '2026-02')).toBe(20000);
  });

  it('accounts for a leap February', () => {
    // 5000p * 29/7 = 20714.28 -> 20714
    expect(normaliseTargetToMonth(5000, 'WEEKLY', '2028-02')).toBe(20714);
  });
});

describe('buildMonthSummary', () => {
  const base = { categories, yearMonth: '2026-07' };

  it('sums expense spending per category', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 1000, categoryId: 'cat-food' }),
        txn({ amount: 2000, categoryId: 'cat-food' }),
      ],
      targets: [{ categoryId: 'cat-food', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending).toHaveLength(1);
    expect(res.spending[0].spent).toBe(3000);
    expect(res.spending[0].percent).toBe(8);
    expect(res.spending[0].isOver).toBe(false);
  });

  it('flags a category over its target', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 22400, categoryId: 'cat-dining' })],
      targets: [{ categoryId: 'cat-dining', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending[0].isOver).toBe(true);
    expect(res.spending[0].percent).toBe(112);
  });

  it('sorts over-target categories first', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 1000, categoryId: 'cat-food' }),
        txn({ amount: 22400, categoryId: 'cat-dining' }),
      ],
      targets: [
        { categoryId: 'cat-food', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' },
        { categoryId: 'cat-dining', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' },
      ],
    });
    expect(res.spending[0].categoryId).toBe('cat-dining');
  });

  it('nets investment IN against OUT for saving progress', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 30000, type: 'INVESTMENT_IN', categoryId: 'cat-stocks' }),
        txn({ amount: 10000, type: 'INVESTMENT_IN', categoryId: 'cat-stocks' }),
        txn({ amount: 5000, type: 'INVESTMENT_OUT', categoryId: 'cat-stocks' }),
      ],
      targets: [{ categoryId: 'cat-stocks', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.saving).toHaveLength(1);
    expect(res.saving[0].spent).toBe(35000);
  });

  it('never reports negative saving progress', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 5000, type: 'INVESTMENT_OUT', categoryId: 'cat-stocks' })],
      targets: [{ categoryId: 'cat-stocks', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.saving[0].spent).toBe(0);
  });

  it('totals income without requiring a target', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 240000, type: 'INCOME', categoryId: 'cat-salary' })],
      targets: [],
    });
    expect(res.incomeTotal).toBe(240000);
  });

  it('excludes categories with no target from progress lists', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 1000, categoryId: 'cat-food' })],
      targets: [],
    });
    expect(res.spending).toHaveLength(0);
  });

  it('ignores targets whose category no longer exists', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [],
      targets: [{ categoryId: 'cat-deleted', targetAmount: 1000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending).toHaveLength(0);
    expect(res.saving).toHaveLength(0);
  });

  it('returns recent transactions newest first, limited', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ transactionId: 'a', date: '2026-07-01' }),
        txn({ transactionId: 'b', date: '2026-07-20' }),
        txn({ transactionId: 'c', date: '2026-07-10' }),
      ],
      targets: [],
      recentLimit: 2,
    });
    expect(res.recent.map(t => t.transactionId)).toEqual(['b', 'c']);
  });

  it('reports zero percent when the normalised target is zero', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 1000, categoryId: 'cat-food' })],
      targets: [{ categoryId: 'cat-food', targetAmount: 0, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spending[0].percent).toBe(0);
    expect(res.spending[0].isOver).toBe(false);
  });
});
