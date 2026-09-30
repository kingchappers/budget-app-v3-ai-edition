import { describe, it, expect } from 'vitest';
import {
  computeDueItems, dueDateFor, dueLabel, formatDayOfMonth, groupDueItems, isHandled, likelyMatches,
  olderGroupHeading, skippedPeriod, validateRecurringForm,
} from '../recurring';
import type { Category, Recurring, Transaction } from '../types';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '', ...over,
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

  it('is handled by a transaction in the period that carries its recurringId', () => {
    expect(isHandled(rec({}), '2026-09', [txn({ recurringId: 'r1' })])).toBe(true);
  });

  it('counts a linked transaction whatever its note, amount or category', () => {
    const linked = txn({ recurringId: 'r1', description: 'Something else', amount: 1, categoryId: 'cat-housing' });
    expect(isHandled(rec({}), '2026-09', [linked])).toBe(true);
  });

  it('is not handled by a transaction linked to another bill or in another month', () => {
    expect(isHandled(rec({}), '2026-09', [txn({ recurringId: 'r2' })])).toBe(false);
    expect(isHandled(rec({}), '2026-09', [txn({ recurringId: 'r1', date: '2026-08-28' })])).toBe(false);
  });

  it('never infers payment from the same category when the template has no note', () => {
    expect(isHandled(rec({ description: '' }), '2026-09', [txn({ description: 'Bonus' })])).toBe(false);
  });

  it('never infers payment from a matching note', () => {
    expect(isHandled(rec({ description: 'Salary' }), '2026-09', [txn({ description: '  SALARY ' })])).toBe(false);
  });
});

describe('likelyMatches', () => {
  const netflix = rec({ recurringId: 'nf', type: 'EXPENSE', categoryId: 'cat-subs', amount: 1000, description: 'Netflix' });

  function spend(over: Partial<Transaction>): Transaction {
    return txn({ type: 'EXPENSE', categoryId: 'cat-subs', amount: 1000, description: 'Netflix sub', date: '2026-09-03', ...over });
  }

  it('finds a manual entry with a different note, same type and category, in the period', () => {
    expect(likelyMatches(netflix, '2026-09', [spend({})]).map(t => t.transactionId)).toEqual(['t1']);
  });

  it('accepts amounts within 10% either way and rejects anything further', () => {
    expect(likelyMatches(netflix, '2026-09', [spend({ amount: 900 })])).toHaveLength(1);
    expect(likelyMatches(netflix, '2026-09', [spend({ amount: 1100 })])).toHaveLength(1);
    expect(likelyMatches(netflix, '2026-09', [spend({ amount: 899 })])).toHaveLength(0);
    expect(likelyMatches(netflix, '2026-09', [spend({ amount: 1101 })])).toHaveLength(0);
  });

  it('ignores other types, categories, periods and linked transactions', () => {
    expect(likelyMatches(netflix, '2026-09', [
      spend({ transactionId: 'a', type: 'INCOME' }),
      spend({ transactionId: 'b', categoryId: 'cat-food' }),
      spend({ transactionId: 'c', date: '2026-08-03' }),
      spend({ transactionId: 'd', recurringId: 'other' }),
    ])).toEqual([]);
  });

  it('puts the closest amount first, then the latest date', () => {
    const matches = likelyMatches(netflix, '2026-09', [
      spend({ transactionId: 'far', amount: 1080, date: '2026-09-20' }),
      spend({ transactionId: 'early', amount: 1010, date: '2026-09-02' }),
      spend({ transactionId: 'late', amount: 990, date: '2026-09-10' }),
    ]);
    expect(matches.map(t => t.transactionId)).toEqual(['late', 'early', 'far']);
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

  it('stays after the due date as a past item', () => {
    expect(due([rec({})], '2026-09-30')[0]).toMatchObject({ status: 'past', daysAway: -2 });
  });

  it('keeps an unlogged bill after its month ends', () => {
    expect(due([rec({})], '2026-10-01')[0]).toMatchObject({ period: '2026-09', dueDate: '2026-09-28', status: 'past' });
    expect(due([rec({})], '2026-12-15')[0]).toMatchObject({ period: '2026-09' });
  });

  it('looks back three months and no further', () => {
    const old = rec({ handledPeriod: null, createdAt: '2025-01-01T00:00:00.000Z' });
    expect(due([old], '2026-12-01')[0]).toMatchObject({ period: '2026-09' });
    expect(due([{ ...old, handledPeriod: '2026-11' }], '2026-12-01')).toEqual([]);
  });

  it('never looks back before the month the template was created', () => {
    const fresh = rec({ createdAt: '2026-10-05T09:00:00.000Z' });
    expect(due([fresh], '2026-12-01')[0]).toMatchObject({ period: '2026-10' });
    expect(due([rec({ createdAt: '2026-12-01T09:00:00.000Z', dayOfMonth: 28 })], '2026-12-01')).toEqual([]);
  });

  it('uses only the three-month window when the creation date is missing', () => {
    expect(due([rec({ createdAt: '' })], '2026-12-01')[0]).toMatchObject({ period: '2026-09' });
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
    expect(due([rec({ dayOfMonth: 31, createdAt: '2026-02-01T09:00:00.000Z' })], '2026-02-28')[0]).toMatchObject({ dueDate: '2026-02-28', status: 'today' });
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
    expect(items[0]).toMatchObject({ period: '2026-09', status: 'past' });
  });

  it('shows the earliest of several unlogged months first', () => {
    expect(due([rent], '2026-11-15')[0]).toMatchObject({ period: '2026-09' });
    expect(due([{ ...rent, handledPeriod: '2026-09' }], '2026-11-15')[0]).toMatchObject({ period: '2026-10' });
  });

  it('moves on to the next occurrence once the earlier one is added from the Due list', () => {
    const paid = txn({ type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', date: '2026-09-01', recurringId: 'rent' });
    expect(due([rent], '2026-09-28', [paid])[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01', daysAway: 3 });
  });

  it('moves on once the earlier occurrence is skipped', () => {
    expect(due([{ ...rent, handledPeriod: '2026-09' }], '2026-09-28')[0]).toMatchObject({ period: '2026-10' });
  });

  it('hides everything a later marker covers', () => {
    expect(due([{ ...rent, handledPeriod: '2026-10' }], '2026-09-28')).toEqual([]);
  });

  it('keeps one bill due when another bill in the same category is logged', () => {
    const phone = rec({ recurringId: 'phone', type: 'EXPENSE', categoryId: 'cat-housing', description: '', amount: 3000, dayOfMonth: 5 });
    const rentPaid = txn({ type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, description: 'Rent', date: '2026-09-01', recurringId: 'rent' });
    expect(due([phone], '2026-09-28', [rentPaid])[0]).toMatchObject({ period: '2026-09', likelyMatches: [] });
  });

  it('offers a hand-typed entry as a likely match instead of hiding the bill', () => {
    const typed = txn({ transactionId: 'typed', description: 'salary sept', amount: 238000 });
    const [item] = due([rec({})], '2026-09-28', [typed]);
    expect(item.likelyMatches.map(t => t.transactionId)).toEqual(['typed']);
  });
});

describe('computeDueItems ordering', () => {
  it('lists past items first, then today, then upcoming, soonest first', () => {
    const past = rec({ recurringId: 'a', dayOfMonth: 26 });
    const today = rec({ recurringId: 'b', dayOfMonth: 28 });
    const upcoming = rec({ recurringId: 'c', dayOfMonth: 30 });
    const items = due([upcoming, today, past], '2026-09-28');
    expect(items.map(item => item.recurring.recurringId)).toEqual(['a', 'b', 'c']);
    expect(items.map(item => item.status)).toEqual(['past', 'today', 'upcoming']);
  });

  it('breaks ties by note and then id', () => {
    const items = due([
      rec({ recurringId: 'z', description: 'Bonus' }),
      rec({ recurringId: 'y', description: 'Allowance' }),
    ], '2026-09-28');
    expect(items.map(item => item.recurring.description)).toEqual(['Allowance', 'Bonus']);
  });
});

describe('groupDueItems', () => {
  it('keeps this month\'s and next month\'s items together and groups older months, oldest first', () => {
    const rent = rec({ recurringId: 'rent', type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', dayOfMonth: 1, createdAt: '2026-01-01T09:00:00.000Z' });
    const salary = rec({ recurringId: 'salary', handledPeriod: '2026-08' });
    const phone = rec({ recurringId: 'phone', type: 'EXPENSE', categoryId: 'cat-housing', description: 'Phone', dayOfMonth: 20, handledPeriod: '2026-10' });
    const items = due([rent, salary, phone], '2026-11-18');
    const groups = groupDueItems(items, '2026-11-18');

    expect(groups.current.map(i => i.recurring.recurringId)).toEqual(['phone']);
    expect(groups.older.map(g => [g.period, g.items.map(i => i.recurring.recurringId)])).toEqual([
      ['2026-08', ['rent']],
      ['2026-09', ['salary']],
    ]);
  });

  it('returns no groups when nothing is from an earlier month', () => {
    expect(groupDueItems(due([rec({})], '2026-09-28'), '2026-09-28').older).toEqual([]);
  });
});

describe('olderGroupHeading', () => {
  it('names the month in plain words', () => {
    expect(olderGroupHeading('2026-09')).toBe('From September, not logged');
  });
});

describe('skippedPeriod', () => {
  it('reports a marker for this month or next that no linked transaction explains', () => {
    expect(skippedPeriod(rec({ handledPeriod: '2026-09' }), [], '2026-09-15')).toBe('2026-09');
    expect(skippedPeriod(rec({ handledPeriod: '2026-10' }), [], '2026-09-30')).toBe('2026-10');
  });

  it('is nothing once that month has ended, or with no marker', () => {
    expect(skippedPeriod(rec({ handledPeriod: '2026-08' }), [], '2026-09-01')).toBeNull();
    expect(skippedPeriod(rec({ handledPeriod: null }), [], '2026-09-01')).toBeNull();
  });

  it('is nothing when the bill was logged from the Due list that month', () => {
    const linked = txn({ recurringId: 'r1', date: '2026-09-28' });
    expect(skippedPeriod(rec({ handledPeriod: '2026-09' }), [linked], '2026-09-30')).toBeNull();
  });

  it('still counts as skipped when only another bill or another month is linked', () => {
    const others = [txn({ recurringId: 'r2' }), txn({ recurringId: 'r1', date: '2026-08-28' })];
    expect(skippedPeriod(rec({ handledPeriod: '2026-09' }), others, '2026-09-30')).toBe('2026-09');
  });
});

describe('dueLabel', () => {
  it('describes each status without counting days late', () => {
    expect(dueLabel({ status: 'today', daysAway: 0, dueDate: '2026-09-28' })).toBe('Due today');
    expect(dueLabel({ status: 'upcoming', daysAway: 1, dueDate: '2026-09-29' })).toBe('Due in 1 day · 29 Sep');
    expect(dueLabel({ status: 'upcoming', daysAway: 3, dueDate: '2026-10-01' })).toBe('Due in 3 days · 1 Oct');
    expect(dueLabel({ status: 'past', daysAway: -1, dueDate: '2026-09-27' })).toBe('Due 27 Sep');
    expect(dueLabel({ status: 'past', daysAway: -40, dueDate: '2026-09-03' })).toBe('Due 3 Sep');
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
