import { describe, it, expect } from 'vitest';
import { autoAmountFor, computePots, nextMonth } from '../potsCalc';
import type { PotAutoEntry, PotSettings, Transaction } from '../types';

function txn(yearMonth: string, type: Transaction['type'], amount: number, categoryId = 'pot-a'): Transaction {
  return {
    transactionId: `${yearMonth}-${type}-${amount}-${categoryId}`, yearMonth, amount, type, categoryId,
    description: '', date: `${yearMonth}-10`, createdAt: '',
  };
}

function settings(overrides: Partial<PotSettings> = {}): PotSettings {
  return { categoryId: 'pot-a', monthlyAmount: null, goalAmount: null, autoContribute: [], updatedAt: '', ...overrides };
}

function run(transactions: Transaction[], asOfMonth: string, potSettings: PotSettings[] = []) {
  return computePots({ transactions, potCategoryIds: ['pot-a'], settings: potSettings, asOfMonth })[0];
}

describe('nextMonth', () => {
  it.each([
    ['2026-01', '2026-02'],
    ['2026-11', '2026-12'],
    ['2026-12', '2027-01'],
  ])('%s -> %s', (from, expected) => {
    expect(nextMonth(from)).toBe(expected);
  });
});

describe('autoAmountFor', () => {
  const entries: PotAutoEntry[] = [{ from: '2026-06', amount: 5000 }, { from: '2026-08', amount: 0 }];

  it('is 0 before the first entry', () => {
    expect(autoAmountFor(entries, '2026-05')).toBe(0);
  });

  it('uses the last entry whose month has arrived', () => {
    expect(autoAmountFor(entries, '2026-07')).toBe(5000);
    expect(autoAmountFor(entries, '2026-08')).toBe(0);
    expect(autoAmountFor(entries, '2027-01')).toBe(0);
  });
});

describe('computePots', () => {
  it('returns an empty history and a zero balance for a pot with no activity', () => {
    const pot = run([], '2026-08');
    expect(pot.months).toEqual([]);
    expect(pot.balance).toBe(0);
    expect(pot.autoAmountNow).toBe(0);
    expect(pot.thisMonth).toEqual({ setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 });
    expect(pot.monthlyAmount).toBeNull();
    expect(pot.goalAmount).toBeNull();
  });

  it('adds set asides and draws down on spends, carrying the balance forward', () => {
    const pot = run([txn('2026-07', 'SET_ASIDE', 10000), txn('2026-08', 'EXPENSE', 2500)], '2026-08');
    expect(pot.months.map(m => [m.yearMonth, m.opening, m.closing])).toEqual([
      ['2026-07', 0, 10000],
      ['2026-08', 10000, 7500],
    ]);
    expect(pot.balance).toBe(7500);
    expect(pot.thisMonth).toEqual({ setAside: 0, autoAdded: 0, takeOut: 0, spent: 2500 });
  });

  it('carries the balance across months with no activity', () => {
    const pot = run([txn('2026-06', 'SET_ASIDE', 5000)], '2026-08');
    expect(pot.months.map(m => [m.yearMonth, m.closing])).toEqual([
      ['2026-06', 5000], ['2026-07', 5000], ['2026-08', 5000],
    ]);
  });

  it('takes money out of the pot', () => {
    const pot = run([txn('2026-07', 'SET_ASIDE', 10000), txn('2026-07', 'TAKE_OUT', 4000)], '2026-07');
    expect(pot.months[0]).toMatchObject({ setAside: 10000, takeOut: 4000, closing: 6000 });
  });

  it('allows a negative balance', () => {
    const pot = run([txn('2026-07', 'EXPENSE', 3000)], '2026-07');
    expect(pot.balance).toBe(-3000);
  });

  it('ignores other categories and INCOME entries', () => {
    const pot = run([
      txn('2026-07', 'SET_ASIDE', 1000, 'pot-b'),
      txn('2026-07', 'INCOME', 9999),
      txn('2026-07', 'SET_ASIDE', 2000),
    ], '2026-07');
    expect(pot.balance).toBe(2000);
  });

  it('leaves out entries dated after the as-of month', () => {
    expect(run([txn('2026-09', 'SET_ASIDE', 5000)], '2026-08').months).toEqual([]);
    const pot = run([txn('2026-07', 'SET_ASIDE', 5000), txn('2026-09', 'SET_ASIDE', 5000)], '2026-08');
    expect(pot.balance).toBe(5000);
  });

  it('spans a year boundary without gaps', () => {
    const pot = run([txn('2026-11', 'SET_ASIDE', 100)], '2027-02');
    expect(pot.months.map(m => m.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('changes a backdated month from that month forward', () => {
    const before = run([txn('2026-08', 'SET_ASIDE', 1000)], '2026-08');
    const after = run([txn('2026-08', 'SET_ASIDE', 1000), txn('2026-06', 'SET_ASIDE', 500)], '2026-08');
    expect(before.balance).toBe(1000);
    expect(after.months.map(m => m.closing)).toEqual([500, 500, 1500]);
  });

  describe('auto-contribute', () => {
    it('accrues from its first month through the as-of month inclusive', () => {
      const pot = run([], '2026-08', [settings({ autoContribute: [{ from: '2026-06', amount: 5000 }] })]);
      expect(pot.months.map(m => m.autoAdded)).toEqual([5000, 5000, 5000]);
      expect(pot.balance).toBe(15000);
      expect(pot.autoAmountNow).toBe(5000);
    });

    it('applies an amount change only from its month', () => {
      const pot = run([], '2026-09', [settings({
        autoContribute: [{ from: '2026-06', amount: 5000 }, { from: '2026-08', amount: 7000 }],
      })]);
      expect(pot.months.map(m => m.autoAdded)).toEqual([5000, 5000, 7000, 7000]);
      expect(pot.balance).toBe(24000);
    });

    it('stops when turned off', () => {
      const pot = run([], '2026-09', [settings({
        autoContribute: [{ from: '2026-06', amount: 5000 }, { from: '2026-08', amount: 0 }],
      })]);
      expect(pot.months.map(m => m.autoAdded)).toEqual([5000, 5000, 0, 0]);
      expect(pot.autoAmountNow).toBe(0);
      expect(pot.balance).toBe(10000);
    });

    it('ignores an entry that starts after the as-of month', () => {
      const pot = run([], '2026-08', [settings({ autoContribute: [{ from: '2026-10', amount: 5000 }] })]);
      expect(pot.months).toEqual([]);
      expect(pot.autoAmountNow).toBe(0);
    });

    it('combines with explicit entries in the same month', () => {
      const pot = run([txn('2026-08', 'SET_ASIDE', 1000), txn('2026-08', 'EXPENSE', 300)], '2026-08', [
        settings({ autoContribute: [{ from: '2026-08', amount: 5000 }] }),
      ]);
      expect(pot.months[0]).toMatchObject({ setAside: 1000, autoAdded: 5000, spent: 300, closing: 5700 });
    });
  });

  it('echoes the monthly and goal amounts', () => {
    const pot = run([], '2026-08', [settings({ monthlyAmount: 5000, goalAmount: 300000 })]);
    expect(pot.monthlyAmount).toBe(5000);
    expect(pot.goalAmount).toBe(300000);
  });

  it('returns pots in the order of potCategoryIds', () => {
    const pots = computePots({
      transactions: [], potCategoryIds: ['pot-b', 'pot-a'], settings: [], asOfMonth: '2026-08',
    });
    expect(pots.map(p => p.categoryId)).toEqual(['pot-b', 'pot-a']);
  });
});
