import { formatPence } from './money';
import { addDaysIso, currentYearMonth, daysLeftInMonth, monthName, startOfWeekIso } from './months';
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
  // Only for a weekly target while viewing the current month: what was spent
  // this week (Monday to Sunday) against the weekly amount.
  week?: { spent: number; target: number };
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

// How far through the month today is, as a whole percentage. Only meaningful
// for the current month, so it is null for any other.
export function monthPacePercent(yearMonth: string, now: Date = new Date()): number | null {
  if (yearMonth !== currentYearMonth(now)) return null;
  return Math.round((now.getDate() / daysInMonth(yearMonth)) * 100);
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

export function targetedExpenseCategoryIds(categories: Category[], targets: CategoryTarget[]): Set<string> {
  const expenseIds = new Set(categories.filter(c => c.type === 'EXPENSE').map(c => c.categoryId));
  return new Set(targets.map(t => t.categoryId).filter(id => expenseIds.has(id)));
}

export function buildMonthSummary(input: {
  transactions: Transaction[];
  categories: Category[];
  targets: CategoryTarget[];
  yearMonth: string;
  recentLimit?: number;
  // Today's date, when viewing the current month. Weekly targets are then
  // measured against this week's spending.
  today?: string;
  // Every transaction dated in this week, including any from the previous
  // month. Falls back to `transactions` when the week sits inside this month.
  weekTransactions?: Transaction[];
}): MonthSummary {
  const { transactions, categories, targets, yearMonth, recentLimit = 5, today, weekTransactions } = input;
  const weekStart = today ? startOfWeekIso(today) : null;
  const weekEnd = weekStart ? addDaysIso(weekStart, 6) : null;
  const weekPool = weekTransactions ?? transactions;

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
      const progress = toProgress(category, target, spent, yearMonth);
      if (target.period === 'WEEKLY' && weekStart && weekEnd) {
        const weekSpent = weekPool
          .filter(t => t.categoryId === category.categoryId && t.type === 'EXPENSE' && t.date >= weekStart && t.date <= weekEnd)
          .reduce((sum, t) => sum + t.amount, 0);
        progress.week = { spent: weekSpent, target: target.targetAmount };
      }
      spending.push(progress);
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
