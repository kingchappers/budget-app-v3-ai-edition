import type { Category, CategoryGroup, CategoryType } from './types';

export type BucketKey = CategoryGroup | 'INCOME' | 'OTHER';

export interface Bucket<T> {
  key: BucketKey;
  label: string;
  items: T[];
}

export const BUCKET_LABELS: Record<BucketKey, string> = {
  BILLS: 'Bills',
  SINKING_FUNDS: 'Sinking Funds',
  EVERYDAY: 'Everyday Spending',
  SAVING_INVESTMENT: 'Saving & Investment',
  INCOME: 'Income',
  OTHER: 'Other',
};

const BUCKET_ORDER: BucketKey[] = ['BILLS', 'SINKING_FUNDS', 'EVERYDAY', 'SAVING_INVESTMENT', 'INCOME', 'OTHER'];

export const GROUP_OPTIONS: { value: CategoryGroup; label: string }[] = [
  { value: 'BILLS', label: BUCKET_LABELS.BILLS },
  { value: 'SINKING_FUNDS', label: BUCKET_LABELS.SINKING_FUNDS },
  { value: 'EVERYDAY', label: BUCKET_LABELS.EVERYDAY },
  { value: 'SAVING_INVESTMENT', label: BUCKET_LABELS.SAVING_INVESTMENT },
];

const GROUPS = new Set<string>(GROUP_OPTIONS.map(option => option.value));

export function groupItems<T>(items: T[], keyOf: (item: T) => BucketKey): Bucket<T>[] {
  return BUCKET_ORDER
    .map(key => ({ key, label: BUCKET_LABELS[key], items: items.filter(item => keyOf(item) === key) }))
    .filter(bucket => bucket.items.length > 0);
}

export function bucketKeyFor(category: { group?: string; type: CategoryType }): BucketKey {
  if (category.type === 'INCOME') return 'INCOME';
  if (category.group && GROUPS.has(category.group)) return category.group as CategoryGroup;
  return 'OTHER';
}

export function groupCategories(categories: Category[]): Bucket<Category>[] {
  return groupItems(categories, bucketKeyFor);
}

export function defaultGroupFor(type: CategoryType): CategoryGroup | null {
  if (type === 'INCOME') return null;
  if (type === 'INVESTMENT') return 'SAVING_INVESTMENT';
  return 'EVERYDAY';
}

export function groupsForType(type: CategoryType): { value: CategoryGroup; label: string }[] {
  if (type === 'INCOME') return [];
  if (type === 'INVESTMENT') return GROUP_OPTIONS.filter(option => option.value === 'SAVING_INVESTMENT');
  return GROUP_OPTIONS.filter(option => option.value !== 'SAVING_INVESTMENT');
}
