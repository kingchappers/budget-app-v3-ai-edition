import { describe, it, expect } from 'vitest';
import {
  computeDueItems, dueDateFor, dueLabel, formatDayOfMonth, isHandled, validateRecurringForm,
} from '../recurring';
import type { Category, Recurring, Transaction } from '../types';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...over,
  };
}

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 240000, type: 'INCOME', categoryId: 'cat-salary',
    description: 'Salary', date: '2026-09-28', createdAt: '', ...over,
  };
}

function cat(categoryId: string, type: Category['type']): Category {
  return { categoryId, name: categoryId, type, icon: 'x', isDefault: true, createdAt: '' };
}

const categories = [cat('cat-salary', 'INCOME'), cat('cat-housing', 'EXPENSE')];

function due(templates: Recurring[], today: string, transactions: Transaction[] = []) {
  return computeDueItems({ recurring: templates, categories, transactions, today });
}

describe('dueDateFor', () => {
  it('uses the day, clamped to the last day of short months', () => {
    expect(dueDateFor('2026-09', 28)).toBe('2026-09-28');
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28');
    expect(dueDateFor('2028-02', 30)).toBe('2028-02-29');
    expect(dueDateFor('2026-04', 31)).toBe('2026-04-30');
  });
});

describe('isHandled', () => {
  it('is handled when the marker covers the period or a later one', () => {
    expect(isHandled(rec({ handledPeriod: '2026-09' }), '2026-09', [])).toBe(true);
    expect(isHandled(rec({ handledPeriod: '2026-10' }), '2026-09', [])).toBe(true);
    expect(isHandled(rec({ handledPeriod: '2026-08' }), '2026-09', [])).toBe(false);
    expect(isHandled(rec({ handledPeriod: null }), '2026-09', [])).toBe(false);
  });

  it('is handled by a matching transaction in the period', () => {
    expect(isHandled(rec({}), '2026-09', [txn({})])).toBe(true);
  });

  it('matches the note ignoring case and spaces', () => {
    expect(isHandled(rec({ description: 'Salary' }), '2026-09', [txn({ description: '  SALARY ' })])).toBe(true);
  });

  it('matches any note when the template has none', () => {
    expect(isHandled(rec({ description: '' }), '2026-09', [txn({ description: 'Bonus' })])).toBe(true);
  });

  it('is not handled by a different note, type, category or month', () => {
    expect(isHandled(rec({ description: 'Salary' }), '2026-09', [txn({ description: 'Bonus' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ type: 'EXPENSE' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ categoryId: 'cat-housing' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ date: '2026-08-28' })])).toBe(false);
  });
});

describe('computeDueItems visibility', () => {
  it('is hidden before the lead time starts', () => {
    expect(due([rec({})], '2026-09-24')).toEqual([]);
  });

  it('shows from the first lead day as upcoming', () => {
    const [item] = due([rec({})], '2026-09-25');
    expect(item).toMatchObject({ period: '2026-09', dueDate: '2026-09-28', status: 'upcoming', daysAway: 3 });
  });

  it('shows on the due day', () => {
    expect(due([rec({})], '2026-09-28')[0]).toMatchObject({ status: 'today', daysAway: 0 });
  });

  it('stays until the month ends, as overdue', () => {
    expect(due([rec({})], '2026-09-30')[0]).toMatchObject({ status: 'overdue', daysAway: -2 });
  });

  it('drops off in the next month until its own lead time starts', () => {
    expect(due([rec({})], '2026-10-01')).toEqual([]);
    expect(due([rec({})], '2026-10-25')[0]).toMatchObject({ period: '2026-10', status: 'upcoming' });
  });

  it('honours a lead time of zero', () => {
    expect(due([rec({ leadDays: 0 })], '2026-09-27')).toEqual([]);
    expect(due([rec({ leadDays: 0 })], '2026-09-28')[0].status).toBe('today');
  });

  it('honours a lead time of fourteen days across a month boundary', () => {
    const template = rec({ dayOfMonth: 1, leadDays: 14, handledPeriod: '2026-09' });
    expect(due([template], '2026-09-16')).toEqual([]);
    expect(due([template], '2026-09-17')[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01', daysAway: 14 });
  });

  it('clamps the 31st in a short month', () => {
    expect(due([rec({ dayOfMonth: 31 })], '2026-02-28')[0]).toMatchObject({ dueDate: '2026-02-28', status: 'today' });
  });

  it('excludes templates whose category no longer exists', () => {
    expect(due([rec({ categoryId: 'cat-deleted' })], '2026-09-28')).toEqual([]);
  });
});

describe('computeDueItems handled state and one row per template', () => {
  const rent = rec({ recurringId: 'rent', type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', dayOfMonth: 1, leadDays: 3 });

  it('shows the earliest unhandled occurrence only', () => {
    const items = due([rent], '2026-09-28');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ period: '2026-09', status: 'overdue' });
  });

  it('moves on to the next occurrence once the earlier one is handled by a transaction', () => {
    const paid = txn({ type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', date: '2026-09-01' });
    expect(due([rent], '2026-09-28', [paid])[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01', daysAway: 3 });
  });

  it('moves on once the earlier occurrence is skipped', () => {
    expect(due([{ ...rent, handledPeriod: '2026-09' }], '2026-09-28')[0]).toMatchObject({ period: '2026-10' });
  });

  it('hides everything a later marker covers', () => {
    expect(due([{ ...rent, handledPeriod: '2026-10' }], '2026-09-28')).toEqual([]);
  });

  it('clears a due item when the matching transaction is typed in by hand', () => {
    expect(due([rec({})], '2026-09-28', [txn({})])).toEqual([]);
  });
});

describe('computeDueItems ordering', () => {
  it('lists overdue first, then today, then upcoming, soonest first', () => {
    const overdue = rec({ recurringId: 'a', dayOfMonth: 26 });
    const today = rec({ recurringId: 'b', dayOfMonth: 28 });
    const upcoming = rec({ recurringId: 'c', dayOfMonth: 30 });
    const items = due([upcoming, today, overdue], '2026-09-28');
    expect(items.map(item => item.recurring.recurringId)).toEqual(['a', 'b', 'c']);
    expect(items.map(item => item.status)).toEqual(['overdue', 'today', 'upcoming']);
  });

  it('breaks ties by note and then id', () => {
    const items = due([
      rec({ recurringId: 'z', description: 'Bonus' }),
      rec({ recurringId: 'y', description: 'Allowance' }),
    ], '2026-09-28');
    expect(items.map(item => item.recurring.description)).toEqual(['Allowance', 'Bonus']);
  });
});

describe('dueLabel', () => {
  it('describes each status', () => {
    expect(dueLabel({ status: 'today', daysAway: 0 })).toBe('Due today');
    expect(dueLabel({ status: 'upcoming', daysAway: 1 })).toBe('Due in 1 day');
    expect(dueLabel({ status: 'upcoming', daysAway: 3 })).toBe('Due in 3 days');
    expect(dueLabel({ status: 'overdue', daysAway: -1 })).toBe('1 day overdue');
    expect(dueLabel({ status: 'overdue', daysAway: -2 })).toBe('2 days overdue');
  });
});

describe('formatDayOfMonth', () => {
  it('adds the right ordinal suffix', () => {
    const cases: [number, string][] = [
      [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'],
      [21, '21st'], [22, '22nd'], [23, '23rd'], [28, '28th'], [31, '31st'],
    ];
    for (const [day, expected] of cases) expect(formatDayOfMonth(day)).toBe(expected);
  });
});

describe('validateRecurringForm', () => {
  const values = {
    type: 'INCOME' as const, categoryId: 'cat-salary', amount: '2400.00', description: ' Salary ',
    dayOfMonth: 28 as number | string, leadDays: 3 as number | string,
  };

  it('returns the API input in pence, with the note trimmed', () => {
    expect(validateRecurringForm(values)).toEqual({
      ok: true,
      value: { type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary', dayOfMonth: 28, leadDays: 3 },
    });
  });

  it('accepts whole numbers typed as text and both range ends', () => {
    expect(validateRecurringForm({ ...values, dayOfMonth: '1', leadDays: '0' }).ok).toBe(true);
    expect(validateRecurringForm({ ...values, dayOfMonth: 31, leadDays: 14 }).ok).toBe(true);
  });

  it('reports each problem on its own field, all at once', () => {
    const result = validateRecurringForm({ ...values, amount: 'abc', categoryId: null, dayOfMonth: 40, leadDays: 20 });
    expect(result).toEqual({
      ok: false,
      errors: {
        amount: 'Enter a valid amount',
        category: 'Choose a category',
        dayOfMonth: 'Enter a day from 1 to 31',
        leadDays: 'Enter 0 to 14 days',
      },
    });
  });

  it.each([0, 32, 1.5, '', 'abc', -3])('rejects day of month %s', (dayOfMonth) => {
    const result = validateRecurringForm({ ...values, dayOfMonth });
    expect(result.ok === false && result.errors.dayOfMonth).toBe('Enter a day from 1 to 31');
  });

  it.each([-1, 15, 2.5, '', 'x'])('rejects remind days %s', (leadDays) => {
    const result = validateRecurringForm({ ...values, leadDays });
    expect(result.ok === false && result.errors.leadDays).toBe('Enter 0 to 14 days');
  });

  it('treats a whitespace-only note as empty', () => {
    const result = validateRecurringForm({ ...values, description: '   ' });
    expect(result.ok && result.value.description).toBe('');
  });

  it('accepts a note of exactly 200 characters after trimming', () => {
    expect(validateRecurringForm({ ...values, description: ` ${'a'.repeat(200)} ` }).ok).toBe(true);
  });

  it('reports an empty amount and an overlong note', () => {
    const empty = validateRecurringForm({ ...values, amount: '' });
    expect(empty.ok === false && empty.errors.amount).toBe('Enter an amount');
    const long = validateRecurringForm({ ...values, description: 'a'.repeat(201) });
    expect(long.ok === false && long.errors.description).toBe('Note is too long');
  });
});
