function pad(n: number): string {
  return String(n).padStart(2, '0');
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

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function lastDayOfMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function addDaysIso(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return todayIso(new Date(year, month - 1, day + delta));
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
