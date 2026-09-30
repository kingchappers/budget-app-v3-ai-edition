import { describe, it, expect } from 'vitest';
import {
  fetchRangeForAnchor, canGoNewer, monthsInPeriod, splitPeriods, summaryTotals,
  groupBreakdown, categoriesInGroup, monthlyTrend, biggestMovers, targetAdherence,
  countableMonths, monthCoverage, monthRange, monthTargetOutcome, planComparison, reachedPotGoals, trackingStatus,
} from '../insights';
import type { Category, CategoryTarget, PotSummary, Transaction } from '../types';

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
    expect(rows).toEqual([{ categoryId: 'cat-groceries', name: 'Groceries', monthsOverTarget: 1, monthsWithin: 2, monthsInSpan: 3 }]);
  });
});

// A transaction on a given day, for tests that depend on which days have entries.
function onDay(date: string, type: Transaction['type'] = 'EXPENSE', amount = 1000, categoryId = 'cat-groceries'): Transaction {
  return { transactionId: `${date}-${type}-${categoryId}-${amount}`, yearMonth: date.slice(0, 7), amount, type, categoryId, description: '', date, createdAt: '' };
}

function daysOf(yearMonth: string, days: number[], amount = 1000, categoryId = 'cat-groceries'): Transaction[] {
  return days.map(day => onDay(`${yearMonth}-${String(day).padStart(2, '0')}`, 'EXPENSE', amount, categoryId));
}

function firstDays(yearMonth: string, count: number, amount = 1000, categoryId = 'cat-groceries'): Transaction[] {
  return daysOf(yearMonth, Array.from({ length: count }, (_, index) => index + 1), amount, categoryId);
}

describe('monthCoverage', () => {
  it('counts the days with at least one entry, however many entries a day has', () => {
    const transactions = [onDay('2026-08-03'), onDay('2026-08-03', 'INCOME'), onDay('2026-08-20')];
    expect(monthCoverage(transactions, '2026-08', '2026-09-15')).toMatchObject({ daysWithEntries: 2, daysCounted: 31 });
  });

  it('judges a finished month on all its days and a month in progress on the days so far', () => {
    const transactions = daysOf('2026-09', [1, 2, 3, 4, 5]);
    expect(monthCoverage(transactions, '2026-09', '2026-09-05')).toMatchObject({ daysCounted: 5, share: 1 });
    expect(monthCoverage(transactions, '2026-09', '2026-09-30')).toMatchObject({ daysCounted: 30 });
  });

  it('ignores entries dated after today in the month in progress', () => {
    const transactions = [onDay('2026-09-03'), onDay('2026-09-28')];
    expect(monthCoverage(transactions, '2026-09', '2026-09-05').daysWithEntries).toBe(1);
  });

  it('has no coverage at all for a month that has not started', () => {
    expect(monthCoverage([], '2026-10', '2026-09-15')).toMatchObject({ daysCounted: 0, share: 0 });
  });

  it('can stop counting at a given day, for like-for-like comparison', () => {
    const transactions = daysOf('2026-08', [2, 20]);
    expect(monthCoverage(transactions, '2026-08', '2026-09-15', 5)).toMatchObject({ daysWithEntries: 1, daysCounted: 5 });
  });
});

describe('trackingStatus', () => {
  it('is tracked from a quarter of the days, and partly tracked below it', () => {
    const quarter = monthCoverage(firstDays('2026-06', 8), '2026-06', '2026-09-15');
    const fewer = monthCoverage(firstDays('2026-06', 7), '2026-06', '2026-09-15');
    expect(trackingStatus(quarter, [])).toBe('tracked');
    expect(trackingStatus(fewer, [])).toBe('partly');
  });

  it('treats a month with nothing logged as partly tracked', () => {
    expect(trackingStatus(monthCoverage([], '2026-06', '2026-09-15'), [])).toBe('partly');
  });

  it('lets the user mark a fully tracked month as not tracked', () => {
    const full = monthCoverage(firstDays('2026-06', 30), '2026-06', '2026-09-15');
    expect(trackingStatus(full, ['2026-06'])).toBe('marked');
  });
});

describe('planComparison', () => {
  const groceries = [cat('cat-groceries', 'Groceries', 'EVERYDAY')];

  it('compares a month in progress with the same days of the month before', () => {
    const transactions = [
      ...firstDays('2026-08', 31, 100),
      ...firstDays('2026-09', 5, 100),
    ];
    const plan = planComparison(transactions, ['2026-09', '2026-09'], ['2026-08', '2026-08'], '2026-09-05');
    expect(plan.comparable).toBe(true);
    expect(plan.currentLabel).toBe('1–5 Sep');
    expect(plan.previousLabel).toBe('1–5 Aug');
    expect(summaryTotals(transactions, plan.current).spent).toBe(500);
    expect(summaryTotals(transactions, plan.previous).spent).toBe(500);
    expect(summaryTotals(transactions, ['2026-08', '2026-08']).spent).toBe(3100);
  });

  it('names a finished month by its name', () => {
    const transactions = [...firstDays('2026-07', 20), ...firstDays('2026-08', 20)];
    const plan = planComparison(transactions, ['2026-08', '2026-08'], ['2026-07', '2026-07'], '2026-09-15');
    expect(plan.currentLabel).toBe('August');
    expect(plan.previousLabel).toBe('July');
  });

  it('does not count spending after the cut-off day in a month still in progress', () => {
    const transactions = [...firstDays('2026-08', 31, 100), ...firstDays('2026-09', 5, 100), onDay('2026-09-20', 'EXPENSE', 99999)];
    const plan = planComparison(transactions, ['2026-09', '2026-09'], ['2026-08', '2026-08'], '2026-09-05');
    expect(summaryTotals(transactions, plan.current).spent).toBe(500);
  });

  it('leaves out a partly tracked month, and the month it is paired with', () => {
    const transactions = [
      ...firstDays('2026-05', 25), ...firstDays('2026-06', 25), ...firstDays('2026-07', 2),
      ...firstDays('2026-08', 25), ...firstDays('2026-09', 25), ...firstDays('2026-10', 25),
    ];
    const plan = planComparison(transactions, ['2026-08', '2026-10'], ['2026-05', '2026-07'], '2026-11-15');
    expect(plan.leftOut).toEqual([{ yearMonth: '2026-07', status: 'partly' }]);
    expect(plan.current.months).toEqual(['2026-08', '2026-09']);
    expect(plan.previous.months).toEqual(['2026-05', '2026-06']);
    expect(plan.comparable).toBe(true);
  });

  it('is not comparable when nothing has been logged', () => {
    const plan = planComparison([], ['2026-09', '2026-09'], ['2026-08', '2026-08'], '2026-09-15');
    expect(plan.comparable).toBe(false);
    expect(plan.leftOut.map(item => item.yearMonth).sort()).toEqual(['2026-08', '2026-09']);
  });

  it('is not comparable early in a month with hardly anything logged', () => {
    const transactions = [...firstDays('2026-08', 31), onDay('2026-09-01')];
    const plan = planComparison(transactions, ['2026-09', '2026-09'], ['2026-08', '2026-08'], '2026-09-05');
    expect(plan.comparable).toBe(false);
    expect(plan.leftOut).toEqual([{ yearMonth: '2026-09', status: 'partly' }]);
  });

  it('leaves out a month the user marked as not tracked, even if it was fully logged', () => {
    const transactions = [...firstDays('2026-07', 30), ...firstDays('2026-08', 30)];
    const plan = planComparison(transactions, ['2026-08', '2026-08'], ['2026-07', '2026-07'], '2026-09-15', ['2026-07']);
    expect(plan.comparable).toBe(false);
    expect(plan.leftOut).toEqual([{ yearMonth: '2026-07', status: 'marked' }]);
  });

  it('judges the earlier month on the same days as the month in progress', () => {
    // August was only logged late in the month, but the 1st to 5th were covered.
    const transactions = [...daysOf('2026-08', [1, 2, 3, 4, 5]), ...firstDays('2026-09', 5)];
    const plan = planComparison(transactions, ['2026-09', '2026-09'], ['2026-08', '2026-08'], '2026-09-05');
    expect(plan.comparable).toBe(true);
  });

  it('shortens a cut-off that is past the end of the shorter month', () => {
    const transactions = [...firstDays('2026-02', 28), ...firstDays('2026-03', 30)];
    const plan = planComparison(transactions, ['2026-03', '2026-03'], ['2026-02', '2026-02'], '2026-03-30');
    expect(plan.currentLabel).toBe('1–30 Mar');
    expect(plan.previousLabel).toBe('1–28 Feb');
  });

  it('feeds the like-for-like slices to the movers and group totals', () => {
    const transactions = [...firstDays('2026-08', 31, 100), ...firstDays('2026-09', 5, 300)];
    const plan = planComparison(transactions, ['2026-09', '2026-09'], ['2026-08', '2026-08'], '2026-09-05');
    const movers = biggestMovers(transactions, groceries, plan.current, plan.previous);
    expect(movers.up).toEqual([expect.objectContaining({ currentPence: 1500, previousPence: 500, deltaPence: 1000 })]);
    const [row] = groupBreakdown(transactions, groceries, plan.current, plan.previous);
    expect([row.current, row.previous]).toEqual([1500, 500]);
  });

  it('labels a multi-month range, with years when it crosses a year end', () => {
    const transactions = [
      ...firstDays('2025-11', 25), ...firstDays('2025-12', 25), ...firstDays('2026-01', 25),
      ...firstDays('2026-02', 25), ...firstDays('2026-03', 25), ...firstDays('2026-04', 25),
    ];
    const plan = planComparison(transactions, ['2026-02', '2026-04'], ['2025-11', '2026-01'], '2026-06-15');
    expect(plan.currentLabel).toBe('Feb–Apr 2026');
    expect(plan.previousLabel).toBe('Nov 2025–Jan 2026');
  });
});

describe('monthRange', () => {
  it('reads as a month, a range within a year, or a range across years', () => {
    expect(monthRange('2026-03', '2026-03')).toBe('Mar 2026');
    expect(monthRange('2026-03', '2026-05')).toBe('Mar–May 2026');
    expect(monthRange('2025-11', '2026-01')).toBe('Nov 2025–Jan 2026');
  });
});

describe('countableMonths', () => {
  it('keeps only finished months that were tracked and not marked', () => {
    const transactions = [...firstDays('2026-06', 25), ...firstDays('2026-07', 2), ...firstDays('2026-08', 25), ...firstDays('2026-09', 25)];
    expect(countableMonths(transactions, ['2026-06', '2026-07', '2026-08', '2026-09'], '2026-09-28', ['2026-08'])).toEqual(['2026-06']);
  });
});

describe('monthTargetOutcome', () => {
  const categories = [cat('cat-groceries', 'Groceries', 'EVERYDAY'), cat('cat-dining', 'Dining', 'EVERYDAY'), cat('cat-holidays', 'Holidays', 'SINKING_FUNDS', 'POT')];
  const targets: CategoryTarget[] = [
    { categoryId: 'cat-groceries', targetAmount: 20000, period: 'MONTHLY', updatedAt: '' },
    { categoryId: 'cat-holidays', targetAmount: 5000, period: 'MONTHLY', updatedAt: '' },
  ];

  it('totals what was planned and spent across targeted spending categories only', () => {
    const transactions = [
      onDay('2026-08-05', 'EXPENSE', 15000, 'cat-groceries'),
      onDay('2026-08-06', 'EXPENSE', 9000, 'cat-dining'),
    ];
    expect(monthTargetOutcome(transactions, categories, targets, '2026-08')).toEqual({ yearMonth: '2026-08', targeted: 20000, spent: 15000 });
  });

  it('is null when no spending category has a target', () => {
    expect(monthTargetOutcome([], categories, [targets[1]], '2026-08')).toBeNull();
  });

  it('counts a weekly target as the month it falls in', () => {
    const weekly: CategoryTarget[] = [{ categoryId: 'cat-groceries', targetAmount: 7000, period: 'WEEKLY', updatedAt: '' }];
    expect(monthTargetOutcome([], categories, weekly, '2026-09')?.targeted).toBe(30000);
  });
});

describe('reachedPotGoals', () => {
  function pot(categoryId: string, balance: number, goalAmount: number | null): PotSummary {
    return { categoryId, monthlyAmount: null, goalAmount, autoAmountNow: 0, balance, thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [] };
  }
  const categories = [cat('cat-holidays', 'Holidays', 'SINKING_FUNDS', 'POT'), cat('cat-car', 'Car', 'SINKING_FUNDS', 'POT')];

  it('lists pots whose balance has reached their goal, and only those', () => {
    const reached = reachedPotGoals([pot('cat-holidays', 120000, 120000), pot('cat-car', 5000, 50000)], categories);
    expect(reached).toEqual([{ categoryId: 'cat-holidays', name: 'Holidays' }]);
  });

  it('ignores pots with no goal', () => {
    expect(reachedPotGoals([pot('cat-holidays', 120000, null)], categories)).toEqual([]);
  });
});
