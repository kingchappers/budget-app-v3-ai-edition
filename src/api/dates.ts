const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  // `new Date` rolls an out-of-range day/month over into the next one
  // (2026-02-31 silently becomes 2026-03-03) rather than rejecting it, so
  // round-trip through ISO formatting and require it to match verbatim.
  return date.toISOString().slice(0, 10) === value;
}

export function isYearMonth(value: unknown): value is string {
  return typeof value === 'string' && YEAR_MONTH_PATTERN.test(value);
}
