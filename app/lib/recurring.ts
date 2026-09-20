import { addDaysIso, daysBetweenIso, lastDayOfMonth, shiftMonth } from './months';
import { normaliseNote } from './noteMemory';
import type { Category, Recurring, Transaction } from './types';

export type DueStatus = 'upcoming' | 'today' | 'overdue';

export interface DueItem {
  recurring: Recurring;
  period: string;
  dueDate: string;
  status: DueStatus;
  daysAway: number;
}

export interface ComputeDueInput {
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
  today: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dueDateFor(period: string, dayOfMonth: number): string {
  return `${period}-${pad(Math.min(dayOfMonth, lastDayOfMonth(period)))}`;
}

export function isHandled(recurring: Recurring, period: string, transactions: Transaction[]): boolean {
  if (recurring.handledPeriod !== null && recurring.handledPeriod >= period) return true;

  const note = normaliseNote(recurring.description);
  return transactions.some(t =>
    t.date.slice(0, 7) === period
    && t.type === recurring.type
    && t.categoryId === recurring.categoryId
    && (note === '' || normaliseNote(t.description) === note),
  );
}

function statusFor(daysAway: number): DueStatus {
  if (daysAway > 0) return 'upcoming';
  if (daysAway === 0) return 'today';
  return 'overdue';
}

function compareDue(a: DueItem, b: DueItem): number {
  if (a.daysAway !== b.daysAway) return a.daysAway - b.daysAway;
  const byNote = a.recurring.description.localeCompare(b.recurring.description);
  if (byNote !== 0) return byNote;
  return a.recurring.recurringId.localeCompare(b.recurring.recurringId);
}

export function computeDueItems({ recurring, categories, transactions, today }: ComputeDueInput): DueItem[] {
  const thisMonth = today.slice(0, 7);
  const periods = [thisMonth, shiftMonth(thisMonth, 1)];
  const knownCategories = new Set(categories.map(c => c.categoryId));
  const items: DueItem[] = [];

  for (const template of recurring) {
    if (!knownCategories.has(template.categoryId)) continue;

    for (const period of periods) {
      const dueDate = dueDateFor(period, template.dayOfMonth);
      const visibleFrom = addDaysIso(dueDate, -template.leadDays);
      const visibleUntil = `${period}-${pad(lastDayOfMonth(period))}`;
      if (today < visibleFrom || today > visibleUntil) continue;
      if (isHandled(template, period, transactions)) continue;

      const daysAway = daysBetweenIso(today, dueDate);
      items.push({ recurring: template, period, dueDate, status: statusFor(daysAway), daysAway });
      break;
    }
  }

  return items.sort(compareDue);
}

export function dueLabel(item: Pick<DueItem, 'status' | 'daysAway'>): string {
  if (item.status === 'today') return 'Due today';

  const days = Math.abs(item.daysAway);
  const unit = days === 1 ? 'day' : 'days';
  if (item.status === 'upcoming') return `Due in ${days} ${unit}`;
  return `${days} ${unit} overdue`;
}

export function formatDayOfMonth(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;

  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${day}${suffixes[day % 10] ?? 'th'}`;
}
