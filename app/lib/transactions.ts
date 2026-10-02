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

// The categories offered as chips: the user's pinned ones first, in the order
// they pinned them, then the rest by how often they've been used. Ties keep the
// list's own order, so the result only changes when the history really does.
export function topCategories(
  transactions: Transaction[],
  categories: Category[],
  type: TransactionType,
  limit: number,
  pinnedIds: readonly string[] = [],
): Category[] {
  const categoryTypes = categoryTypesFor(type);
  const eligible = categories.filter(c => categoryTypes.includes(c.type) && !c.archived);
  const byId = new Map(eligible.map(c => [c.categoryId, c]));

  const pinned = [...new Set(pinnedIds)].flatMap(id => byId.get(id) ?? []).slice(0, limit);
  const pinnedSet = new Set(pinned.map(c => c.categoryId));

  const counts = new Map<string, number>();
  for (const t of transactions) {
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  const ranked = eligible
    .filter(c => !pinnedSet.has(c.categoryId))
    .sort((a, b) => (counts.get(b.categoryId) ?? 0) - (counts.get(a.categoryId) ?? 0));

  return [...pinned, ...ranked].slice(0, limit);
}
