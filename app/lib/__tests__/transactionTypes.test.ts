import { describe, it, expect } from 'vitest';
import { categoryTypeFor, formatSignedPence } from '../transactionTypes';

describe('categoryTypeFor', () => {
  it.each([
    ['EXPENSE', 'EXPENSE'],
    ['INCOME', 'INCOME'],
    ['INVESTMENT_IN', 'INVESTMENT'],
    ['INVESTMENT_OUT', 'INVESTMENT'],
  ] as const)('%s → %s', (type, expected) => {
    expect(categoryTypeFor(type)).toBe(expected);
  });
});

describe('formatSignedPence', () => {
  it('shows outgoing types with a minus and incoming types with a plus', () => {
    expect(formatSignedPence('EXPENSE', 480)).toBe('−£4.80');
    expect(formatSignedPence('INVESTMENT_IN', 10000)).toBe('−£100.00');
    expect(formatSignedPence('INCOME', 240000)).toBe('+£2,400.00');
    expect(formatSignedPence('INVESTMENT_OUT', 5000)).toBe('+£50.00');
  });
});
