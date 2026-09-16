import type {
  BankConnection,
  Category,
  CategoryTarget,
  InboxItem,
  InboxPage,
  SyncStatus,
  TargetPeriod,
  Transaction,
  TransactionType,
} from './types';

type Request = (endpoint: string, options?: RequestInit) => Promise<unknown>;

export interface TransactionInput {
  amount: number;
  type: TransactionType;
  categoryId: string;
  description: string;
  date: string;
}

export interface ConnectBankInput {
  startDate: string;
  connectionId?: string;
}

export type CompleteBankCallbackResult =
  | { status: 'READY'; connection: BankConnection }
  | { status: 'PENDING' };

export interface ConfirmInboxInput {
  type: TransactionType;
  categoryId: string;
  description?: string;
}

type InboxRef = Pick<InboxItem, 'bookingDate' | 'txnKey'>;
const inboxPath = (item: InboxRef, action: 'confirm' | 'ignore') =>
  `/api/inbox/${item.bookingDate}/${encodeURIComponent(item.txnKey)}/${action}`;

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

    connectBank: async (input: ConnectBankInput): Promise<string> => {
      const res = await request('/api/banks/connect', { method: 'POST', body: JSON.stringify(input) }) as { url: string };
      return res.url;
    },
    completeBankCallback: async (state: string): Promise<CompleteBankCallbackResult> => {
      const res = await request('/api/banks/callback', {
        method: 'POST',
        body: JSON.stringify({ state }),
      }) as { connection: BankConnection } | { status: 'PENDING' };
      if ('connection' in res) return { status: 'READY', connection: res.connection };
      return { status: 'PENDING' };
    },
    clearBankAuth: async (state: string): Promise<void> => {
      await request(`/api/banks/auth/${encodeURIComponent(state)}`, { method: 'DELETE' });
    },
    getConnections: async (): Promise<BankConnection[]> => {
      const res = await request('/api/banks/connections') as { connections: BankConnection[] };
      return res.connections;
    },
    disconnectBank: async (connectionId: string): Promise<void> => {
      await request(`/api/banks/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    },
    triggerSync: async (): Promise<void> => {
      await request('/api/sync', { method: 'POST' });
    },
    getSyncStatus: async (): Promise<SyncStatus> => {
      const res = await request('/api/sync/status') as { status: SyncStatus };
      return res.status;
    },
    getInbox: async (cursor?: string): Promise<InboxPage> => {
      const path = cursor ? `/api/inbox?cursor=${encodeURIComponent(cursor)}` : '/api/inbox';
      return await request(path) as InboxPage;
    },
    getInboxCount: async (): Promise<number> => {
      const res = await request('/api/inbox/count') as { count: number };
      return res.count;
    },
    confirmInboxItem: async (item: InboxRef, input: ConfirmInboxInput): Promise<Transaction> => {
      const res = await request(inboxPath(item, 'confirm'), { method: 'POST', body: JSON.stringify(input) }) as { transaction: Transaction };
      return res.transaction;
    },
    ignoreInboxItem: async (item: InboxRef): Promise<void> => {
      await request(inboxPath(item, 'ignore'), { method: 'POST' });
    },
  };
}

export type Api = ReturnType<typeof createApi>;
