import type { Category, Transaction, TransactionType } from './types';
import { categoryTypeFor } from './transactionTypes';

export interface TransactionFilter {
  query: string;
  categoryId: string | null;
  type: TransactionType | null;
}

export function filterTransactions(
  transactions: Transaction[],
  categories: Category[],
  { query, categoryId, type }: TransactionFilter,
): Transaction[] {
  const q = query.trim().toLowerCase();
  const nameById = new Map(categories.map(c => [c.categoryId, c.name]));

  return transactions.filter(t => {
    if (categoryId && t.categoryId !== categoryId) return false;
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
  const categoryType = categoryTypeFor(type);
  const counts = new Map<string, number>();
  for (const t of transactions) {
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }

  return categories
    .filter(c => c.type === categoryType)
    .sort((a, b) => (counts.get(b.categoryId) ?? 0) - (counts.get(a.categoryId) ?? 0))
    .slice(0, limit);
}
