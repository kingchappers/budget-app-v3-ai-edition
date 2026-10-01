import { categoryLabel } from './categoryIcons';
import type { Category, CategoryGroup, CategoryType } from './types';

export type BucketKey = CategoryGroup | 'INCOME' | 'OTHER';

export interface Bucket<T> {
  key: BucketKey;
  label: string;
  items: T[];
}

export const BUCKET_LABELS: Record<BucketKey, string> = {
  BILLS: 'Bills',
  SINKING_FUNDS: 'Saving for known costs',
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

export function groupItems<T>(items: T[], keyOf: (item: T) => BucketKey, labelOf?: (item: T) => string): Bucket<T>[] {
  return BUCKET_ORDER
    .map(key => {
      const bucketItems = items.filter(item => keyOf(item) === key);
      if (labelOf) bucketItems.sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' }));
      return { key, label: BUCKET_LABELS[key], items: bucketItems };
    })
    .filter(bucket => bucket.items.length > 0);
}

export function bucketKeyFor(category: { group?: string; type: CategoryType }): BucketKey {
  if (category.type === 'INCOME') return 'INCOME';
  if (category.group && GROUPS.has(category.group)) return category.group as CategoryGroup;
  return 'OTHER';
}

export function groupCategories(categories: Category[]): Bucket<Category>[] {
  return groupItems(categories, bucketKeyFor, c => c.name);
}

export interface CategorySelectOption {
  value: string;
  label: string;
}

export type CategorySelectData = CategorySelectOption[] | { group: string; items: CategorySelectOption[] }[];

// Mantine's <Select> only renders group headers when there's more than one
// group; a single-bucket list (e.g. filtering to one category type) is
// flattened so it doesn't show a redundant lone header.
export function categorySelectData(categories: Category[]): CategorySelectData {
  const toOption = (c: Category): CategorySelectOption => ({ value: c.categoryId, label: categoryLabel(c) });
  const buckets = groupCategories(categories);
  return buckets.length > 1
    ? buckets.map(b => ({ group: b.label, items: b.items.map(toOption) }))
    : categories.map(toOption);
}

export function defaultGroupFor(type: CategoryType): CategoryGroup | null {
  if (type === 'INCOME') return null;
  if (type === 'POT') return 'SINKING_FUNDS';
  return 'EVERYDAY';
}

const GROUPS_BY_TYPE: Record<CategoryType, CategoryGroup[]> = {
  EXPENSE: ['BILLS', 'EVERYDAY'],
  POT: ['SINKING_FUNDS', 'SAVING_INVESTMENT'],
  INCOME: [],
};

export function groupsForType(type: CategoryType): { value: CategoryGroup; label: string }[] {
  return GROUP_OPTIONS.filter(option => GROUPS_BY_TYPE[type].includes(option.value));
}
