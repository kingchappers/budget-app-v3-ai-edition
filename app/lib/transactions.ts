import type { Category, Transaction, TransactionType } from './types';
import { categoryTypesFor } from './transactionTypes';
import { isYearMonth } from './months';

export interface TransactionFilter {
  query: string;
  categoryId: string | null;
  type: TransactionType | null;
}

export const UNTARGETED_FILTER = '__untargeted';

const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface TransactionsParams {
  yearMonth: string | null;
  categoryId: string | null;
}

export function parseTransactionsParams(params: URLSearchParams): TransactionsParams {
  const month = params.get('month');
  const category = params.get('category');
  const yearMonth = month !== null && isYearMonth(month) ? month : null;

  if (category !== null && CATEGORY_ID_PATTERN.test(category)) return { yearMonth, categoryId: category };
  if (params.get('spending') === 'untargeted') return { yearMonth, categoryId: UNTARGETED_FILTER };
  return { yearMonth, categoryId: null };
}

function matchesCategory(t: Transaction, categoryId: string, targetedCategoryIds: ReadonlySet<string>): boolean {
  if (categoryId === UNTARGETED_FILTER) return t.type === 'EXPENSE' && !targetedCategoryIds.has(t.categoryId);
  return t.categoryId === categoryId;
}

export function filterTransactions(
  transactions: Transaction[],
  categories: Category[],
  { query, categoryId, type }: TransactionFilter,
  targetedCategoryIds: ReadonlySet<string> = new Set(),
): Transaction[] {
  const q = query.trim().toLowerCase();
  const nameById = new Map(categories.map(c => [c.categoryId, c.name]));

  return transactions.filter(t => {
    if (categoryId && !matchesCategory(t, categoryId, targetedCategoryIds)) return false;
    if (type && t.type !== type) return false;
    if (q === '') return true;

    const categoryName = (nameById.get(t.categoryId) ?? '').toLowerCase();
    return t.description.toLowerCase().includes(q) || categoryName.includes(q);
  });
}

export function topCategories(
  transactions: Transaction[],
  categories: Category[],
  type: TransactionType,
  limit: number,
): Category[] {
  const categoryTypes = categoryTypesFor(type);
  const counts = new Map<string, number>();
  for (const t of transactions) {
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }

  return categories
    .filter(c => categoryTypes.includes(c.type))
    .sort((a, b) => (counts.get(b.categoryId) ?? 0) - (counts.get(a.categoryId) ?? 0))
    .slice(0, limit);
}
