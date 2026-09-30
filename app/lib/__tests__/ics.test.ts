import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { addDaysIso } from '../months';
import { buildBillsCalendar, escapeText, foldLine, reminderTrigger } from '../ics';
import { nextOccurrences } from '../recurring';
import type { Category, Recurring, RecurringFrequency } from '../types';

const NOW = new Date('2026-09-30T10:15:30Z');

function bill(over: Partial<Recurring> = {}): Recurring {
  return {
    recurringId: 'bill-1', type: 'EXPENSE', categoryId: 'cat-rent', amount: 85000, description: 'Rent', dayOfMonth: 1,
    frequency: 'MONTHLY', anchorDate: null, leadDays: 3, handledPeriod: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '', ...over,
  };
}

function dated(frequency: RecurringFrequency, anchorDate: string, over: Partial<Recurring> = {}): Recurring {
  return bill({ frequency, anchorDate, dayOfMonth: Number(anchorDate.slice(8, 10)), ...over });
}

const categories: Category[] = [{ categoryId: 'cat-rent', name: 'Housing', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' }];

function build(bills: Recurring[], today = '2026-09-30'): string {
  return buildBillsCalendar({ bills, categories, today, now: NOW });
}

function events(text: string): ICAL.Component[] {
  return new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// Every date the calendar puts an event on between today and the end of the search, as a person's calendar would.
function calendarDates(text: string, from: string, to: string): string[] {
  const dates = new Set<string>();
  for (const component of events(text)) {
    const iterator = new ICAL.Event(component).iterator();
    for (let next = iterator.next(); next; next = iterator.next()) {
      const date = `${next.year}-${pad(next.month)}-${pad(next.day)}`;
      if (date > to) break;
      if (date >= from) dates.add(date);
    }
  }
  return [...dates].sort();
}

function rrules(text: string): string[] {
  return events(text).map(component => (component.getFirstPropertyValue('rrule') as ICAL.Recur).toString());
}

describe('the recurrence rule for each schedule', () => {
  it('repeats weekly', () => {
    expect(rrules(build([dated('WEEKLY', '2026-09-07')]))).toEqual(['FREQ=WEEKLY']);
  });

  it('repeats every four weeks', () => {
    expect(rrules(build([dated('FOUR_WEEKLY', '2026-09-07')]))).toEqual(['FREQ=WEEKLY;INTERVAL=4']);
  });

  it('repeats monthly on the day of the month', () => {
    expect(rrules(build([bill({ dayOfMonth: 14 })]))).toEqual(['FREQ=MONTHLY;BYMONTHDAY=14']);
  });

  it('treats a bill with no frequency as monthly', () => {
    expect(rrules(build([bill({ dayOfMonth: 14, frequency: undefined })]))).toEqual(['FREQ=MONTHLY;BYMONTHDAY=14']);
  });

  it('repeats every three months', () => {
    expect(rrules(build([dated('QUARTERLY', '2026-03-14')]))).toEqual(['FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=14']);
  });

  it('repeats yearly in its month', () => {
    expect(rrules(build([dated('YEARLY', '2027-03-14')]))).toEqual(['FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14']);
  });
});

describe('the dates match the ones the app would show', () => {
  const cases: [string, Recurring][] = [
    ['weekly', dated('WEEKLY', '2026-09-07')],
    ['weekly, anchored in the future', dated('WEEKLY', '2027-01-04')],
    ['every four weeks', dated('FOUR_WEEKLY', '2026-09-07')],
    ['monthly on the 1st', bill({ dayOfMonth: 1 })],
    ['monthly on the 14th', bill({ dayOfMonth: 14 })],
    ['monthly on the 28th', bill({ dayOfMonth: 28 })],
    ['monthly on the 29th', bill({ dayOfMonth: 29 })],
    ['monthly on the 30th', bill({ dayOfMonth: 30 })],
    ['monthly on the 31st', bill({ dayOfMonth: 31 })],
    ['quarterly on the 14th', dated('QUARTERLY', '2026-03-14')],
    ['quarterly on the 31st from January', dated('QUARTERLY', '2026-01-31')],
    ['quarterly on the 31st from February', dated('QUARTERLY', '2026-02-28')],
    ['quarterly on the 30th from November, through February', dated('QUARTERLY', '2025-11-30')],
    ['quarterly on the 29th from May, through February', dated('QUARTERLY', '2026-05-29')],
    ['quarterly on the 30th from January, never short', dated('QUARTERLY', '2026-01-30')],
    ['yearly on 14 March', dated('YEARLY', '2027-03-14')],
    ['yearly on 31 January', dated('YEARLY', '2027-01-31')],
    ['yearly on 29 February', dated('YEARLY', '2024-02-29')],
    ['yearly on 30 April', dated('YEARLY', '2026-04-30')],
  ];

  it.each(cases)('%s', (_name, item) => {
    for (const today of ['2026-09-30', '2027-12-15']) {
      const to = addDaysIso(today, 400);
      const text = build([item], today);
      expect(calendarDates(text, today, to)).toEqual(nextOccurrences(item, today, to));
    }
  });

  it('puts a bill on the 31st on the last day of every month, in a single event', () => {
    const text = build([bill({ dayOfMonth: 31 })], '2027-01-15');
    expect(events(text)).toHaveLength(1);
    expect(rrules(text)).toEqual(['FREQ=MONTHLY;BYMONTHDAY=-1']);
    expect(calendarDates(text, '2027-01-15', '2027-06-30')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  });

  it('lands 29 February on the 28th in a year that is not a leap year, and the 29th in one that is', () => {
    const text = build([dated('YEARLY', '2024-02-29')], '2027-06-01');
    expect(calendarDates(text, '2027-06-01', '2029-12-31')).toEqual(['2028-02-29', '2029-02-28']);
  });

  it('splits a bill on the 30th into two events, so only February takes the last day', () => {
    const text = build([bill({ dayOfMonth: 30 })], '2027-01-15');
    const uids = events(text).map(component => component.getFirstPropertyValue('uid'));
    expect(uids).toEqual(['bill-1@budget', 'bill-1-end@budget']);
    expect(calendarDates(text, '2027-01-15', '2027-04-30')).toEqual(['2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30']);
  });

  it('starts each event on the next date the bill falls due, as an all-day event', () => {
    const text = build([bill({ dayOfMonth: 14 })], '2026-09-30');
    const start = events(text)[0].getFirstProperty('dtstart');
    expect(start?.type).toBe('date');
    expect((start?.getFirstValue() as ICAL.Time).toString()).toBe('2026-10-14');
  });

  it('includes today itself if the bill falls due today', () => {
    const text = build([bill({ dayOfMonth: 30 })], '2026-09-30');
    expect((events(text)[0].getFirstPropertyValue('dtstart') as ICAL.Time).toString()).toBe('2026-09-30');
  });
});

describe('what goes in the calendar', () => {
  it('has one event per bill, named with its amount', () => {
    const text = build([bill({ description: 'Rent' }), bill({ recurringId: 'bill-2', description: 'Broadband', amount: 3299 })]);
    expect(events(text).map(component => component.getFirstPropertyValue('summary'))).toEqual(['Rent £850.00', 'Broadband £32.99']);
  });

  it('names a bill with no note after its category, or just Bill', () => {
    const text = build([bill({ description: '' }), bill({ recurringId: 'bill-2', description: '', categoryId: 'gone' })]);
    expect(events(text).map(component => component.getFirstPropertyValue('summary'))).toEqual(['Housing £850.00', 'Bill £850.00']);
  });

  it('leaves income out, since this is a calendar of money going out', () => {
    const text = build([bill({ description: 'Salary', type: 'INCOME' }), bill({ recurringId: 'bill-2', description: 'Rent' })]);
    expect(events(text)).toHaveLength(1);
  });

  it('is still a valid, empty calendar with no bills', () => {
    const text = build([]);
    const calendar = new ICAL.Component(ICAL.parse(text));
    expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
    expect(calendar.getAllSubcomponents('vevent')).toHaveLength(0);
  });

  it('skips a dated bill that has lost its date instead of failing', () => {
    const text = build([bill({ frequency: 'YEARLY', anchorDate: null }), bill({ recurringId: 'bill-2' })]);
    expect(events(text)).toHaveLength(1);
  });

  it('is a well-formed calendar a parser accepts', () => {
    const calendar = new ICAL.Component(ICAL.parse(build([bill(), dated('YEARLY', '2027-03-14', { recurringId: 'bill-3' })])));
    expect(calendar.name).toBe('vcalendar');
    expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
    expect(calendar.getFirstPropertyValue('prodid')).toBe('-//Budget//Bills//EN');
    expect(calendar.getAllSubcomponents('vevent')).toHaveLength(2);
  });

  it('does not block the time on a calendar, since a bill is not a meeting', () => {
    expect(events(build([bill()]))[0].getFirstPropertyValue('transp')).toBe('TRANSPARENT');
  });

  it('stamps each event with the time it was made, in UTC', () => {
    expect(build([bill()])).toContain('DTSTAMP:20260930T101530Z');
  });
});

describe('stable identifiers', () => {
  it('uses the bill id, so downloading again updates events rather than adding copies', () => {
    const first = build([bill({ recurringId: 'abc-123' })]);
    const later = buildBillsCalendar({
      bills: [bill({ recurringId: 'abc-123', amount: 90000 })], categories, today: '2027-02-01', now: new Date('2027-02-01T08:00:00Z'),
    });
    expect(events(first)[0].getFirstPropertyValue('uid')).toBe('abc-123@budget');
    expect(events(later)[0].getFirstPropertyValue('uid')).toBe('abc-123@budget');
  });

  it('gives every event its own identifier', () => {
    const text = build([bill({ recurringId: 'a', dayOfMonth: 30 }), bill({ recurringId: 'b' })]);
    const uids = events(text).map(component => component.getFirstPropertyValue('uid'));
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe('the reminder', () => {
  function trigger(leadDays: number): string {
    const alarm = events(build([bill({ leadDays })]))[0].getFirstSubcomponent('valarm') as ICAL.Component;
    return String(alarm.getFirstPropertyValue('trigger'));
  }

  it('has exactly one reminder, shown on the screen', () => {
    const event = events(build([bill()]))[0];
    const alarms = event.getAllSubcomponents('valarm');
    expect(alarms).toHaveLength(1);
    expect(alarms[0].getFirstPropertyValue('action')).toBe('DISPLAY');
    expect(alarms[0].getFirstPropertyValue('description')).toBe('Rent £850.00');
  });

  it.each([
    [0, 'PT9H'],
    [1, '-PT15H'],
    [3, '-P2DT15H'],
    [30, '-P29DT15H'],
    [60, '-P59DT15H'],
  ])('with %i days of warning, goes off at 9am that many days before (%s)', (leadDays, expected) => {
    expect(trigger(leadDays)).toBe(expected);
    expect(reminderTrigger(leadDays)).toBe(expected);
  });

  it.each([1, 3, 14, 30, 60])('works out to 9am, %i days before the day, counted from midnight', leadDays => {
    const seconds = ICAL.Duration.fromString(trigger(leadDays)).toSeconds();
    expect(seconds).toBe(-(leadDays * 86400 - 9 * 3600));
  });

  it('goes off at 9am on the day itself with no warning', () => {
    expect(ICAL.Duration.fromString(trigger(0)).toSeconds()).toBe(9 * 3600);
  });
});

describe('text and line format', () => {
  it('escapes backslashes, semicolons, commas and new lines so they stay text', () => {
    expect(escapeText('Rent, flat; 2 \\ floor\nnotes')).toBe('Rent\\, flat\\; 2 \\\\ floor\\nnotes');
  });

  it('escapes the backslash first, so it is not doubled twice', () => {
    expect(escapeText('a\\;b')).toBe('a\\\\\\;b');
  });

  it('carries awkward text through a parser unchanged', () => {
    const description = 'Flat, 2nd floor; "rent" \\ service';
    const text = build([bill({ description })]);
    expect(events(text)[0].getFirstPropertyValue('summary')).toBe(`${description} £850.00`);
  });

  it('ends every line with CRLF and never a bare line feed', () => {
    const text = build([bill(), dated('YEARLY', '2027-03-14', { recurringId: 'b', description: 'x'.repeat(200) })]);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('keeps every physical line to 75 octets, folding with a space', () => {
    const text = build([bill({ description: 'y'.repeat(300) })]);
    const encoder = new TextEncoder();
    const lines = text.split('\r\n').filter(line => line !== '');
    expect(lines.every(line => encoder.encode(line).length <= 75)).toBe(true);
    expect(lines.filter(line => line.startsWith(' ')).length).toBeGreaterThan(0);
  });

  it('gives the original text back when the folds are undone', () => {
    const description = 'z'.repeat(300);
    const text = build([bill({ description })]);
    expect(events(text)[0].getFirstPropertyValue('summary')).toBe(`${description} £850.00`);
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Rent')).toBe('SUMMARY:Rent');
  });

  it('leaves a line of exactly 75 octets alone, and folds one of 76', () => {
    expect(foldLine('a'.repeat(75))).toBe('a'.repeat(75));
    expect(foldLine('a'.repeat(76))).toBe(`${'a'.repeat(75)}\r\n a`);
  });

  it('counts octets, not characters, and never splits a multi-byte character', () => {
    const line = `SUMMARY:${'£'.repeat(100)}`;
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    const encoder = new TextEncoder();

    expect(physical.every(part => encoder.encode(part).length <= 75)).toBe(true);
    expect(physical.join('').replace(/ /g, '')).toBe(line);
    expect(folded).not.toContain('�');
  });

  it('keeps continuation lines within the limit, counting their leading space', () => {
    const folded = foldLine('b'.repeat(400));
    const physical = folded.split('\r\n');
    physical.slice(1).forEach(part => {
      expect(part.startsWith(' ')).toBe(true);
      expect(part.length).toBeLessThanOrEqual(75);
    });
  });
});
