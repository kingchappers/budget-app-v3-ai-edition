import { describe, expect, it } from 'vitest';
import {
  checkLumpSumRange, dayParts, daysInRange, entriesPerDay, newestCreatedAt, recentDays, shouldWelcomeBack, untrackedNote,
} from '../catchUp';
import type { Transaction } from '../types';

function txn(date: string, createdAt = ''): Transaction {
  return { transactionId: `${date}-${createdAt}`, yearMonth: date.slice(0, 7), amount: 100, type: 'EXPENSE', categoryId: 'c', description: '', date, createdAt };
}

describe('recentDays', () => {
  it('lists the last 31 days, today first', () => {
    const days = recentDays('2026-09-28');
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-09-28');
    expect(days[30]).toBe('2026-08-29');
  });

  it('crosses a year end', () => {
    expect(recentDays('2026-01-02', 4)).toEqual(['2026-01-02', '2026-01-01', '2025-12-31', '2025-12-30']);
  });
});

describe('entriesPerDay', () => {
  it('counts entries for each listed day, with zero for empty days, ignoring days outside the list', () => {
    const days = recentDays('2026-09-28', 3);
    const counts = entriesPerDay([txn('2026-09-28'), txn('2026-09-28'), txn('2026-09-26'), txn('2026-01-01')], days);
    expect([...counts]).toEqual([['2026-09-28', 2], ['2026-09-27', 0], ['2026-09-26', 1]]);
  });
});

describe('daysInRange', () => {
  it('includes both ends, in order', () => {
    expect(daysInRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('is a single day when the ends match and empty when backwards', () => {
    expect(daysInRange('2026-09-01', '2026-09-01')).toEqual(['2026-09-01']);
    expect(daysInRange('2026-09-02', '2026-09-01')).toEqual([]);
  });
});

describe('untrackedNote', () => {
  it('names the range, or the single day', () => {
    expect(untrackedNote('2026-09-01', '2026-09-15')).toBe('Untracked spending 1 Sep–15 Sep');
    expect(untrackedNote('2026-09-01', '2026-09-01')).toBe('Untracked spending 1 Sep');
  });
});

describe('checkLumpSumRange', () => {
  const today = '2026-09-28';

  it('accepts a range in the past, including today', () => {
    expect(checkLumpSumRange('2026-09-01', '2026-09-15', today)).toEqual({ ok: true });
    expect(checkLumpSumRange('2026-09-28', '2026-09-28', today)).toEqual({ ok: true });
  });

  it.each([
    ['a missing start', '', '2026-09-15', 'start'],
    ['a missing end', '2026-09-01', '', 'end'],
    ['an end in the future', '2026-09-01', '2026-09-29', 'end'],
    ['a start after the end', '2026-09-16', '2026-09-15', 'start'],
    ['a range of more than a year', '2025-09-01', '2026-09-15', 'start'],
  ])('rejects %s and points at the field to fix', (_name, start, end, field) => {
    expect(checkLumpSumRange(start, end, today)).toMatchObject({ ok: false, field });
  });

  it('accepts exactly a year', () => {
    expect(checkLumpSumRange('2025-09-29', '2026-09-28', today).ok).toBe(true);
  });
});

describe('shouldWelcomeBack', () => {
  const today = '2026-09-28';

  it('appears once the newest entry was made more than three days ago', () => {
    expect(shouldWelcomeBack('2026-09-24T10:00:00.000Z', today, '')).toBe(true);
    expect(shouldWelcomeBack('2026-09-25T10:00:00.000Z', today, '')).toBe(false);
  });

  it('does not appear for someone who has never logged anything', () => {
    expect(shouldWelcomeBack(null, today, '')).toBe(false);
  });

  it('stays hidden until the day it was hidden to', () => {
    expect(shouldWelcomeBack('2026-09-01T10:00:00.000Z', today, '2026-09-29')).toBe(false);
    expect(shouldWelcomeBack('2026-09-01T10:00:00.000Z', today, '2026-09-28')).toBe(true);
  });

  it('treats the 1st of the month as a fresh start', () => {
    expect(shouldWelcomeBack('2026-09-01T10:00:00.000Z', '2026-10-01', '')).toBe(false);
    expect(shouldWelcomeBack('2026-09-01T10:00:00.000Z', '2026-10-02', '')).toBe(true);
  });

  it('ignores an unreadable creation time', () => {
    expect(shouldWelcomeBack('yesterday', today, '')).toBe(false);
  });
});

describe('newestCreatedAt', () => {
  it('finds the latest creation time, skipping entries with none', () => {
    const list = [txn('2026-09-01', '2026-09-01T09:00:00.000Z'), txn('2026-08-01', '2026-09-20T09:00:00.000Z'), txn('2026-09-05', '')];
    expect(newestCreatedAt(list)).toBe('2026-09-20T09:00:00.000Z');
  });

  it('is null when nothing has a creation time', () => {
    expect(newestCreatedAt([txn('2026-09-05', '')])).toBeNull();
    expect(newestCreatedAt([])).toBeNull();
  });
});

describe('dayParts', () => {
  it('gives the weekday, day and month for a tile', () => {
    expect(dayParts('2026-09-28')).toEqual({ weekday: 'Mon', day: 28, month: 'Sep' });
    expect(dayParts('2026-01-01')).toEqual({ weekday: 'Thu', day: 1, month: 'Jan' });
  });
});
