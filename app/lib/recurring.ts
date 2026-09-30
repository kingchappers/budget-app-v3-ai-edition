import type { RecurringInput } from './api';
import { parsePounds } from './money';
import { addDaysIso, daysBetweenIso, formatMonthName, formatShortDate, lastDayOfMonth, shiftMonth } from './months';
import type { Category, Recurring, Transaction, TransactionType } from './types';

export type DueStatus = 'past' | 'today' | 'upcoming';

export interface DueItem {
  recurring: Recurring;
  period: string;
  dueDate: string;
  status: DueStatus;
  daysAway: number;
  likelyMatches: Transaction[];
}

export interface DueGroup {
  period: string;
  items: DueItem[];
}

export interface GroupedDueItems {
  current: DueItem[];
  older: DueGroup[];
}

export interface ComputeDueInput {
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
  today: string;
}

export const LOOK_BACK_MONTHS = 3;

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dueDateFor(period: string, dayOfMonth: number): string {
  return `${period}-${pad(Math.min(dayOfMonth, lastDayOfMonth(period)))}`;
}

function inPeriod(transaction: Transaction, period: string): boolean {
  return transaction.date.slice(0, 7) === period;
}

export function isHandled(recurring: Recurring, period: string, transactions: Transaction[]): boolean {
  if (recurring.handledPeriod !== null && recurring.handledPeriod >= period) return true;
  return transactions.some(t => inPeriod(t, period) && t.recurringId === recurring.recurringId);
}

function isWithinTenPercent(amount: number, target: number): boolean {
  return Math.abs(amount - target) * 10 <= target;
}

function compareCandidates(target: number): (a: Transaction, b: Transaction) => number {
  return (a, b) => {
    const byDistance = Math.abs(a.amount - target) - Math.abs(b.amount - target);
    if (byDistance !== 0) return byDistance;
    return b.date.localeCompare(a.date);
  };
}

export function likelyMatches(recurring: Recurring, period: string, transactions: Transaction[]): Transaction[] {
  return transactions
    .filter(t =>
      inPeriod(t, period)
      && t.recurringId === undefined
      && t.type === recurring.type
      && t.categoryId === recurring.categoryId
      && isWithinTenPercent(t.amount, recurring.amount))
    .sort(compareCandidates(recurring.amount));
}

function statusFor(daysAway: number): DueStatus {
  if (daysAway > 0) return 'upcoming';
  if (daysAway === 0) return 'today';
  return 'past';
}

function compareDue(a: DueItem, b: DueItem): number {
  if (a.daysAway !== b.daysAway) return a.daysAway - b.daysAway;
  const byNote = a.recurring.description.localeCompare(b.recurring.description);
  if (byNote !== 0) return byNote;
  return a.recurring.recurringId.localeCompare(b.recurring.recurringId);
}

function firstPeriodFor(template: Recurring, thisMonth: string): string {
  const earliest = shiftMonth(thisMonth, -LOOK_BACK_MONTHS);
  const created = template.createdAt.slice(0, 7);
  if (!PERIOD_PATTERN.test(created)) return earliest;
  return created > earliest ? created : earliest;
}

function isVisible(template: Recurring, period: string, dueDate: string, today: string): boolean {
  if (period < today.slice(0, 7)) return true;
  return today >= addDaysIso(dueDate, -template.leadDays);
}

function earliestDue(template: Recurring, transactions: Transaction[], today: string): DueItem | null {
  const thisMonth = today.slice(0, 7);
  const lastPeriod = shiftMonth(thisMonth, 1);

  for (let period = firstPeriodFor(template, thisMonth); period <= lastPeriod; period = shiftMonth(period, 1)) {
    if (isHandled(template, period, transactions)) continue;
    const dueDate = dueDateFor(period, template.dayOfMonth);
    if (!isVisible(template, period, dueDate, today)) return null;

    const daysAway = daysBetweenIso(today, dueDate);
    return {
      recurring: template,
      period,
      dueDate,
      status: statusFor(daysAway),
      daysAway,
      likelyMatches: likelyMatches(template, period, transactions),
    };
  }
  return null;
}

export function computeDueItems({ recurring, categories, transactions, today }: ComputeDueInput): DueItem[] {
  const knownCategories = new Set(categories.map(c => c.categoryId));
  const items: DueItem[] = [];

  for (const template of recurring) {
    if (!knownCategories.has(template.categoryId)) continue;
    const item = earliestDue(template, transactions, today);
    if (item) items.push(item);
  }

  return items.sort(compareDue);
}

export function groupDueItems(items: DueItem[], today: string): GroupedDueItems {
  const thisMonth = today.slice(0, 7);
  const current: DueItem[] = [];
  const byPeriod = new Map<string, DueItem[]>();

  for (const item of items) {
    if (item.period >= thisMonth) {
      current.push(item);
      continue;
    }
    byPeriod.set(item.period, [...(byPeriod.get(item.period) ?? []), item]);
  }

  const older = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, groupItems]) => ({ period, items: groupItems }));
  return { current, older };
}

export function olderGroupHeading(period: string): string {
  return `From ${formatMonthName(period)}, not logged`;
}

export function dueLabel(item: Pick<DueItem, 'status' | 'daysAway' | 'dueDate'>): string {
  if (item.status === 'today') return 'Due today';
  if (item.status === 'past') return `Due ${formatShortDate(item.dueDate)}`;

  const unit = item.daysAway === 1 ? 'day' : 'days';
  return `Due in ${item.daysAway} ${unit} · ${formatShortDate(item.dueDate)}`;
}

export function formatDayOfMonth(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;

  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${day}${suffixes[day % 10] ?? 'th'}`;
}

export interface RecurringFormValues {
  type: TransactionType;
  categoryId: string | null;
  amount: string;
  description: string;
  dayOfMonth: number | string;
  leadDays: number | string;
}

export type RecurringFormErrors = Partial<Record<'amount' | 'category' | 'description' | 'dayOfMonth' | 'leadDays', string>>;

export type RecurringFormResult =
  | { ok: true; value: RecurringInput }
  | { ok: false; errors: RecurringFormErrors };

function toWholeNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function validateRecurringForm(values: RecurringFormValues): RecurringFormResult {
  const errors: RecurringFormErrors = {};

  const amount = parsePounds(values.amount);
  if (!amount.ok) errors.amount = amount.message;
  if (!values.categoryId) errors.category = 'Choose a category';

  const day = toWholeNumber(values.dayOfMonth);
  if (day === null || day < 1 || day > 31) errors.dayOfMonth = 'Enter a day from 1 to 31';

  const leadDays = toWholeNumber(values.leadDays);
  if (leadDays === null || leadDays < 0 || leadDays > 14) errors.leadDays = 'Enter 0 to 14 days';

  const description = values.description.trim();
  if (description.length > 200) errors.description = 'Note is too long';

  if (!amount.ok || !values.categoryId || day === null || leadDays === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      type: values.type,
      categoryId: values.categoryId,
      amount: amount.pence,
      description,
      dayOfMonth: day,
      leadDays,
    },
  };
}
