// Reads one person's budget for the MCP tools. The same reads as the app's API, scoped to userId.
import { DEFAULT_CATEGORIES } from '../api/defaults';
import { queryAll, toSettings } from '../api/pots';
import { toTransaction } from '../api/transactions';
import type { Category, CategoryTarget, PotSettings, Transaction } from '../api/types';

// The same cap as GET /api/transactions/range.
const MAX_SPAN_MONTHS = 24;

export interface Budget {
  categories: Category[];
  transactions: Transaction[];
  targets: CategoryTarget[];
  settings: PotSettings[];
}

export interface BudgetWithHistory extends Budget {
  // Every transaction, for running balances such as pots.
  history: Transaction[];
}

function monthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
}

export function shiftMonth(yearMonth: string, by: number): string {
  const index = monthIndex(yearMonth) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function toTarget(item: Record<string, unknown>): CategoryTarget {
  return {
    categoryId: item.categoryId as string,
    targetAmount: item.targetAmount as number,
    period: item.period as CategoryTarget['period'],
    updatedAt: item.updatedAt as string,
  };
}

export async function loadBudgetWithHistory(
  userId: string,
  months: { from: string; to: string },
): Promise<BudgetWithHistory> {
  if (monthIndex(months.to) - monthIndex(months.from) + 1 > MAX_SPAN_MONTHS) {
    throw new RangeError(`the range must be at most ${MAX_SPAN_MONTHS} months`);
  }
  const [customCategories, targetItems, settingsItems, transactionItems] = await Promise.all([
    queryAll(userId, 'CAT#'),
    queryAll(userId, 'TARGET#'),
    queryAll(userId, 'POT#'),
    queryAll(userId, 'TXN#'),
  ]);
  const history = transactionItems.map(toTransaction);
  return {
    categories: [...DEFAULT_CATEGORIES, ...(customCategories as unknown as Category[])],
    history,
    transactions: history.filter((t) => t.yearMonth >= months.from && t.yearMonth <= months.to),
    targets: targetItems.map(toTarget),
    settings: settingsItems.map(toSettings),
  };
}

export async function loadBudget(userId: string, months: { from: string; to: string }): Promise<Budget> {
  const { history: _history, ...budget } = await loadBudgetWithHistory(userId, months);
  return budget;
}
