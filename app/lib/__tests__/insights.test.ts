import { describe, it, expect } from 'vitest';
import {
  fetchRangeForAnchor, canGoNewer, monthsInPeriod, splitPeriods, summaryTotals,
  groupBreakdown, categoriesInGroup, monthlyTrend, biggestMovers, targetAdherence,
} from '../insights';
import type { Category, CategoryTarget, Transaction } from '../types';

function txn(yearMonth: string, type: Transaction['type'], amount: number, categoryId: string): Transaction {
  return { transactionId: `${yearMonth}-${type}-${categoryId}-${amount}`, yearMonth, amount, type, categoryId, description: '', date: `${yearMonth}-10`, createdAt: '' };
}

function cat(categoryId: string, name: string, group: Category['group'], type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name, type, icon: 'tag', group, isDefault: true, createdAt: '' };
}

describe('fetchRangeForAnchor', () => {
  it('covers the current period and an equal-length comparison period ending the month before it', () => {
    expect(fetchRangeForAnchor('2026-09', 3)).toEqual({ from: '2026-04', to: '2026-09' });
  });

  it('crosses a year boundary', () => {
    expect(fetchRangeForAnchor('2026-01', 6)).toEqual({ from: '2025-02', to: '2026-01' });
  });

  it('handles a one-month span', () => {
    expect(fetchRangeForAnchor('2026-09', 1)).toEqual({ from: '2026-08', to: '2026-09' });
  });
});

describe('canGoNewer', () => {
  it('is false at the current month and true one month behind it', () => {
    const now = new Date('2026-09-15T00:00:00');
    expect(canGoNewer('2026-09', now)).toBe(false);
    expect(canGoNewer('2026-08', now)).toBe(true);
  });
});

describe('monthsInPeriod', () => {
  it('lists every month inclusive, in order', () => {
    expect(monthsInPeriod(['2026-11', '2027-02'])).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('splitPeriods', () => {
  it('splits an even range in half, current is the later half', () => {
    expect(splitPeriods('2026-01', '2026-06')).toEqual({ previous: ['2026-01', '2026-03'], current: ['2026-04', '2026-06'] });
  });

  it('splits a one-plus-one range into two single months', () => {
    expect(splitPeriods('2026-08', '2026-09')).toEqual({ previous: ['2026-08', '2026-08'], current: ['2026-09', '2026-09'] });
  });
});

describe('summaryTotals', () => {
  it('sums income, spend, and nets set-aside against take-out for saved', () => {
    const transactions = [
      txn('2026-09', 'INCOME', 200000, 'cat-salary'),
      txn('2026-09', 'EXPENSE', 30000, 'cat-groceries'),
      txn('2026-09', 'SET_ASIDE', 5000, 'cat-holidays'),
      txn('2026-09', 'TAKE_OUT', 2000, 'cat-holidays'),
      txn('2026-08', 'EXPENSE', 99999, 'cat-groceries'),
    ];
    const totals = summaryTotals(transactions, ['2026-09', '2026-09']);
    expect(totals).toEqual({ income: 200000, spent: 30000, saved: 3000, net: 170000 });
  });
});

describe('groupBreakdown', () => {
  const categories = [cat('cat-mortgage', 'Mortgage', 'BILLS'), cat('cat-groceries', 'Groceries', 'EVERYDAY')];

  it('sums spend per group for both periods, omitting groups with none', () => {
    const transactions = [
      txn('2026-09', 'EXPENSE', 100000, 'cat-mortgage'),
      txn('2026-08', 'EXPENSE', 90000, 'cat-mortgage'),
      txn('2026-09', 'EXPENSE', 5000, 'cat-groceries'),
    ];
    const rows = groupBreakdown(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08']);
    expect(rows).toEqual([
      { group: 'BILLS', label: 'Bills', current: 100000, previous: 90000 },
      { group: 'EVERYDAY', label: 'Everyday Spending', current: 5000, previous: 0 },
    ]);
  });

  it('ignores non-EXPENSE transactions', () => {
    const transactions = [txn('2026-09', 'SET_ASIDE', 5000, 'cat-mortgage')];
    expect(groupBreakdown(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08'])).toEqual([]);
  });

  it('puts spend on a removed or unrecognised category under Other, so the total still matches Spent', () => {
    const transactions = [txn('2026-09', 'EXPENSE', 1000, 'cat-missing')];
    expect(groupBreakdown(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08'])).toEqual([
      { group: 'OTHER', label: 'Other', current: 1000, previous: 0 },
    ]);
  });

  it('puts spend on an ungrouped custom category under Other too', () => {
    const ungrouped = [...categories, cat('cat-custom', 'Custom', undefined)];
    const transactions = [txn('2026-09', 'EXPENSE', 2000, 'cat-custom')];
    expect(groupBreakdown(transactions, ungrouped, ['2026-09', '2026-09'], ['2026-08', '2026-08'])).toEqual([
      { group: 'OTHER', label: 'Other', current: 2000, previous: 0 },
    ]);
  });
});

describe('categoriesInGroup', () => {
  it('lists spend per category in one group for one period, sorted highest first', () => {
    const categories = [cat('cat-a', 'A', 'EVERYDAY'), cat('cat-b', 'B', 'EVERYDAY'), cat('cat-c', 'C', 'BILLS')];
    const transactions = [
      txn('2026-09', 'EXPENSE', 500, 'cat-a'),
      txn('2026-09', 'EXPENSE', 1500, 'cat-b'),
      txn('2026-09', 'EXPENSE', 900, 'cat-c'),
    ];
    expect(categoriesInGroup(transactions, categories, 'EVERYDAY', ['2026-09', '2026-09'])).toEqual([
      { categoryId: 'cat-b', name: 'B', spentPence: 1500 },
      { categoryId: 'cat-a', name: 'A', spentPence: 500 },
    ]);
  });

  it('includes spend on a removed category as "Unknown category" when drilling into Other', () => {
    const categories = [cat('cat-custom', 'Custom', undefined)];
    const transactions = [
      txn('2026-09', 'EXPENSE', 300, 'cat-custom'),
      txn('2026-09', 'EXPENSE', 700, 'cat-missing'),
    ];
    expect(categoriesInGroup(transactions, categories, 'OTHER', ['2026-09', '2026-09'])).toEqual([
      { categoryId: 'unknown', name: 'Unknown category', spentPence: 700 },
      { categoryId: 'cat-custom', name: 'Custom', spentPence: 300 },
    ]);
  });
});

describe('monthlyTrend', () => {
  it('gives one row per month, even a month with no activity', () => {
    const transactions = [txn('2026-07', 'INCOME', 1000, 'cat-salary'), txn('2026-09', 'EXPENSE', 400, 'cat-groceries')];
    expect(monthlyTrend(transactions, ['2026-07', '2026-08', '2026-09'])).toEqual([
      { yearMonth: '2026-07', income: 1000, spent: 0, saved: 0 },
      { yearMonth: '2026-08', income: 0, spent: 0, saved: 0 },
      { yearMonth: '2026-09', income: 0, spent: 400, saved: 0 },
    ]);
  });
});

describe('biggestMovers', () => {
  const categories = [cat('cat-a', 'A', 'EVERYDAY'), cat('cat-b', 'B', 'EVERYDAY'), cat('cat-c', 'C', 'EVERYDAY')];

  it('splits into up and down, sorted by size of change, excluding categories unchanged from zero', () => {
    const transactions = [
      txn('2026-09', 'EXPENSE', 10000, 'cat-a'), txn('2026-08', 'EXPENSE', 2000, 'cat-a'),
      txn('2026-09', 'EXPENSE', 1000, 'cat-b'), txn('2026-08', 'EXPENSE', 9000, 'cat-b'),
      txn('2026-08', 'EXPENSE', 0, 'cat-c'),
    ];
    const result = biggestMovers(transactions, categories, ['2026-09', '2026-09'], ['2026-08', '2026-08']);
    expect(result.up).toEqual([{ categoryId: 'cat-a', name: 'A', currentPence: 10000, previousPence: 2000, deltaPence: 8000 }]);
    expect(result.down).toEqual([{ categoryId: 'cat-b', name: 'B', currentPence: 1000, previousPence: 9000, deltaPence: -8000 }]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => cat(`cat-${i}`, `Cat ${i}`, 'EVERYDAY'));
    const transactions = many.map((c, i) => txn('2026-09', 'EXPENSE', (i + 1) * 1000, c.categoryId));
    const result = biggestMovers(transactions, many, ['2026-09', '2026-09'], ['2026-08', '2026-08'], 2);
    expect(result.up).toHaveLength(2);
  });
});

describe('targetAdherence', () => {
  it('counts months over target, including months with no spend, only for EXPENSE categories', () => {
    const categories = [cat('cat-groceries', 'Groceries', 'EVERYDAY'), cat('cat-holidays', 'Holidays', 'SINKING_FUNDS', 'POT')];
    const targets: CategoryTarget[] = [
      { categoryId: 'cat-groceries', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' },
      { categoryId: 'cat-holidays', targetAmount: 5000, period: 'MONTHLY', updatedAt: '' },
    ];
    const transactions = [
      txn('2026-07', 'EXPENSE', 25000, 'cat-groceries'),
      txn('2026-08', 'EXPENSE', 15000, 'cat-groceries'),
    ];
    const rows = targetAdherence(transactions, categories, targets, ['2026-07', '2026-08', '2026-09']);
    expect(rows).toEqual([{ categoryId: 'cat-groceries', name: 'Groceries', monthsOverTarget: 1, monthsInSpan: 3 }]);
  });
});
