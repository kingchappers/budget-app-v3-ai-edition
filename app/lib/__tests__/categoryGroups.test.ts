import { describe, it, expect } from 'vitest';
import { bucketKeyFor, categorySelectData, defaultGroupFor, groupCategories, groupsForType, groupItems } from '../categoryGroups';
import type { Category } from '../types';

function cat(categoryId: string, type: Category['type'], group?: string): Category {
  return { categoryId, name: categoryId, type, icon: 'tag', isDefault: false, createdAt: '', group } as Category;
}

describe('groupCategories', () => {
  it('orders buckets Bills, Saving for known costs, Everyday, Saving, Income, Other', () => {
    const buckets = groupCategories([
      cat('inc', 'INCOME'),
      cat('other', 'EXPENSE'),
      cat('save', 'POT', 'SAVING_INVESTMENT'),
      cat('day', 'EXPENSE', 'EVERYDAY'),
      cat('sink', 'EXPENSE', 'SINKING_FUNDS'),
      cat('bill', 'EXPENSE', 'BILLS'),
    ]);
    expect(buckets.map(b => b.label)).toEqual([
      'Bills', 'Saving for known costs', 'Everyday Spending', 'Saving & Investment', 'Income', 'Other',
    ]);
  });

  it('omits empty buckets', () => {
    const buckets = groupCategories([cat('bill', 'EXPENSE', 'BILLS')]);
    expect(buckets.map(b => b.key)).toEqual(['BILLS']);
  });

  it('orders categories alphabetically by name inside a bucket', () => {
    const buckets = groupCategories([cat('b', 'EXPENSE', 'BILLS'), cat('a', 'EXPENSE', 'BILLS')]);
    expect(buckets[0].items.map(c => c.categoryId)).toEqual(['a', 'b']);
  });

  it('sorts case-insensitively', () => {
    const buckets = groupCategories([
      { ...cat('Zebra', 'EXPENSE', 'BILLS'), name: 'Zebra' },
      { ...cat('apple', 'EXPENSE', 'BILLS'), name: 'apple' },
    ]);
    expect(buckets[0].items.map(c => c.name)).toEqual(['apple', 'Zebra']);
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

  it('keeps input order when no labelOf is given', () => {
    const buckets = groupItems(
      [{ n: 'b', g: 'BILLS' as const }, { n: 'a', g: 'BILLS' as const }],
      i => i.g,
    );
    expect(buckets[0].items.map(i => i.n)).toEqual(['b', 'a']);
  });

  it('sorts alphabetically by labelOf when given', () => {
    const buckets = groupItems(
      [{ n: 'b', g: 'BILLS' as const }, { n: 'a', g: 'BILLS' as const }],
      i => i.g,
      i => i.n,
    );
    expect(buckets[0].items.map(i => i.n)).toEqual(['a', 'b']);
  });
});

describe('categorySelectData', () => {
  it('groups options by bucket when more than one bucket is present', () => {
    const data = categorySelectData([cat('bill', 'EXPENSE', 'BILLS'), cat('day', 'EXPENSE', 'EVERYDAY')]);
    expect(data).toEqual([
      { group: 'Bills', items: [{ value: 'bill', label: 'bill' }] },
      { group: 'Everyday Spending', items: [{ value: 'day', label: 'day' }] },
    ]);
  });

  it('flattens to a plain option list when only one bucket is present', () => {
    const data = categorySelectData([cat('bill', 'EXPENSE', 'BILLS'), cat('rent', 'EXPENSE', 'BILLS')]);
    expect(data).toEqual([{ value: 'bill', label: 'bill' }, { value: 'rent', label: 'rent' }]);
  });

  it('prefixes an emoji icon onto the label like categoryLabel does', () => {
    const withEmoji = { ...cat('fun', 'EXPENSE', 'BILLS'), icon: '🎉' };
    const data = categorySelectData([withEmoji]);
    expect(data).toEqual([{ value: 'fun', label: '🎉 fun' }]);
  });
});

describe('defaultGroupFor', () => {
  it('returns null for income, Saving for known costs for pot and Everyday for spending', () => {
    expect(defaultGroupFor('INCOME')).toBeNull();
    expect(defaultGroupFor('POT')).toBe('SINKING_FUNDS');
    expect(defaultGroupFor('EXPENSE')).toBe('EVERYDAY');
  });
});

describe('groupsForType', () => {
  it('offers Bills and Everyday Spending for EXPENSE', () => {
    expect(groupsForType('EXPENSE').map(o => o.value)).toEqual(['BILLS', 'EVERYDAY']);
  });

  it('offers Saving for known costs and Saving & Investment for POT', () => {
    expect(groupsForType('POT').map(o => o.value)).toEqual(['SINKING_FUNDS', 'SAVING_INVESTMENT']);
  });

  it('offers nothing for INCOME', () => {
    expect(groupsForType('INCOME')).toEqual([]);
  });
});
