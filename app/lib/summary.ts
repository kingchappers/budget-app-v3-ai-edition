import { formatPence } from './money';
import { currentYearMonth, daysLeftInMonth, monthName } from './months';
import type { Category, CategoryGroup, CategoryTarget, TargetPeriod, Transaction } from './types';

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
  group?: CategoryGroup;
}

export interface MonthSummary {
  spending: CategoryProgress[];
  incomeTotal: number;
  recent: Transaction[];
  budgetedTotal: number;
  spentInBudgeted: number;
  spentTotal: number;
  spentUnbudgeted: number;
  leftToSpend: number;
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
    group: category.group,
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
    }
  }

  const budgetedTotal = spending.reduce((sum, p) => sum + p.target, 0);
  const spentInBudgeted = spending.reduce((sum, p) => sum + p.spent, 0);
  const spentTotal = transactions
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const recent = [...transactions]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, recentLimit);

  return {
    spending: spending.sort(byOverThenPercent),
    incomeTotal,
    recent,
    budgetedTotal,
    spentInBudgeted,
    spentTotal,
    spentUnbudgeted: spentTotal - spentInBudgeted,
    leftToSpend: budgetedTotal - spentInBudgeted,
  };
}

function daysToGo(now: Date): string {
  const days = daysLeftInMonth(now);
  return days === 1 ? '1 day to go' : `${days} days to go`;
}

export function leftToSpendSentence(
  summary: Pick<MonthSummary, 'spending' | 'leftToSpend'>,
  yearMonth: string,
  now: Date = new Date(),
): string | null {
  if (summary.spending.length === 0) return null;

  const current = currentYearMonth(now);
  const isOver = summary.leftToSpend < 0;
  const amount = formatPence(Math.abs(summary.leftToSpend));
  const name = monthName(yearMonth, now);

  if (yearMonth === current) {
    return isOver
      ? `${amount} over so far. Nothing needs doing today.`
      : `${amount} left to spend this month · ${daysToGo(now)}`;
  }
  if (isOver) return `${amount} over in ${name}`;
  if (yearMonth < current) return `${amount} left at the end of ${name}`;
  return `${amount} left to spend in ${name}`;
}
