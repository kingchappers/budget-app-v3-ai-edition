import { describe, it, expect } from 'vitest';
import { buildNoteIndex, categoryForNote, normaliseNote } from '../noteMemory';
import type { Category, Transaction } from '../types';

function cat(categoryId: string, type: Category['type'] = 'EXPENSE'): Category {
  return { categoryId, name: categoryId, type, icon: 'x', isDefault: true, createdAt: '' };
}

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 100, type: 'EXPENSE',
    categoryId: 'cat-dining', description: '', date: '2026-09-10', createdAt: '2026-09-10T10:00:00Z', ...over,
  };
}

const categories = [cat('cat-dining'), cat('cat-food'), cat('cat-salary', 'INCOME')];

describe('normaliseNote', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normaliseNote('  Flat   WHITE ')).toBe('flat white');
  });
});

describe('buildNoteIndex', () => {
  it('groups transactions by normalised note, most recent first', () => {
    const older = txn({ transactionId: 'older', description: 'Starbucks', date: '2026-08-01' });
    const newer = txn({ transactionId: 'newer', description: ' starbucks ', date: '2026-09-05' });
    const index = buildNoteIndex([older, newer]);
    expect(index.get('starbucks')?.map(t => t.transactionId)).toEqual(['newer', 'older']);
  });

  it('breaks date ties by createdAt, most recent first', () => {
    const first = txn({ transactionId: 'first', description: 'Tesco', createdAt: '2026-09-10T09:00:00Z' });
    const second = txn({ transactionId: 'second', description: 'Tesco', createdAt: '2026-09-10T18:00:00Z' });
    const index = buildNoteIndex([first, second]);
    expect(index.get('tesco')?.map(t => t.transactionId)).toEqual(['second', 'first']);
  });

  it('skips transactions with no note', () => {
    expect(buildNoteIndex([txn({ description: '' }), txn({ description: '   ' })]).size).toBe(0);
  });
});

describe('categoryForNote', () => {
  it('returns the category of the most recent match', () => {
    const index = buildNoteIndex([
      txn({ transactionId: 'old', description: 'Lunch', categoryId: 'cat-food', date: '2026-08-01' }),
      txn({ transactionId: 'new', description: 'Lunch', categoryId: 'cat-dining', date: '2026-09-01' }),
    ]);
    expect(categoryForNote(index, 'lunch', 'EXPENSE', categories)).toBe('cat-dining');
  });

  it('ignores case and extra spaces in the typed note', () => {
    const index = buildNoteIndex([txn({ description: 'Flat White', categoryId: 'cat-dining' })]);
    expect(categoryForNote(index, '  flat   WHITE ', 'EXPENSE', categories)).toBe('cat-dining');
  });

  it('does not match a partial note', () => {
    const index = buildNoteIndex([txn({ description: 'Starbucks', categoryId: 'cat-dining' })]);
    expect(categoryForNote(index, 'star', 'EXPENSE', categories)).toBeNull();
  });

  it('skips a match whose category type does not fit the chosen type', () => {
    const index = buildNoteIndex([
      txn({ transactionId: 'a', description: 'Refund', categoryId: 'cat-food', date: '2026-08-01' }),
      txn({ transactionId: 'b', description: 'Refund', categoryId: 'cat-salary', type: 'INCOME', date: '2026-09-01' }),
    ]);
    expect(categoryForNote(index, 'refund', 'EXPENSE', categories)).toBe('cat-food');
    expect(categoryForNote(index, 'refund', 'INCOME', categories)).toBe('cat-salary');
  });

  it('returns null when only a wrong-type match exists', () => {
    const index = buildNoteIndex([txn({ description: 'Salary', categoryId: 'cat-salary', type: 'INCOME' })]);
    expect(categoryForNote(index, 'salary', 'EXPENSE', categories)).toBeNull();
  });

  it('skips a category that has since been deleted', () => {
    const index = buildNoteIndex([
      txn({ transactionId: 'old', description: 'Gym', categoryId: 'cat-food', date: '2026-08-01' }),
      txn({ transactionId: 'new', description: 'Gym', categoryId: 'cat-deleted', date: '2026-09-01' }),
    ]);
    expect(categoryForNote(index, 'gym', 'EXPENSE', categories)).toBe('cat-food');
  });

  it('never matches an empty or blank note', () => {
    const index = buildNoteIndex([txn({ description: 'Tesco', categoryId: 'cat-food' })]);
    expect(categoryForNote(index, '', 'EXPENSE', categories)).toBeNull();
    expect(categoryForNote(index, '   ', 'EXPENSE', categories)).toBeNull();
  });

  it('returns null for an unknown note or empty history', () => {
    expect(categoryForNote(buildNoteIndex([]), 'anything', 'EXPENSE', categories)).toBeNull();
  });
});
