import { shiftMonth, currentYearMonth } from './months';
import { normaliseTargetToMonth } from './summary';
import { groupCategories, bucketKeyFor } from './categoryGroups';
import type { Category, CategoryTarget, Transaction } from './types';

export type Period = [string, string];

export function fetchRangeForAnchor(anchor: string, months: number): { from: string; to: string } {
  return { to: anchor, from: shiftMonth(anchor, -(2 * months - 1)) };
}

export function canGoNewer(anchor: string, now: Date = new Date()): boolean {
  return anchor < currentYearMonth(now);
}

export function monthsInPeriod([from, to]: Period): string[] {
  const months: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

export function splitPeriods(from: string, to: string): { current: Period; previous: Period } {
  const months = monthsInPeriod([from, to]);
  const half = months.length / 2;
  return {
    previous: [months[0], months[half - 1]],
    current: [months[half], months[months.length - 1]],
  };
}

function inPeriod(yearMonth: string, [from, to]: Period): boolean {
  return yearMonth >= from && yearMonth <= to;
}

export interface SummaryTotals {
  income: number;
  spent: number;
  saved: number;
  net: number;
}

export function summaryTotals(transactions: Transaction[], period: Period): SummaryTotals {
  let income = 0;
  let spent = 0;
  let setAside = 0;
  let takeOut = 0;
  for (const t of transactions) {
    if (!inPeriod(t.yearMonth, period)) continue;
    if (t.type === 'INCOME') income += t.amount;
    else if (t.type === 'EXPENSE') spent += t.amount;
    else if (t.type === 'SET_ASIDE') setAside += t.amount;
    else if (t.type === 'TAKE_OUT') takeOut += t.amount;
  }
  const saved = setAside - takeOut;
  return { income, spent, saved, net: income - spent };
}

interface GroupTotals {
  current: number;
  previous: number;
}

function spendByGroup(transactions: Transaction[], categories: Category[], current: Period, previous: Period): Map<string, GroupTotals> {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const totals = new Map<string, GroupTotals>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE') continue;
    const category = categoryById.get(t.categoryId);
    if (!category) continue;
    const key = bucketKeyFor(category);
    const entry = totals.get(key) ?? { current: 0, previous: 0 };
    if (inPeriod(t.yearMonth, current)) entry.current += t.amount;
    else if (inPeriod(t.yearMonth, previous)) entry.previous += t.amount;
    totals.set(key, entry);
  }
  return totals;
}

export interface GroupBreakdownRow {
  group: string;
  label: string;
  current: number;
  previous: number;
}

export function groupBreakdown(
  transactions: Transaction[],
  categories: Category[],
  current: Period,
  previous: Period,
): GroupBreakdownRow[] {
  const totals = spendByGroup(transactions, categories, current, previous);
  return groupCategories(categories)
    .filter(bucket => bucket.key !== 'INCOME' && bucket.key !== 'OTHER')
    .map(bucket => {
      const entry = totals.get(bucket.key) ?? { current: 0, previous: 0 };
      return { group: bucket.key, label: bucket.label, current: entry.current, previous: entry.previous };
    })
    .filter(row => row.current > 0 || row.previous > 0);
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  spentPence: number;
}

export function categoriesInGroup(
  transactions: Transaction[],
  categories: Category[],
  group: string,
  period: Period,
): CategorySpend[] {
  const inGroup = categories.filter(c => bucketKeyFor(c) === group);
  return inGroup
    .map(category => ({
      categoryId: category.categoryId,
      name: category.name,
      spentPence: transactions
        .filter(t => t.type === 'EXPENSE' && t.categoryId === category.categoryId && inPeriod(t.yearMonth, period))
        .reduce((sum, t) => sum + t.amount, 0),
    }))
    .filter(row => row.spentPence > 0)
    .sort((a, b) => b.spentPence - a.spentPence);
}

export interface MonthlyTrendRow {
  yearMonth: string;
  income: number;
  spent: number;
  saved: number;
}

export function monthlyTrend(transactions: Transaction[], months: string[]): MonthlyTrendRow[] {
  return months.map(yearMonth => {
    let income = 0;
    let spent = 0;
    let setAside = 0;
    let takeOut = 0;
    for (const t of transactions) {
      if (t.yearMonth !== yearMonth) continue;
      if (t.type === 'INCOME') income += t.amount;
      else if (t.type === 'EXPENSE') spent += t.amount;
      else if (t.type === 'SET_ASIDE') setAside += t.amount;
      else if (t.type === 'TAKE_OUT') takeOut += t.amount;
    }
    return { yearMonth, income, spent, saved: setAside - takeOut };
  });
}

export interface Mover {
  categoryId: string;
  name: string;
  currentPence: number;
  previousPence: number;
  deltaPence: number;
}

export interface BiggestMovers {
  up: Mover[];
  down: Mover[];
}

export function biggestMovers(
  transactions: Transaction[],
  categories: Category[],
  current: Period,
  previous: Period,
  limit: number = 3,
): BiggestMovers {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const totals = new Map<string, GroupTotals>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE') continue;
    const entry = totals.get(t.categoryId) ?? { current: 0, previous: 0 };
    if (inPeriod(t.yearMonth, current)) entry.current += t.amount;
    else if (inPeriod(t.yearMonth, previous)) entry.previous += t.amount;
    totals.set(t.categoryId, entry);
  }
  const movers: Mover[] = [];
  for (const [categoryId, { current: currentPence, previous: previousPence }] of totals) {
    if (currentPence === 0 && previousPence === 0) continue;
    const category = categoryById.get(categoryId);
    movers.push({ categoryId, name: category?.name ?? 'Unknown category', currentPence, previousPence, deltaPence: currentPence - previousPence });
  }
  const up = movers.filter(m => m.deltaPence > 0).sort((a, b) => b.deltaPence - a.deltaPence).slice(0, limit);
  const down = movers.filter(m => m.deltaPence < 0).sort((a, b) => a.deltaPence - b.deltaPence).slice(0, limit);
  return { up, down };
}

export interface TargetAdherenceRow {
  categoryId: string;
  name: string;
  monthsOverTarget: number;
  monthsInSpan: number;
}

export function targetAdherence(
  transactions: Transaction[],
  categories: Category[],
  targets: CategoryTarget[],
  months: string[],
): TargetAdherenceRow[] {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const rows: TargetAdherenceRow[] = [];
  for (const target of targets) {
    const category = categoryById.get(target.categoryId);
    if (!category || category.type !== 'EXPENSE') continue;
    let monthsOverTarget = 0;
    for (const yearMonth of months) {
      const spent = transactions
        .filter(t => t.type === 'EXPENSE' && t.categoryId === target.categoryId && t.yearMonth === yearMonth)
        .reduce((sum, t) => sum + t.amount, 0);
      if (spent > normaliseTargetToMonth(target.targetAmount, target.period, yearMonth)) monthsOverTarget += 1;
    }
    rows.push({ categoryId: target.categoryId, name: category.name, monthsOverTarget, monthsInSpan: months.length });
  }
  return rows.sort((a, b) => b.monthsOverTarget - a.monthsOverTarget);
}
