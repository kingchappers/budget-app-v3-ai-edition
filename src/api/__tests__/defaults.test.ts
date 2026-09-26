import { describe, it, expect } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_IDS } from '../defaults';

const namesIn = (group: string): string[] =>
  DEFAULT_CATEGORIES.filter(c => c.group === group).map(c => c.name);

describe('DEFAULT_CATEGORIES', () => {
  it('has 21 categories with unique ids', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(21);
    expect(DEFAULT_CATEGORY_IDS.size).toBe(21);
  });

  it('lists Bills in order', () => {
    expect(namesIn('BILLS')).toEqual(['Council Tax', 'Mortgage', 'Phone and Internet', 'Subscriptions', 'Utilities']);
  });

  it('lists Sinking Funds in order', () => {
    expect(namesIn('SINKING_FUNDS')).toEqual(['Holidays', 'Home maintenance', 'Gifts', 'Insurance']);
  });

  it('lists Everyday Spending in order', () => {
    expect(namesIn('EVERYDAY')).toEqual([
      'Charity', 'Going Out & Entertainment', 'Groceries', 'Health', 'Personal Spending', 'Transport',
    ]);
  });

  it('lists Saving & Investment in order', () => {
    expect(namesIn('SAVING_INVESTMENT')).toEqual(['Emergency fund', 'Investment']);
  });

  it('makes Sinking Funds and Saving & Investment categories POT type and Bills and Everyday EXPENSE', () => {
    for (const c of DEFAULT_CATEGORIES.filter(c => c.group)) {
      const isPotGroup = c.group === 'SAVING_INVESTMENT' || c.group === 'SINKING_FUNDS';
      expect(c.type).toBe(isPotGroup ? 'POT' : 'EXPENSE');
    }
  });

  it('keeps the four income defaults ungrouped and unchanged', () => {
    const income = DEFAULT_CATEGORIES.filter(c => c.type === 'INCOME');
    expect(income.map(c => c.categoryId)).toEqual(['cat-salary', 'cat-freelance', 'cat-rental', 'cat-other-income']);
    expect(income.every(c => c.group === undefined)).toBe(true);
  });

  it('marks every category as a default', () => {
    expect(DEFAULT_CATEGORIES.every(c => c.isDefault)).toBe(true);
  });

  it('does not include Joint Account or the removed investment defaults', () => {
    const names = DEFAULT_CATEGORIES.map(c => c.name);
    for (const removed of ['Joint Account', 'Garden Project', 'Certifications', 'Windows', 'Conference', 'Pets', 'Car maintenance', 'Stocks', 'Crypto', 'Real Estate', 'Other Investments']) {
      expect(names).not.toContain(removed);
    }
  });
});
