function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
