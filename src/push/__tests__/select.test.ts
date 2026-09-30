import { describe, expect, it } from 'vitest';
import type { Category, Recurring, Transaction } from '../../../app/lib/types';
import {
  isQuietHour, isTimeToSend, localMoment, reminderFor, selectReminders, sendHour, type DeliverySettings,
} from '../select';
import { computeDueItems } from '../../../app/lib/recurring';

function bill(over: Partial<Recurring> = {}): Recurring {
  return {
    recurringId: 'rent-1', type: 'EXPENSE', categoryId: 'cat-housing', amount: 85000, description: 'Rent', dayOfMonth: 14,
    frequency: 'MONTHLY', anchorDate: null, leadDays: 3, handledPeriod: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '', ...over,
  };
}

const categories = [{ categoryId: 'cat-housing', name: 'Housing' }, { categoryId: 'cat-fun', name: 'Fun' }] as Category[];

function select(bills: Recurring[], today: string, transactions: Transaction[] = []) {
  return selectReminders({ recurring: bills, categories, transactions, today });
}

function settings(over: Partial<DeliverySettings> = {}): DeliverySettings {
  return { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London', ...over };
}

describe('localMoment', () => {
  it('gives the date and hour in the person\'s own time zone', () => {
    const now = new Date('2026-10-01T23:30:00Z');
    expect(localMoment(now, 'Europe/London')).toEqual({ date: '2026-10-02', hour: 0 });
    expect(localMoment(now, 'America/New_York')).toEqual({ date: '2026-10-01', hour: 19 });
    expect(localMoment(now, 'Asia/Tokyo')).toEqual({ date: '2026-10-02', hour: 8 });
  });

  it('reports midnight as hour 0, never 24', () => {
    expect(localMoment(new Date('2026-01-15T00:10:00Z'), 'UTC').hour).toBe(0);
  });

  it('follows the clocks going back', () => {
    expect(localMoment(new Date('2026-10-25T00:30:00Z'), 'Europe/London').hour).toBe(1);
    expect(localMoment(new Date('2026-10-25T01:30:00Z'), 'Europe/London').hour).toBe(1);
  });
});

describe('quiet hours', () => {
  it('covers the hours from the start up to, not including, the end', () => {
    expect(isQuietHour(13, 13, 17)).toBe(true);
    expect(isQuietHour(16, 13, 17)).toBe(true);
    expect(isQuietHour(17, 13, 17)).toBe(false);
    expect(isQuietHour(12, 13, 17)).toBe(false);
  });

  it('runs past midnight when the start is after the end', () => {
    expect(isQuietHour(22, 22, 7)).toBe(true);
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(0, 22, 7)).toBe(true);
    expect(isQuietHour(6, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
    expect(isQuietHour(21, 22, 7)).toBe(false);
  });

  it('means none when there are none, or the start and end are the same', () => {
    expect(isQuietHour(3, null, null)).toBe(false);
    expect(isQuietHour(3, 5, 5)).toBe(false);
  });
});

describe('sendHour', () => {
  it('is the chosen hour when it is not a quiet hour', () => {
    expect(sendHour(settings({ hour: 8, quietStart: 22, quietEnd: 7 }))).toBe(8);
  });

  it('waits until the quiet hours end when the chosen hour falls inside them', () => {
    expect(sendHour(settings({ hour: 6, quietStart: 22, quietEnd: 9 }))).toBe(9);
  });
});

describe('isTimeToSend', () => {
  it('is true in the chosen hour of the person\'s own day, in summer time', () => {
    expect(isTimeToSend(new Date('2026-07-01T07:05:00Z'), settings())).toBe(true);
    expect(isTimeToSend(new Date('2026-07-01T08:05:00Z'), settings())).toBe(false);
  });

  it('is true in the chosen hour in winter, when London is on UTC', () => {
    expect(isTimeToSend(new Date('2026-01-15T08:05:00Z'), settings())).toBe(true);
    expect(isTimeToSend(new Date('2026-01-15T07:05:00Z'), settings())).toBe(false);
  });

  it('follows another time zone', () => {
    expect(isTimeToSend(new Date('2026-07-01T12:30:00Z'), settings({ timeZone: 'America/New_York' }))).toBe(true);
  });

  it('holds a reminder chosen for a quiet hour until the quiet hours end', () => {
    const quiet = settings({ hour: 6, quietStart: 22, quietEnd: 9 });
    expect(isTimeToSend(new Date('2026-01-15T06:05:00Z'), quiet)).toBe(false);
    expect(isTimeToSend(new Date('2026-01-15T09:05:00Z'), quiet)).toBe(true);
  });
});

describe('selectReminders', () => {
  it('includes a bill due today', () => {
    expect(select([bill()], '2026-10-14').map(reminder => reminder.recurringId)).toEqual(['rent-1']);
  });

  it('includes a bill on the day its warning begins', () => {
    expect(select([bill({ leadDays: 3 })], '2026-10-11')).toHaveLength(1);
  });

  it('stays quiet on the days between, so a long warning is not a daily nag', () => {
    expect(select([bill({ leadDays: 5 })], '2026-10-12')).toEqual([]);
    expect(select([bill({ leadDays: 5 })], '2026-10-13')).toEqual([]);
  });

  it('stays quiet before the warning begins', () => {
    expect(select([bill({ leadDays: 3 })], '2026-10-10')).toEqual([]);
  });

  it('only mentions a bill with no warning on its day', () => {
    expect(select([bill({ leadDays: 0 })], '2026-10-13')).toEqual([]);
    expect(select([bill({ leadDays: 0 })], '2026-10-14')).toHaveLength(1);
  });

  it('never mentions a bill that is overdue', () => {
    expect(select([bill()], '2026-10-15')).toEqual([]);
    expect(select([bill()], '2026-10-30')).toEqual([]);
  });

  it('leaves out a bill already logged or skipped', () => {
    const logged: Transaction = {
      transactionId: 't1', yearMonth: '2026-10', amount: 85000, type: 'EXPENSE', categoryId: 'cat-housing',
      description: 'Rent', date: '2026-10-13', createdAt: '', recurringId: 'rent-1',
    };
    expect(select([bill()], '2026-10-14', [logged])).toEqual([]);
    expect(select([bill({ handledPeriod: '2026-10' })], '2026-10-14')).toEqual([]);
  });

  it('still asks about this month when an older month was never logged', () => {
    expect(select([bill({ createdAt: '2026-06-01T00:00:00.000Z' })], '2026-10-14').map(reminder => reminder.period)).toEqual(['2026-10']);
  });

  it('never brings up an older occurrence that is still open', () => {
    const reminders = select([bill({ createdAt: '2026-06-01T00:00:00.000Z' })], '2026-10-20');
    expect(reminders).toEqual([]);
  });

  it('does the same for a dated bill: only the occurrence that is due now', () => {
    const weekly = bill({ recurringId: 'cleaner', description: 'Cleaner', frequency: 'WEEKLY', anchorDate: '2026-09-07', dayOfMonth: 7, leadDays: 0, createdAt: '2026-09-01T00:00:00.000Z' });
    expect(select([weekly], '2026-10-12').map(reminder => reminder.period)).toEqual(['2026-10-12']);
  });

  it('keeps a bill skipped for this month quiet', () => {
    expect(select([bill({ handledPeriod: '2026-10' })], '2026-10-14')).toEqual([]);
  });

  it('leaves out money coming in', () => {
    expect(select([bill({ type: 'INCOME', description: 'Salary' })], '2026-10-14')).toEqual([]);
  });

  it('leaves out a bill whose category is gone', () => {
    expect(select([bill({ categoryId: 'deleted' })], '2026-10-14')).toEqual([]);
  });

  it('gives one reminder per bill', () => {
    const bills = [bill(), bill({ recurringId: 'gym-1', description: 'Gym', amount: 3000 })];
    expect(select(bills, '2026-10-14').map(reminder => reminder.recurringId).sort()).toEqual(['gym-1', 'rent-1']);
  });

  it('reminds about a yearly bill when its long warning begins, and on the day', () => {
    const insurance = bill({
      recurringId: 'car-1', description: 'Car insurance', frequency: 'YEARLY', anchorDate: '2026-11-13', dayOfMonth: 13, leadDays: 30,
    });
    expect(select([insurance], '2026-10-14')).toHaveLength(1);
    expect(select([insurance], '2026-10-20')).toEqual([]);
    expect(select([insurance], '2026-11-13')).toHaveLength(1);
  });

  it('agrees with the app\'s own due list about what is due', () => {
    const today = '2026-10-14';
    const fromApp = computeDueItems({ recurring: [bill()], categories, transactions: [], today }).map(item => item.recurring.recurringId);
    expect(select([bill()], today).map(reminder => reminder.recurringId)).toEqual(fromApp);
  });
});

describe('the notification itself', () => {
  function reminder(over: Partial<Recurring> = {}, today = '2026-10-14') {
    return select([bill(over)], today)[0];
  }

  it('asks one plain question about one bill', () => {
    expect(reminder().title).toBe('Add rent £850.00?');
  });

  it('says when it is due, without counting or alarm', () => {
    expect(reminder().body).toBe('Due today.');
    expect(reminder({}, '2026-10-11').body).toBe('Due 14 Oct.');
  });

  it('keeps capitals that are part of the name', () => {
    expect(reminder({ description: 'TV licence', amount: 1900 }).title).toBe('Add TV licence £19.00?');
    expect(reminder({ description: 'Sky' }).title).toBe('Add sky £850.00?');
  });

  it('uses the category when there is no note, and "this bill" when it has neither', () => {
    expect(reminder({ description: '' }).title).toBe('Add housing £850.00?');
    const [item] = computeDueItems({ recurring: [bill({ description: '', createdAt: '2026-10-01T00:00:00.000Z' })], categories, transactions: [], today: '2026-10-14' });
    expect(reminderFor(item, []).title).toBe('Add this bill £850.00?');
  });

  it('never reports bad news, counts what was missed, or uses alarm words', () => {
    const texts = [reminder(), reminder({}, '2026-10-11'), reminder({ description: '' })].flatMap(item => [item.title, item.body]);
    for (const text of texts) {
      expect(text).not.toMatch(/overdue|late|missed|behind|unpaid|still|urgent|don't forget|\bdue \d+ (bills|items)\b/i);
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\b\d+ (bills?|items?|payments?)\b/i);
    }
  });

  it('points at the bill and period it is about, for the deep link', () => {
    expect(reminder().url).toBe('/?due=rent-1&period=2026-10');
  });

  it('encodes a dated period safely in the address', () => {
    const yearly = reminder({ frequency: 'YEARLY', anchorDate: '2026-10-14', dayOfMonth: 14 });
    expect(yearly.url).toBe('/?due=rent-1&period=2026-10-14');
  });

  it('gives the same bill and period the same topic, so a repeat replaces rather than stacks', () => {
    expect(reminder().topic).toBe(reminder().topic);
    expect(reminder().topic).toHaveLength(32);
    expect(reminder({}, '2026-10-11').topic).toBe(reminder().topic);
    expect(reminder({ recurringId: 'other' }).topic).not.toBe(reminder().topic);
  });
});
