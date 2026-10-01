import { addDaysIso, daysBetweenIso, formatShortDate, shiftMonth } from './months';
import type { Transaction } from './types';

export const CATCH_UP_DAYS = 31;
export const UNTRACKED_CATEGORY_NAME = 'Untracked';
export const WELCOME_BACK_AFTER_DAYS = 3;
export const WELCOME_BACK_HIDDEN_DAYS = 7;

// The last `count` days ending today, newest first.
export function recentDays(today: string, count: number = CATCH_UP_DAYS): string[] {
  return Array.from({ length: count }, (_, index) => addDaysIso(today, -index));
}

export function entriesPerDay(transactions: Transaction[], days: string[]): Map<string, number> {
  const counts = new Map(days.map(day => [day, 0]));
  for (const t of transactions) {
    const count = counts.get(t.date);
    if (count !== undefined) counts.set(t.date, count + 1);
  }
  return counts;
}

export function daysInRange(start: string, end: string): string[] {
  const length = daysBetweenIso(start, end);
  return length < 0 ? [] : Array.from({ length: length + 1 }, (_, index) => addDaysIso(start, index));
}

export function untrackedNote(start: string, end: string): string {
  if (start === end) return `Untracked spending ${formatShortDate(start)}`;
  return `Untracked spending ${formatShortDate(start)}–${formatShortDate(end)}`;
}

export type LumpSumCheck = { ok: true } | { ok: false; field: 'start' | 'end'; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A lump sum covers a stretch of the past, not years of it.
const MAX_LUMP_SUM_DAYS = 366;

export function checkLumpSumRange(start: string, end: string, today: string): LumpSumCheck {
  if (!ISO_DATE.test(start)) return { ok: false, field: 'start', message: 'Enter the first day, for example 01/09/2026' };
  if (!ISO_DATE.test(end)) return { ok: false, field: 'end', message: 'Enter the last day, for example 15/09/2026' };
  if (end > today) return { ok: false, field: 'end', message: 'The last day cannot be in the future' };
  if (start > end) return { ok: false, field: 'start', message: 'The first day needs to be on or before the last day' };
  if (daysBetweenIso(start, end) >= MAX_LUMP_SUM_DAYS) return { ok: false, field: 'start', message: 'Choose a range of a year or less' };
  return { ok: true };
}

// Whether to offer the calm "welcome back" card: only to someone who has
// logged before, not in the last few days, not on the 1st (a fresh start, not
// a backlog), and not while the user has said "not now".
export function shouldWelcomeBack(newestCreatedAt: string | null, today: string, hiddenUntil: string): boolean {
  if (newestCreatedAt === null) return false;
  const created = newestCreatedAt.slice(0, 10);
  if (!ISO_DATE.test(created)) return false;
  if (today.slice(8, 10) === '01') return false;
  if (hiddenUntil !== '' && today < hiddenUntil) return false;
  return daysBetweenIso(created, today) > WELCOME_BACK_AFTER_DAYS;
}

export function newestCreatedAt(transactions: Transaction[]): string | null {
  let newest: string | null = null;
  for (const t of transactions) {
    if (t.createdAt !== '' && (newest === null || t.createdAt > newest)) newest = t.createdAt;
  }
  return newest;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DayParts {
  weekday: string;
  day: number;
  month: string;
}

export function dayParts(iso: string): DayParts {
  const [year, month, day] = iso.split('-').map(Number);
  return {
    weekday: WEEKDAYS[new Date(year, month - 1, day).getDay()],
    day,
    month: formatShortDate(iso).split(' ')[1],
  };
}

export const FIRST_VISIBLE_DAYS = 7;

export interface LumpSumPreset {
  label: string;
  start: string;
  end: string;
}

// Ready-made stretches for the lump sum, so nobody has to type dates after a bad few weeks.
export function lumpSumPresets(today: string, newestEntryDate: string | null): LumpSumPreset[] {
  const presets: LumpSumPreset[] = [{ label: 'Last 7 days', start: addDaysIso(today, -6), end: today }];
  if (newestEntryDate !== null && daysBetweenIso(newestEntryDate, today) > 1) {
    presets.push({ label: 'Since my last entry', start: addDaysIso(newestEntryDate, 1), end: today });
  }
  const lastMonth = shiftMonth(today.slice(0, 7), -1);
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  presets.push({ label: 'Last month', start: `${lastMonth}-01`, end: addDaysIso(firstOfThisMonth, -1) });
  return presets;
}

// The quiet days between the last entry and today, up to a month, for "start fresh from today".
export function gapDays(newestCreatedDate: string, today: string): string[] {
  const yesterday = addDaysIso(today, -1);
  const from = addDaysIso(newestCreatedDate, 1);
  const earliest = addDaysIso(today, -(CATCH_UP_DAYS - 1));
  return daysInRange(from < earliest ? earliest : from, yesterday);
}
