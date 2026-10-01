import { shiftMonth, currentYearMonth, formatMonthName, todayIso } from './months';
import { daysInMonth, normaliseTargetToMonth } from './summary';
import { BUCKET_LABELS, bucketKeyFor, type BucketKey } from './categoryGroups';

const SPEND_BUCKET_KEYS: BucketKey[] = ['BILLS', 'SINKING_FUNDS', 'EVERYDAY', 'SAVING_INVESTMENT', 'OTHER'];
import type { Category, CategoryTarget, PotSummary, Transaction } from './types';

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

// A set of months to count, optionally with one month counted only up to a day.
// The cap is how a month still in progress is compared with the same days of another.
export interface Slice {
  months: string[];
  cap: { month: string; day: number } | null;
}

export type Scope = Period | Slice;

function sliceOf(scope: Scope): Slice {
  return Array.isArray(scope) ? { months: monthsInPeriod(scope), cap: null } : scope;
}

function dayOf(date: string): number {
  return Number(date.slice(8, 10));
}

function inSlice(t: Transaction, slice: Slice): boolean {
  if (!slice.months.includes(t.yearMonth)) return false;
  return slice.cap === null || t.yearMonth !== slice.cap.month || dayOf(t.date) <= slice.cap.day;
}

export interface SummaryTotals {
  income: number;
  spent: number;
  saved: number;
  net: number;
}

export function summaryTotals(transactions: Transaction[], scope: Scope): SummaryTotals {
  const slice = sliceOf(scope);
  let income = 0;
  let spent = 0;
  let setAside = 0;
  let takeOut = 0;
  for (const t of transactions) {
    if (!inSlice(t, slice)) continue;
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

function spendByGroup(transactions: Transaction[], categories: Category[], currentScope: Scope, previousScope: Scope): Map<string, GroupTotals> {
  const current = sliceOf(currentScope);
  const previous = sliceOf(previousScope);
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const totals = new Map<string, GroupTotals>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE') continue;
    const category = categoryById.get(t.categoryId);
    // A transaction on a category that no longer exists (a removed default,
    // or one deleted after the fact) still counts toward "Spent" in the
    // summary row, so it must land somewhere here too, rather than vanish
    // and leave the group bars adding up to less than that total.
    const key = category ? bucketKeyFor(category) : 'OTHER';
    const entry = totals.get(key) ?? { current: 0, previous: 0 };
    if (inSlice(t, current)) entry.current += t.amount;
    else if (inSlice(t, previous)) entry.previous += t.amount;
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
  current: Scope,
  previous: Scope,
): GroupBreakdownRow[] {
  const totals = spendByGroup(transactions, categories, current, previous);
  return SPEND_BUCKET_KEYS
    .map(key => {
      const entry = totals.get(key) ?? { current: 0, previous: 0 };
      return { group: key, label: BUCKET_LABELS[key], current: entry.current, previous: entry.previous };
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
  scope: Scope,
): CategorySpend[] {
  const slice = sliceOf(scope);
  const inGroup = categories.filter(c => bucketKeyFor(c) === group);
  const rows = inGroup.map(category => ({
    categoryId: category.categoryId,
    name: category.name,
    spentPence: transactions
      .filter(t => t.type === 'EXPENSE' && t.categoryId === category.categoryId && inSlice(t, slice))
      .reduce((sum, t) => sum + t.amount, 0),
  }));
  if (group === 'OTHER') {
    const knownIds = new Set(categories.map(c => c.categoryId));
    const unknownPence = transactions
      .filter(t => t.type === 'EXPENSE' && !knownIds.has(t.categoryId) && inSlice(t, slice))
      .reduce((sum, t) => sum + t.amount, 0);
    if (unknownPence > 0) rows.push({ categoryId: 'unknown', name: 'Unknown category', spentPence: unknownPence });
  }
  return rows
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
  currentScope: Scope,
  previousScope: Scope,
  limit: number = 3,
): BiggestMovers {
  const current = sliceOf(currentScope);
  const previous = sliceOf(previousScope);
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const totals = new Map<string, GroupTotals>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE') continue;
    const entry = totals.get(t.categoryId) ?? { current: 0, previous: 0 };
    if (inSlice(t, current)) entry.current += t.amount;
    else if (inSlice(t, previous)) entry.previous += t.amount;
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
  monthsWithin: number;
  // The months counted: only finished, tracked ones.
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
    rows.push({
      categoryId: target.categoryId,
      name: category.name,
      monthsOverTarget,
      monthsWithin: months.length - monthsOverTarget,
      monthsInSpan: months.length,
    });
  }
  return rows.sort((a, b) => b.monthsOverTarget - a.monthsOverTarget);
}

// A month with entries on fewer than this share of its days is treated as partly tracked.
export const SPARSE_BELOW = 0.25;

export type TrackingStatus = 'tracked' | 'partly' | 'marked';

export interface MonthCoverage {
  yearMonth: string;
  daysWithEntries: number;
  daysCounted: number;
  share: number;
}

// How much of a month has anything logged. A month still in progress is judged
// on the days so far, so the 5th is not "sparse" just because the month is young.
export function monthCoverage(
  transactions: Transaction[],
  yearMonth: string,
  today: string,
  throughDay: number = Infinity,
): MonthCoverage {
  const inProgress = today.slice(0, 7) === yearMonth;
  const lastDay = Math.min(daysInMonth(yearMonth), throughDay, inProgress ? dayOf(today) : Infinity);
  const daysCounted = yearMonth > today.slice(0, 7) ? 0 : lastDay;
  const days = new Set<string>();
  for (const t of transactions) {
    if (t.yearMonth === yearMonth && dayOf(t.date) <= daysCounted) days.add(t.date);
  }
  return {
    yearMonth,
    daysWithEntries: days.size,
    daysCounted,
    share: daysCounted === 0 ? 0 : days.size / daysCounted,
  };
}

export function trackingStatus(coverage: MonthCoverage, notTracked: readonly string[]): TrackingStatus {
  if (notTracked.includes(coverage.yearMonth)) return 'marked';
  return coverage.share < SPARSE_BELOW ? 'partly' : 'tracked';
}

export interface LeftOut {
  yearMonth: string;
  status: Exclude<TrackingStatus, 'tracked'>;
}

export interface ComparisonPlan {
  current: Slice;
  previous: Slice;
  leftOut: LeftOut[];
  currentLabel: string;
  previousLabel: string;
  // False when every month pair had to be left out.
  comparable: boolean;
}

const SHORT_MONTH_LENGTH = 3;

function monthShort(yearMonth: string): string {
  return formatMonthName(yearMonth).slice(0, SHORT_MONTH_LENGTH);
}

// "Apr–Sep 2026", or "Nov 2025–Jan 2026" across a year end.
export function monthRange(first: string, last: string): string {
  const year = (yearMonth: string) => yearMonth.slice(0, 4);
  if (first === last) return `${monthShort(first)} ${year(first)}`;
  if (year(first) === year(last)) return `${monthShort(first)}–${monthShort(last)} ${year(last)}`;
  return `${monthShort(first)} ${year(first)}–${monthShort(last)} ${year(last)}`;
}

// "Apr–Sep 2026", "September", or for a month cut short, "1–15 Sep".
function describeSlice(slice: Slice): string {
  if (slice.months.length === 0) return '';
  const first = slice.months[0];
  const last = slice.months[slice.months.length - 1];
  if (slice.months.length === 1) {
    return slice.cap ? `1–${slice.cap.day} ${monthShort(first)}` : formatMonthName(first);
  }
  const range = monthRange(first, last);
  return slice.cap ? `${range} (to ${slice.cap.day} ${monthShort(slice.cap.month)})` : range;
}

// Pairs each month of the current period with the same place in the previous one and
// keeps only pairs where both months were tracked, counting a month in progress
// only up to today's date in both. Whatever is left out is named, never silently dropped.
export function planComparison(
  transactions: Transaction[],
  current: Period,
  previous: Period,
  today: string = todayIso(),
  notTracked: readonly string[] = [],
): ComparisonPlan {
  const currentMonths = monthsInPeriod(current);
  const previousMonths = monthsInPeriod(previous);
  const thisMonth = today.slice(0, 7);

  const includedCurrent: string[] = [];
  const includedPrevious: string[] = [];
  const leftOut: LeftOut[] = [];
  let currentCap: Slice['cap'] = null;
  let previousCap: Slice['cap'] = null;

  currentMonths.forEach((currentMonth, index) => {
    const previousMonth = previousMonths[index];
    const inProgress = currentMonth === thisMonth && dayOf(today) < daysInMonth(currentMonth);
    const cap = inProgress ? dayOf(today) : Infinity;

    const currentStatus = trackingStatus(monthCoverage(transactions, currentMonth, today, cap), notTracked);
    const previousStatus = trackingStatus(monthCoverage(transactions, previousMonth, today, cap), notTracked);
    if (currentStatus === 'tracked' && previousStatus === 'tracked') {
      includedCurrent.push(currentMonth);
      includedPrevious.push(previousMonth);
      if (inProgress) {
        currentCap = { month: currentMonth, day: cap };
        previousCap = { month: previousMonth, day: Math.min(cap, daysInMonth(previousMonth)) };
      }
      return;
    }
    if (currentStatus !== 'tracked') leftOut.push({ yearMonth: currentMonth, status: currentStatus });
    if (previousStatus !== 'tracked') leftOut.push({ yearMonth: previousMonth, status: previousStatus });
  });

  const currentSlice: Slice = { months: includedCurrent, cap: currentCap };
  const previousSlice: Slice = { months: includedPrevious, cap: previousCap };
  return {
    current: currentSlice,
    previous: previousSlice,
    leftOut,
    currentLabel: describeSlice(currentSlice),
    previousLabel: describeSlice(previousSlice),
    comparable: includedCurrent.length > 0,
  };
}

// Finished, tracked months: the only ones worth counting against a target.
export function countableMonths(
  transactions: Transaction[],
  months: string[],
  today: string,
  notTracked: readonly string[],
): string[] {
  return months.filter(yearMonth =>
    yearMonth < today.slice(0, 7)
    && trackingStatus(monthCoverage(transactions, yearMonth, today), notTracked) === 'tracked');
}

export interface MonthTargetOutcome {
  yearMonth: string;
  targeted: number;
  spent: number;
}

// Across every category that has a target, what was planned and what was spent.
export function monthTargetOutcome(
  transactions: Transaction[],
  categories: Category[],
  targets: CategoryTarget[],
  yearMonth: string,
): MonthTargetOutcome | null {
  const expenseIds = new Set(categories.filter(c => c.type === 'EXPENSE').map(c => c.categoryId));
  const targeted = targets.filter(t => expenseIds.has(t.categoryId));
  if (targeted.length === 0) return null;
  const targetIds = new Set(targeted.map(t => t.categoryId));
  return {
    yearMonth,
    targeted: targeted.reduce((sum, t) => sum + normaliseTargetToMonth(t.targetAmount, t.period, yearMonth), 0),
    spent: transactions
      .filter(t => t.type === 'EXPENSE' && t.yearMonth === yearMonth && targetIds.has(t.categoryId))
      .reduce((sum, t) => sum + t.amount, 0),
  };
}

export interface PotMilestone {
  categoryId: string;
  name: string;
}

export function reachedPotGoals(pots: PotSummary[], categories: Category[]): PotMilestone[] {
  return pots
    .filter(pot => pot.goalAmount !== null && pot.goalAmount > 0 && pot.balance >= pot.goalAmount)
    .map(pot => ({
      categoryId: pot.categoryId,
      name: categories.find(c => c.categoryId === pot.categoryId)?.name ?? 'Unknown pot',
    }));
}
