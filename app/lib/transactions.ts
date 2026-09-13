import type { Category, Transaction, TransactionType } from './types';

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
