import type { Category, CategoryTarget, TargetPeriod, Transaction } from './types';

export interface CategoryProgress {
  categoryId: string;
  name: string;
  icon: string;
  spent: number;
  target: number;
  rawTarget: number;
  period: TargetPeriod;
  percent: number;
  isOver: boolean;
}

export interface MonthSummary {
  spending: CategoryProgress[];
  saving: CategoryProgress[];
  incomeTotal: number;
  recent: Transaction[];
}

export function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function normaliseTargetToMonth(
  target: number,
  period: TargetPeriod,
  yearMonth: string,
): number {
  if (period === 'MONTHLY') return target;
  return Math.round((target * daysInMonth(yearMonth)) / 7);
}

function toProgress(
  category: Category,
  target: CategoryTarget,
  spent: number,
  yearMonth: string,
): CategoryProgress {
  const normalised = normaliseTargetToMonth(target.targetAmount, target.period, yearMonth);
  const percent = normalised > 0 ? Math.round((spent / normalised) * 100) : 0;
  return {
    categoryId: category.categoryId,
    name: category.name,
    icon: category.icon,
    spent,
    target: normalised,
    rawTarget: target.targetAmount,
    period: target.period,
    percent,
    isOver: normalised > 0 && spent > normalised,
  };
}

function byOverThenPercent(a: CategoryProgress, b: CategoryProgress): number {
  if (a.isOver !== b.isOver) return a.isOver ? -1 : 1;
  return b.percent - a.percent;
}

export function buildMonthSummary(input: {
  transactions: Transaction[];
  categories: Category[];
  targets: CategoryTarget[];
  yearMonth: string;
  recentLimit?: number;
}): MonthSummary {
  const { transactions, categories, targets, yearMonth, recentLimit = 5 } = input;

  const categoryById = new Map(categories.map(c => [c.categoryId, c]));

  const spending: CategoryProgress[] = [];
  const saving: CategoryProgress[] = [];
  let incomeTotal = 0;

  for (const t of transactions) {
    if (t.type === 'INCOME') incomeTotal += t.amount;
  }

  for (const target of targets) {
    const category = categoryById.get(target.categoryId);
    if (!category) continue;

    if (category.type === 'EXPENSE') {
      const spent = transactions
        .filter(t => t.categoryId === category.categoryId && t.type === 'EXPENSE')
        .reduce((sum, t) => sum + t.amount, 0);
      spending.push(toProgress(category, target, spent, yearMonth));
    } else if (category.type === 'INVESTMENT') {
      const net = transactions
        .filter(t => t.categoryId === category.categoryId)
        .reduce((sum, t) => {
          if (t.type === 'INVESTMENT_IN') return sum + t.amount;
          if (t.type === 'INVESTMENT_OUT') return sum - t.amount;
          return sum;
        }, 0);
      saving.push(toProgress(category, target, Math.max(0, net), yearMonth));
    }
  }

  const recent = [...transactions]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, recentLimit);

  return {
    spending: spending.sort(byOverThenPercent),
    saving: saving.sort(byOverThenPercent),
    incomeTotal,
    recent,
  };
}
