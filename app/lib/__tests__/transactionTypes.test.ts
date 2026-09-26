import { describe, it, expect } from 'vitest';
import { categoryTypesFor, formatSignedPence, TYPE_OPTIONS } from '../transactionTypes';

describe('TYPE_OPTIONS', () => {
  it('offers Spend, Income, Set aside and Take out in that order', () => {
    expect(TYPE_OPTIONS.map(option => [option.label, option.value])).toEqual([
      ['Spend', 'EXPENSE'],
      ['Income', 'INCOME'],
      ['Set aside', 'SET_ASIDE'],
      ['Take out', 'TAKE_OUT'],
    ]);
  });
});

describe('categoryTypesFor', () => {
  it.each([
    ['EXPENSE', ['EXPENSE', 'POT']],
    ['INCOME', ['INCOME']],
    ['SET_ASIDE', ['POT']],
    ['TAKE_OUT', ['POT']],
  ] as const)('%s -> %j', (type, expected) => {
    expect(categoryTypesFor(type)).toEqual(expected);
  });
});

describe('formatSignedPence', () => {
  it('shows outgoing types with a minus and incoming types with a plus', () => {
    expect(formatSignedPence('EXPENSE', 480)).toBe('−£4.80');
    expect(formatSignedPence('SET_ASIDE', 10000)).toBe('−£100.00');
    expect(formatSignedPence('INCOME', 240000)).toBe('+£2,400.00');
    expect(formatSignedPence('TAKE_OUT', 5000)).toBe('+£50.00');
  });
});
