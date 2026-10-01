import { describe, expect, it } from 'vitest';
import { billsBeforePayday, nextPayday } from '../moneyAhead';
import type { Recurring, Transaction } from '../types';

function bill(overrides: Partial<Recurring> = {}): Recurring {
  return {
    recurringId: 'r', type: 'EXPENSE', categoryId: 'c', amount: 85000, description: 'Rent', dayOfMonth: 1, frequency: 'MONTHLY',
    anchorDate: null, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...overrides,
  };
}

describe('nextPayday', () => {
  it('is this month when the pay day has not come yet', () => {
    expect(nextPayday('2026-09-10', 25)).toBe('2026-09-25');
  });

  it('is next month once the pay day has come or gone, including today', () => {
    expect(nextPayday('2026-09-25', 25)).toBe('2026-10-25');
    expect(nextPayday('2026-09-28', 25)).toBe('2026-10-25');
  });

  it('crosses the year end', () => {
    expect(nextPayday('2026-12-28', 25)).toBe('2027-01-25');
  });

  it('puts a 31st on the last day of a shorter month', () => {
    expect(nextPayday('2026-09-10', 31)).toBe('2026-09-30');
    expect(nextPayday('2027-02-01', 31)).toBe('2027-02-28');
  });
});

describe('billsBeforePayday', () => {
  it('adds up the spending bills due before the next pay day', () => {
    const result = billsBeforePayday([bill({ dayOfMonth: 15 }), bill({ recurringId: 'b', amount: 6000, dayOfMonth: 20 })], [], '2026-09-10', 25);
    expect(result).toEqual({ payday: '2026-09-25', daysToPayday: 15, total: 91000, count: 2 });
  });

  it('leaves out bills due on or after pay day, and bills already past', () => {
    const result = billsBeforePayday([bill({ dayOfMonth: 25 }), bill({ recurringId: 'b', dayOfMonth: 5 })], [], '2026-09-10', 25);
    expect(result.count).toBe(0);
    expect(result.total).toBe(0);
  });

  it('leaves out income', () => {
    expect(billsBeforePayday([bill({ type: 'INCOME', dayOfMonth: 15 })], [], '2026-09-10', 25).count).toBe(0);
  });

  it('leaves out a bill that has been skipped for the month', () => {
    expect(billsBeforePayday([bill({ dayOfMonth: 15, handledPeriod: '2026-09' })], [], '2026-09-10', 25).count).toBe(0);
  });

  it('leaves out a bill already added from its schedule', () => {
    const added: Transaction = { transactionId: 't', yearMonth: '2026-09', amount: 85000, type: 'EXPENSE', categoryId: 'c', description: '', date: '2026-09-08', createdAt: '', recurringId: 'r' };
    expect(billsBeforePayday([bill({ dayOfMonth: 15 })], [added], '2026-09-10', 25).count).toBe(0);
  });

  it('counts a weekly bill each time it falls due', () => {
    const weekly = bill({ frequency: 'WEEKLY', anchorDate: '2026-09-07', amount: 1000 });
    const result = billsBeforePayday([weekly], [], '2026-09-10', 25);
    // 14 and 21 September fall before the 25th.
    expect(result.count).toBe(2);
    expect(result.total).toBe(2000);
  });
});
