import { describe, it, expect } from 'vitest';
import { goalPercent, thisMonthSummary } from '../pots';
import type { PotSummary } from '../types';

function pot(thisMonth: Partial<PotSummary['thisMonth']> = {}): PotSummary {
  return {
    categoryId: 'p', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0, months: [],
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0, ...thisMonth },
  };
}

describe('goalPercent', () => {
  it('is null without a goal', () => {
    expect(goalPercent(5000, null)).toBeNull();
    expect(goalPercent(5000, 0)).toBeNull();
  });

  it('rounds and clamps between 0 and 100', () => {
    expect(goalPercent(80000, 300000)).toBe(27);
    expect(goalPercent(400000, 300000)).toBe(100);
    expect(goalPercent(-500, 300000)).toBe(0);
  });
});

describe('thisMonthSummary', () => {
  it('is null when nothing happened', () => {
    expect(thisMonthSummary(pot())).toBeNull();
  });

  it('joins set aside (including auto), take out and spent with signs', () => {
    expect(thisMonthSummary(pot({ setAside: 3000, autoAdded: 2000, takeOut: 500, spent: 1250 })))
      .toBe('+£50.00 set aside · −£5.00 taken out · −£12.50 spent');
  });

  it('omits the parts that are zero', () => {
    expect(thisMonthSummary(pot({ spent: 2000 }))).toBe('−£20.00 spent');
  });
});
