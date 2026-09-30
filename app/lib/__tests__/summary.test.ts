import { describe, it, expect } from 'vitest';
import { buildMonthSummary, leftToSpendSentence, normaliseTargetToMonth } from '../summary';
import type { Category, Transaction, CategoryTarget } from '../types';

const categories: Category[] = [
  { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'shopping-cart', isDefault: true, createdAt: '' },
  { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'tools-kitchen-2', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
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
  });

  it('ignores targets on pot categories', () => {
    const res = buildMonthSummary({
      transactions: [],
      categories: [{ categoryId: 'pot-1', name: 'Holidays', type: 'POT', icon: 'tag', isDefault: true, createdAt: '', group: 'SINKING_FUNDS' }],
      targets: [{ categoryId: 'pot-1', targetAmount: 5000, period: 'MONTHLY', updatedAt: '' }],
      yearMonth: '2026-09',
    });
    expect(res.spending).toEqual([]);
    expect('saving' in res).toBe(false);
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

describe('buildMonthSummary groups', () => {
  it('carries the category group onto its progress row', () => {
    const summary = buildMonthSummary({
      transactions: [],
      categories: [{ categoryId: 'c1', name: 'Mortgage', type: 'EXPENSE', icon: 'tag', isDefault: true, createdAt: '', group: 'BILLS' }],
      targets: [{ categoryId: 'c1', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' }],
      yearMonth: '2026-09',
    });
    expect(summary.spending[0].group).toBe('BILLS');
  });
});

describe('buildMonthSummary totals', () => {
  const base = { categories, yearMonth: '2026-07' };

  it('totals monthly and weekly expense targets as a monthly figure', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [],
      targets: [
        { categoryId: 'cat-food', targetAmount: 40000, period: 'MONTHLY', updatedAt: '' },
        { categoryId: 'cat-dining', targetAmount: 5000, period: 'WEEKLY', updatedAt: '' },
      ],
    });
    expect(res.budgetedTotal).toBe(40000 + 22143);
  });

  it('ignores income and pot targets in the budgeted total', () => {
    const res = buildMonthSummary({
      transactions: [],
      categories: [
        ...categories,
        { categoryId: 'pot-1', name: 'Holidays', type: 'POT', icon: 'tag', isDefault: true, createdAt: '', group: 'SINKING_FUNDS' },
      ],
      targets: [
        { categoryId: 'cat-salary', targetAmount: 100000, period: 'MONTHLY', updatedAt: '' },
        { categoryId: 'pot-1', targetAmount: 5000, period: 'MONTHLY', updatedAt: '' },
      ],
      yearMonth: '2026-07',
    });
    expect(res.budgetedTotal).toBe(0);
  });

  it('splits spending into targeted and untargeted and works out what is left', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [
        txn({ amount: 18240, categoryId: 'cat-food' }),
        txn({ amount: 5000, categoryId: 'cat-dining' }),
        txn({ amount: 240000, type: 'INCOME', categoryId: 'cat-salary' }),
        txn({ amount: 3000, type: 'SET_ASIDE', categoryId: 'pot-1' }),
      ],
      targets: [{ categoryId: 'cat-food', targetAmount: 25000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.spentTotal).toBe(23240);
    expect(res.spentInBudgeted).toBe(18240);
    expect(res.spentUnbudgeted).toBe(5000);
    expect(res.leftToSpend).toBe(6760);
  });

  it('lets what is left go negative when spending passes the targets', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 29000, categoryId: 'cat-food' })],
      targets: [{ categoryId: 'cat-food', targetAmount: 25000, period: 'MONTHLY', updatedAt: '' }],
    });
    expect(res.leftToSpend).toBe(-4000);
  });

  it('counts all spending as untargeted in a month with no targets', () => {
    const res = buildMonthSummary({
      ...base,
      transactions: [txn({ amount: 1200, categoryId: 'cat-food' }), txn({ amount: 800, categoryId: 'cat-dining' })],
      targets: [],
    });
    expect(res.budgetedTotal).toBe(0);
    expect(res.spentInBudgeted).toBe(0);
    expect(res.spentTotal).toBe(2000);
    expect(res.spentUnbudgeted).toBe(2000);
    expect(res.leftToSpend).toBe(0);
  });
});

describe('leftToSpendSentence', () => {
  const now = new Date(2026, 8, 12);
  const progress = buildMonthSummary({
    categories,
    yearMonth: '2026-09',
    transactions: [],
    targets: [{ categoryId: 'cat-food', targetAmount: 50000, period: 'MONTHLY', updatedAt: '' }],
  }).spending;
  const withTargets = { spending: progress, leftToSpend: 41200 };
  const over = { spending: progress, leftToSpend: -4000 };

  it('says what is left and how many days remain in the current month', () => {
    expect(leftToSpendSentence(withTargets, '2026-09', now)).toBe('£412.00 left to spend this month · 19 days to go');
  });

  it('says "1 day to go" on the last day', () => {
    expect(leftToSpendSentence(withTargets, '2026-09', new Date(2026, 8, 30))).toBe('£412.00 left to spend this month · 1 day to go');
  });

  it('describes going over calmly, without a days count', () => {
    expect(leftToSpendSentence(over, '2026-09', now))
      .toBe('£40.00 over so far. Nothing needs doing today.');
  });

  it('describes a past month by name', () => {
    expect(leftToSpendSentence(withTargets, '2026-08', now)).toBe('£412.00 left at the end of August');
    expect(leftToSpendSentence(over, '2026-08', now)).toBe('£40.00 over in August');
  });

  it('includes the year for a month in another year', () => {
    expect(leftToSpendSentence(withTargets, '2025-08', now)).toBe('£412.00 left at the end of August 2025');
  });

  it('describes a future month without a days count', () => {
    expect(leftToSpendSentence(withTargets, '2026-10', now)).toBe('£412.00 left to spend in October');
  });

  it('never gives a per-day figure', () => {
    expect(leftToSpendSentence(withTargets, '2026-09', now)).not.toMatch(/per day|a day|\/day/);
  });

  it('returns null when there are no targets', () => {
    expect(leftToSpendSentence({ spending: [], leftToSpend: 0 }, '2026-09', now)).toBeNull();
  });
});
