import { describe, it, expect } from 'vitest';
import { categoryTypeFor } from '../transactionTypes';

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
