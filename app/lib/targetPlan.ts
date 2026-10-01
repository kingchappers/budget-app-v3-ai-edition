import { formatPence } from './money';
import { normaliseTargetToMonth } from './summary';
import type { CategoryTarget } from './types';

export interface TargetPlan {
  planned: number;
  income: number;
  unplanned: number;
}

// Weekly targets count as the month they fall in: a week's amount times the
// month's days over seven, the same way the home page counts them.
export function planTargets(targets: CategoryTarget[], incomeLastMonth: number, yearMonth: string): TargetPlan {
  const planned = targets.reduce((sum, t) => sum + normaliseTargetToMonth(t.targetAmount, t.period, yearMonth), 0);
  return { planned, income: incomeLastMonth, unplanned: incomeLastMonth - planned };
}

export function describePlan({ planned, income, unplanned }: TargetPlan): string {
  if (income <= 0) return `Planned ${formatPence(planned)}`;
  const base = `Planned ${formatPence(planned)} of ${formatPence(income)} last month's income`;
  if (unplanned >= 0) return `${base} · ${formatPence(unplanned)} not yet planned`;
  return `${base} · ${formatPence(-unplanned)} more than that`;
}
