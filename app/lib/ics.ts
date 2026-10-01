import { formatPence } from './money';
import { addDaysIso, lastDayOfMonth, todayIso } from './months';
import { frequencyOf, nextOccurrences } from './recurring';
import type { Category, Recurring } from './types';

const LINE_END = '\r\n';
const FOLD_AT_OCTETS = 75;
// How far ahead to look for a bill's next date: a year is the longest gap between occurrences.
const SEARCH_DAYS = 400;
// A reminder lands at 9am on its day, not at midnight.
const REMINDER_HOUR = 9;

// Escapes text for an iCalendar value: backslash first, then the characters that mean something.
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Folds a line at 75 octets with CRLF and a space, never splitting a multi-byte character.
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= FOLD_AT_OCTETS) return line;

  const parts: string[] = [];
  let current = '';
  let octets = 0;
  // The continuation lines begin with a space, which counts toward the limit.
  let limit = FOLD_AT_OCTETS;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      limit = FOLD_AT_OCTETS - 1;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${LINE_END} `);
}

function compactDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function compactStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

// The last day of a month counts when a bill's day is later than the month is long,
// mirroring how the app treats a 31st in a short month.
const LAST_DAY = 'BYMONTHDAY=-1';

interface Rule {
  // Added to the UID for a second event, so each stays stable.
  uidSuffix: string;
  rrule: string;
  // The months this event covers, or null for every month the bill falls in.
  months: number[] | null;
}

// Months in which a bill on this day is sometimes missing, because the month can be shorter than the day.
function isShortMonth(month: number, day: number): boolean {
  const year = 2001;
  const leapYear = 2000;
  const shortest = lastDayOfMonth(`${year}-${String(month).padStart(2, '0')}`);
  const longest = lastDayOfMonth(`${leapYear}-${String(month).padStart(2, '0')}`);
  return Math.min(shortest, longest) < day;
}

function quarterlyMonths(anchorMonth: number): number[] {
  return [0, 1, 2, 3].map(step => ((anchorMonth - 1 + step * 3) % 12) + 1);
}

function splitByLength(months: number[], day: number): Rule[] {
  const plain = months.filter(month => !isShortMonth(month, day));
  const short = months.filter(month => isShortMonth(month, day));
  const rules: Rule[] = [];
  if (plain.length > 0) {
    rules.push({ uidSuffix: '', rrule: `FREQ=YEARLY;BYMONTH=${plain.join(',')};BYMONTHDAY=${day}`, months: plain });
  }
  if (short.length > 0) {
    rules.push({ uidSuffix: plain.length > 0 ? '-end' : '', rrule: `FREQ=YEARLY;BYMONTH=${short.join(',')};${LAST_DAY}`, months: short });
  }
  return rules;
}

function monthlyRules(day: number): Rule[] {
  if (day <= 28) return [{ uidSuffix: '', rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}`, months: null }];
  if (day === 31) return [{ uidSuffix: '', rrule: `FREQ=MONTHLY;${LAST_DAY}`, months: null }];
  return splitByLength([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day);
}

function quarterlyRules(anchor: string): Rule[] {
  const day = dayOf(anchor);
  const months = quarterlyMonths(monthOf(anchor));
  if (day <= 28) return [{ uidSuffix: '', rrule: `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${day}`, months: null }];
  if (day === 31) return [{ uidSuffix: '', rrule: `FREQ=MONTHLY;INTERVAL=3;${LAST_DAY}`, months: null }];
  if (!months.some(month => isShortMonth(month, day))) {
    return [{ uidSuffix: '', rrule: `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${day}`, months: null }];
  }
  return splitByLength(months, day);
}

function yearlyRules(anchor: string): Rule[] {
  const month = monthOf(anchor);
  const day = dayOf(anchor);
  return splitByLength([month], day);
}

function rulesFor(bill: Recurring): Rule[] {
  switch (frequencyOf(bill)) {
    case 'WEEKLY':
      return [{ uidSuffix: '', rrule: 'FREQ=WEEKLY', months: null }];
    case 'FOUR_WEEKLY':
      return [{ uidSuffix: '', rrule: 'FREQ=WEEKLY;INTERVAL=4', months: null }];
    case 'QUARTERLY':
      return bill.anchorDate ? quarterlyRules(bill.anchorDate) : [];
    case 'YEARLY':
      return bill.anchorDate ? yearlyRules(bill.anchorDate) : [];
    default:
      return monthlyRules(bill.dayOfMonth);
  }
}

// A reminder `leadDays` before the day at 9am: start-of-day minus (lead - 1) days and 15 hours.
export function reminderTrigger(leadDays: number): string {
  if (leadDays <= 0) return `PT${REMINDER_HOUR}H`;
  const hoursBack = 24 - REMINDER_HOUR;
  const wholeDays = leadDays - 1;
  return wholeDays === 0 ? `-PT${hoursBack}H` : `-P${wholeDays}DT${hoursBack}H`;
}

function nextDate(bill: Recurring, months: number[] | null, today: string): string | null {
  const dates = nextOccurrences(bill, today, addDaysIso(today, SEARCH_DAYS));
  return dates.find(date => months === null || months.includes(monthOf(date))) ?? null;
}

export interface CalendarInput {
  bills: Recurring[];
  categories: Category[];
  today?: string;
  now?: Date;
}

function billLabel(bill: Recurring, categories: Category[]): string {
  return bill.description || categories.find(c => c.categoryId === bill.categoryId)?.name || 'Bill';
}

function eventLines(bill: Recurring, categories: Category[], rule: Rule, today: string, stamp: string): string[] {
  const start = nextDate(bill, rule.months, today);
  if (start === null) return [];

  const summary = `${billLabel(bill, categories)} ${formatPence(bill.amount)}`;
  return [
    'BEGIN:VEVENT',
    `UID:${bill.recurringId}${rule.uidSuffix}@budget`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(start)}`,
    `RRULE:${rule.rrule}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText('From your Budget app. Download the calendar again after changing your bills.')}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(summary)}`,
    `TRIGGER:${reminderTrigger(bill.leadDays)}`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

// A calendar of the money going out: income is left to the person's own calendar.
export function isCalendarBill(bill: Recurring): boolean {
  return bill.type !== 'INCOME';
}

export function buildBillsCalendar({ bills, categories, today = todayIso(), now = new Date() }: CalendarInput): string {
  const stamp = compactStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Budget//Bills//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Budget bills',
    ...bills.filter(isCalendarBill).flatMap(bill => rulesFor(bill).flatMap(rule => eventLines(bill, categories, rule, today, stamp))),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(LINE_END) + LINE_END;
}

export const CALENDAR_FILENAME = 'budget-bills.ics';
