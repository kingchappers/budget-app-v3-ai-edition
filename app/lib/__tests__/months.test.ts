import { describe, it, expect } from 'vitest';
import { currentYearMonth, shiftMonth, formatMonthLabel, todayIso } from '../months';

describe('currentYearMonth', () => {
  it('formats the given date as YYYY-MM', () => {
    expect(currentYearMonth(new Date(2026, 6, 26))).toBe('2026-07');
  });

  it('zero-pads single digit months', () => {
    expect(currentYearMonth(new Date(2026, 0, 5))).toBe('2026-01');
  });
});

describe('shiftMonth', () => {
  it('moves forward within a year', () => {
    expect(shiftMonth('2026-07', 1)).toBe('2026-08');
  });

  it('moves backward within a year', () => {
    expect(shiftMonth('2026-07', -1)).toBe('2026-06');
  });

  it('rolls over the year boundary forward', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('rolls over the year boundary backward', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('formatMonthLabel', () => {
  it('renders a human readable label', () => {
    expect(formatMonthLabel('2026-07')).toBe('July 2026');
  });
});

describe('todayIso', () => {
  it('formats the given date as YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 6, 5))).toBe('2026-07-05');
  });
});
