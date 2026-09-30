import type { TrashEntityType, TrashEntry } from './trash';
import type { Account, AccountKind, AccountType, Category, CategoryGroup, CategoryTarget, PotSettingsInput, PotSummary, Recurring, TargetPeriod, Transaction, TransactionType } from './types';

type Request = (endpoint: string, options?: RequestInit) => Promise<unknown>;

export interface TransactionInput {
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
  transactionId?: string;
}

export interface RecurringInput {
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
  leadDays: number;
}

export function createApi(request: Request) {
  return {
    getCategories: async (): Promise<Category[]> => {
      const res = await request('/api/categories') as { categories: Category[] };
      return res.categories;
    },
    createCategory: async (input: { name: string; type: Category['type']; icon: string; group?: CategoryGroup }): Promise<Category> => {
      const res = await request('/api/categories', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { category: Category };
      return res.category;
    },
    updateCategory: async (categoryId: string, name: string): Promise<Category> => {
      const res = await request(`/api/categories/${encodeURIComponent(categoryId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
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
    getTransactionsRange: async (from: string, to: string): Promise<Transaction[]> => {
      const res = await request(`/api/transactions/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) as { transactions: Transaction[] };
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

    getPots: async (asOf: string): Promise<PotSummary[]> => {
      const res = await request(`/api/pots?asOf=${encodeURIComponent(asOf)}`) as { pots: PotSummary[] };
      return res.pots;
    },
    savePot: async (categoryId: string, input: PotSettingsInput): Promise<void> => {
      await request(`/api/pots/${encodeURIComponent(categoryId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },

    getRecurring: async (): Promise<Recurring[]> => {
      const res = await request('/api/recurring') as { recurring: Recurring[] };
      return res.recurring;
    },
    createRecurring: async (input: RecurringInput): Promise<Recurring> => {
      const res = await request('/api/recurring', {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { recurring: Recurring };
      return res.recurring;
    },
    updateRecurring: async (recurringId: string, input: RecurringInput): Promise<Recurring> => {
      const res = await request(`/api/recurring/${encodeURIComponent(recurringId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }) as { recurring: Recurring };
      return res.recurring;
    },
    deleteRecurring: async (recurringId: string): Promise<void> => {
      await request(`/api/recurring/${encodeURIComponent(recurringId)}`, { method: 'DELETE' });
    },
    setRecurringHandled: async (recurringId: string, period: string | null): Promise<Recurring> => {
      const res = await request(`/api/recurring/${encodeURIComponent(recurringId)}/handled`, {
        method: 'POST',
        body: JSON.stringify({ period }),
      }) as { recurring: Recurring };
      return res.recurring;
    },

    getAccounts: async (): Promise<Account[]> => {
      const res = await request('/api/accounts') as { accounts: Account[] };
      return res.accounts;
    },
    createAccount: async (input: { name: string; kind: AccountKind; type: AccountType }): Promise<Account> => {
      const res = await request('/api/accounts', { method: 'POST', body: JSON.stringify(input) }) as { account: Account };
      return res.account;
    },
    updateAccount: async (accountId: string, input: { name: string; type: AccountType }): Promise<Account> => {
      const res = await request(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }) as { account: Account };
      return res.account;
    },
    deleteAccount: async (accountId: string): Promise<void> => {
      await request(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    },
    addBalance: async (accountId: string, input: { date: string; pence: number }): Promise<Account> => {
      const res = await request(`/api/accounts/${encodeURIComponent(accountId)}/balances`, {
        method: 'POST',
        body: JSON.stringify(input),
      }) as { account: Account };
      return res.account;
    },

    getTrash: async (): Promise<TrashEntry[]> => {
      const res = await request('/api/trash') as { items: TrashEntry[] };
      return res.items;
    },
    restoreFromTrash: async (entityType: TrashEntityType, id: string): Promise<void> => {
      await request('/api/trash/restore', {
        method: 'POST',
        body: JSON.stringify({ entityType, id }),
      });
    },
  };
}

export type Api = ReturnType<typeof createApi>;
