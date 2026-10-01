import { describe, expect, it } from 'vitest';
import { leftAfterSaveNote } from '../afterSave';
import type { TransactionInput } from '../api';
import type { Category, CategoryTarget, Transaction } from '../types';

const dining: Category = { categoryId: 'dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' };
const monthly: CategoryTarget = { categoryId: 'dining', targetAmount: 10000, period: 'MONTHLY', updatedAt: '' };

function input(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return { amount: 480, type: 'EXPENSE', categoryId: 'dining', description: '', date: '2026-09-20', transactionId: 'new', ...overrides };
}

function spent(amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return { transactionId: `t${amount}`, yearMonth: '2026-09', amount, type: 'EXPENSE', categoryId: 'dining', description: '', date: '2026-09-10', createdAt: '', ...overrides };
}

describe('leftAfterSaveNote', () => {
  it('says what is left in the month once the new entry is counted', () => {
    expect(leftAfterSaveNote(input(), [dining], [monthly], [spent(3000)])).toBe('£65.20 left in Dining this month.');
  });

  it('says how far over, without alarm, when the budget is passed', () => {
    expect(leftAfterSaveNote(input(), [dining], [monthly], [spent(9800)])).toBe('£2.80 over in Dining this month.');
  });

  it('does not count the new entry twice if the month already holds it', () => {
    expect(leftAfterSaveNote(input(), [dining], [monthly], [spent(3000), spent(480, { transactionId: 'new' })])).toBe('£65.20 left in Dining this month.');
  });

  it('ignores other categories, other months and other kinds of entry', () => {
    const others = [spent(5000, { categoryId: 'other' }), spent(5000, { yearMonth: '2026-08' }), spent(5000, { type: 'INCOME' })];
    expect(leftAfterSaveNote(input(), [dining], [monthly], others)).toBe('£95.20 left in Dining this month.');
  });

  it.each([
    ['income', input({ type: 'INCOME' }), [monthly]],
    ['a category with no budget', input(), []],
    ['a weekly budget', input(), [{ ...monthly, period: 'WEEKLY' as const }]],
  ])('says nothing for %s', (_name, entry, targets) => {
    expect(leftAfterSaveNote(entry, [dining], targets, [])).toBeNull();
  });

  it('says nothing when the category is not known yet', () => {
    expect(leftAfterSaveNote(input(), [], [monthly], [])).toBeNull();
  });
});
