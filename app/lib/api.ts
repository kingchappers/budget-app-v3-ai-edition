import type { Category, CategoryTarget, TargetPeriod, Transaction, TransactionType } from './types';

type Request = (endpoint: string, options?: RequestInit) => Promise<unknown>;

export interface TransactionInput {
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
}

export function createApi(request: Request) {
  return {
    getCategories: async (): Promise<Category[]> => {
      const res = await request('/api/categories') as { categories: Category[] };
      return res.categories;
    },
    createCategory: async (input: { name: string; type: Category['type']; icon: string }): Promise<Category> => {
      const res = await request('/api/categories', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { category: Category };
      return res.category;
    },
    deleteCategory: async (categoryId: string): Promise<void> => {
      await request(`/api/categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE' });
    },
    reassignCategory: async (categoryId: string, toCategoryId: string): Promise<number> => {
      const res = await request(`/api/categories/${encodeURIComponent(categoryId)}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ toCategoryId }),
      }) as { reassigned: number };
      return res.reassigned;
    },

    getTransactions: async (yearMonth: string): Promise<Transaction[]> => {
      const [year, month] = yearMonth.split('-');
      const res = await request(`/api/transactions?year=${year}&month=${Number(month)}`) as { transactions: Transaction[] };
      return res.transactions;
    },
    createTransaction: async (input: TransactionInput): Promise<Transaction> => {
      const res = await request('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { transaction: Transaction };
      return res.transaction;
    },
    updateTransaction: async (yearMonth: string, transactionId: string, input: TransactionInput): Promise<Transaction> => {
      const res = await request(`/api/transactions/${yearMonth}/${encodeURIComponent(transactionId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }) as { transaction: Transaction };
      return res.transaction;
    },
    deleteTransaction: async (yearMonth: string, transactionId: string): Promise<void> => {
      await request(`/api/transactions/${yearMonth}/${encodeURIComponent(transactionId)}`, { method: 'DELETE' });
    },

    getTargets: async (): Promise<CategoryTarget[]> => {
      const res = await request('/api/targets') as { targets: CategoryTarget[] };
      return res.targets;
    },
    setTarget: async (categoryId: string, targetAmount: number, period: TargetPeriod): Promise<CategoryTarget> => {
      const res = await request(`/api/targets/${encodeURIComponent(categoryId)}`, {
        method: 'PUT',
        body: JSON.stringify({ targetAmount, period }),
      }) as { target: CategoryTarget };
      return res.target;
    },
    deleteTarget: async (categoryId: string): Promise<void> => {
      await request(`/api/targets/${encodeURIComponent(categoryId)}`, { method: 'DELETE' });
    },
  };
}

export type Api = ReturnType<typeof createApi>;
