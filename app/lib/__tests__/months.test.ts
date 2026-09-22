import { describe, it, expect } from 'vitest';
import {
  currentYearMonth, shiftMonth, formatMonthLabel, todayIso, yesterdayIso, dateChoiceFor,
  lastDayOfMonth, addDaysIso, daysBetweenIso, formatShortDate,
} from '../months';

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

describe('yesterdayIso', () => {
  it('returns the previous day', () => {
    expect(yesterdayIso(new Date(2026, 6, 5))).toBe('2026-07-04');
  });

  it('crosses month and year boundaries', () => {
    expect(yesterdayIso(new Date(2026, 6, 1))).toBe('2026-06-30');
    expect(yesterdayIso(new Date(2026, 0, 1))).toBe('2025-12-31');
  });
});

describe('dateChoiceFor', () => {
  const now = new Date(2026, 6, 5);

  it('recognises today', () => {
    expect(dateChoiceFor('2026-07-05', now)).toBe('today');
  });

  it('recognises yesterday', () => {
    expect(dateChoiceFor('2026-07-04', now)).toBe('yesterday');
  });

  it('treats any other date as other', () => {
    expect(dateChoiceFor('2026-06-30', now)).toBe('other');
  });
});

describe('lastDayOfMonth', () => {
  it('handles 31, 30, 28 and leap-year 29 day months', () => {
    expect(lastDayOfMonth('2026-12')).toBe(31);
    expect(lastDayOfMonth('2026-04')).toBe(30);
    expect(lastDayOfMonth('2026-02')).toBe(28);
    expect(lastDayOfMonth('2028-02')).toBe(29);
  });
});

describe('addDaysIso', () => {
  it('moves across month and year boundaries in both directions', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2026-01-01', -3)).toBe('2025-12-29');
    expect(addDaysIso('2026-09-10', 0)).toBe('2026-09-10');
  });
});

describe('daysBetweenIso', () => {
  it('counts whole days, positive when the second date is later', () => {
    expect(daysBetweenIso('2026-09-25', '2026-09-28')).toBe(3);
    expect(daysBetweenIso('2026-09-28', '2026-09-25')).toBe(-3);
    expect(daysBetweenIso('2026-09-28', '2026-09-28')).toBe(0);
  });

  it('is not thrown off by the clocks changing', () => {
    expect(daysBetweenIso('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenIso('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('formatShortDate', () => {
  it('formats as day and abbreviated month', () => {
    expect(formatShortDate('2026-09-28')).toBe('28 Sep');
    expect(formatShortDate('2026-01-05')).toBe('5 Jan');
  });
});
