import { describe, it, expect } from 'vitest';
import { bucketKeyFor, defaultGroupFor, groupCategories, groupsForType, groupItems } from '../categoryGroups';
import type { Category } from '../types';

function cat(categoryId: string, type: Category['type'], group?: string): Category {
  return { categoryId, name: categoryId, type, icon: 'tag', isDefault: false, createdAt: '', group } as Category;
}

describe('groupCategories', () => {
  it('orders buckets Bills, Sinking Funds, Everyday, Saving, Income, Other', () => {
    const buckets = groupCategories([
      cat('inc', 'INCOME'),
      cat('other', 'EXPENSE'),
      cat('save', 'POT', 'SAVING_INVESTMENT'),
      cat('day', 'EXPENSE', 'EVERYDAY'),
      cat('sink', 'EXPENSE', 'SINKING_FUNDS'),
      cat('bill', 'EXPENSE', 'BILLS'),
    ]);
    expect(buckets.map(b => b.label)).toEqual([
      'Bills', 'Sinking Funds', 'Everyday Spending', 'Saving & Investment', 'Income', 'Other',
    ]);
  });

  it('omits empty buckets', () => {
    const buckets = groupCategories([cat('bill', 'EXPENSE', 'BILLS')]);
    expect(buckets.map(b => b.key)).toEqual(['BILLS']);
  });

  it('keeps the input order inside a bucket', () => {
    const buckets = groupCategories([cat('b', 'EXPENSE', 'BILLS'), cat('a', 'EXPENSE', 'BILLS')]);
    expect(buckets[0].items.map(c => c.categoryId)).toEqual(['b', 'a']);
  });

  it('puts a category with no group under Other', () => {
    expect(groupCategories([cat('x', 'EXPENSE')])[0].key).toBe('OTHER');
  });

  it('puts a category with an unknown group under Other instead of dropping it', () => {
    const buckets = groupCategories([cat('x', 'EXPENSE', 'MYSTERY')]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe('OTHER');
  });
});

describe('bucketKeyFor', () => {
  it('ignores any group on an INCOME category', () => {
    expect(bucketKeyFor({ type: 'INCOME', group: 'BILLS' })).toBe('INCOME');
  });
});

describe('groupItems', () => {
  it('buckets arbitrary items by a key function', () => {
    const buckets = groupItems([{ n: 1, g: 'EVERYDAY' as const }, { n: 2, g: 'BILLS' as const }], i => i.g);
    expect(buckets.map(b => b.key)).toEqual(['BILLS', 'EVERYDAY']);
  });
});

describe('defaultGroupFor', () => {
  it('returns null for income, Sinking Funds for pot and Everyday for spending', () => {
    expect(defaultGroupFor('INCOME')).toBeNull();
    expect(defaultGroupFor('POT')).toBe('SINKING_FUNDS');
    expect(defaultGroupFor('EXPENSE')).toBe('EVERYDAY');
  });
});

describe('groupsForType', () => {
  it('offers Bills and Everyday Spending for EXPENSE', () => {
    expect(groupsForType('EXPENSE').map(o => o.value)).toEqual(['BILLS', 'EVERYDAY']);
  });

  it('offers Sinking Funds and Saving & Investment for POT', () => {
    expect(groupsForType('POT').map(o => o.value)).toEqual(['SINKING_FUNDS', 'SAVING_INVESTMENT']);
  });

  it('offers nothing for INCOME', () => {
    expect(groupsForType('INCOME')).toEqual([]);
  });
});
