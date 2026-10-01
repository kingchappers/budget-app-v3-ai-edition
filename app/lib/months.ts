function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value);
}

export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function yesterdayIso(now: Date = new Date()): string {
  return todayIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

export type DateChoice = 'today' | 'yesterday' | 'other';

export function dateChoiceFor(date: string, now: Date = new Date()): DateChoice {
  if (date === todayIso(now)) return 'today';
  if (date === yesterdayIso(now)) return 'yesterday';
  return 'other';
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return `${d.toLocaleString('en-GB', { month: 'long' })} ${year}`;
}

export function formatMonthName(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long' });
}

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function lastDayOfMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function addDaysIso(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return todayIso(new Date(year, month - 1, day + delta));
}

// The Monday of the week containing `iso` (weeks run Monday to Sunday).
export function startOfWeekIso(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const daysSinceMonday = (new Date(year, month - 1, day).getDay() + 6) % 7;
  return addDaysIso(iso, -daysSinceMonday);
}

export function daysBetweenIso(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const millis = Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay);
  return Math.round(millis / 86_400_000);
}

export function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTH_ABBREVIATIONS[month - 1]}`;
}

export function monthName(yearMonth: string, now: Date = new Date()): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const name = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long' });
  return year === now.getFullYear() ? name : `${name} ${year}`;
}

export function monthPhrase(yearMonth: string, now: Date = new Date()): string {
  if (yearMonth === currentYearMonth(now)) return 'this month';
  return `in ${monthName(yearMonth, now)}`;
}

export function daysLeftInMonth(now: Date = new Date()): number {
  return lastDayOfMonth(currentYearMonth(now)) - now.getDate() + 1;
}

const WEEKDAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The friendliest label for a date: Today, Yesterday, then "Mon 28 Sep", with
// the year added only when it isn't the current one. Dates are ISO
// (YYYY-MM-DD) internally; this is only for reading.
export function formatDayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today';
  if (iso === addDaysIso(today, -1)) return 'Yesterday';
  const [year, month, day] = iso.split('-').map(Number);
  const weekday = WEEKDAY_ABBREVIATIONS[new Date(year, month - 1, day).getDay()];
  const label = `${weekday} ${day} ${MONTH_ABBREVIATIONS[month - 1]}`;
  return year === Number(today.slice(0, 4)) ? label : `${label} ${year}`;
}
