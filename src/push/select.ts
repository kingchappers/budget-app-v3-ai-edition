import { createHash } from 'crypto';
import { formatPence } from '../../app/lib/money';
import { addDaysIso, formatShortDate, shiftMonth } from '../../app/lib/months';
import { computeDueItems, frequencyOf, type DueItem } from '../../app/lib/recurring';
import type { Category, Recurring, Transaction } from '../../app/lib/types';

export interface DeliverySettings {
  // Hours are 0 to 23 in the device's own time zone.
  hour: number;
  quietStart: number | null;
  quietEnd: number | null;
  timeZone: string;
}

export interface LocalMoment {
  date: string;
  hour: number;
}

// The date and hour it is right now in a person's own time zone.
export function localMoment(now: Date, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string): string => parts.find(item => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

// Quiet hours may run past midnight (22 to 7). The same start and end means none.
export function isQuietHour(hour: number, quietStart: number | null, quietEnd: number | null): boolean {
  if (quietStart === null || quietEnd === null || quietStart === quietEnd) return false;
  return quietStart < quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd;
}

// A reminder chosen for a quiet hour waits until the quiet hours end.
export function sendHour({ hour, quietStart, quietEnd }: DeliverySettings): number {
  return isQuietHour(hour, quietStart, quietEnd) && quietEnd !== null ? quietEnd : hour;
}

export function isTimeToSend(now: Date, settings: DeliverySettings): boolean {
  return localMoment(now, settings.timeZone).hour === sendHour(settings);
}

export interface Reminder {
  recurringId: string;
  period: string;
  title: string;
  body: string;
  // Where the notification opens the app; the service worker adds the chosen action.
  url: string;
  // A later send for the same bill replaces this one rather than stacking beside it.
  topic: string;
}

function label(item: DueItem, categories: Category[]): string {
  const { recurring } = item;
  return recurring.description || categories.find(c => c.categoryId === recurring.categoryId)?.name || 'this bill';
}

// "Rent" reads as "rent" in a sentence, but "TV licence" keeps its capitals.
function inSentence(text: string): string {
  return text.length > 1 && text[1] === text[1].toLowerCase() && text[1] !== text[1].toUpperCase()
    ? text[0].toLowerCase() + text.slice(1)
    : text;
}

// One action, plainly asked. No counts, no overdue wording, no bad news.
export function reminderFor(item: DueItem, categories: Category[]): Reminder {
  const { recurring, period, dueDate, daysAway } = item;
  return {
    recurringId: recurring.recurringId,
    period,
    title: `Add ${inSentence(label(item, categories))} ${formatPence(recurring.amount)}?`,
    body: daysAway === 0 ? 'Due today.' : `Due ${formatShortDate(dueDate)}.`,
    url: `/?due=${encodeURIComponent(recurring.recurringId)}&period=${encodeURIComponent(period)}`,
    topic: createHash('sha256').update(`${recurring.recurringId}:${period}`).digest('base64url').slice(0, 32),
  };
}

export interface ReminderInput {
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
  today: string;
}

// Everything before now counts as dealt with, for the purpose of a reminder. The app's own list offers
// the earliest unhandled occurrence first, so without this an old unlogged month would hide this one's reminder,
// and the old month itself is never something a notification should bring up.
function withOlderOccurrencesSet(aside: Recurring, today: string): Recurring {
  const cutoff = frequencyOf(aside) === 'MONTHLY' ? shiftMonth(today.slice(0, 7), -1) : addDaysIso(today, -1);
  const handled = aside.handledPeriod !== null && aside.handledPeriod > cutoff ? aside.handledPeriod : cutoff;
  return { ...aside, handledPeriod: handled };
}

// A bill is mentioned twice at most: when its warning begins, and on the day. Never while overdue,
// and never for money coming in. Anything already logged or skipped has already dropped out.
export function selectReminders({ recurring, categories, transactions, today }: ReminderInput): Reminder[] {
  return computeDueItems({ recurring: recurring.map(item => withOlderOccurrencesSet(item, today)), categories, transactions, today })
    .filter(item => item.recurring.type !== 'INCOME')
    .filter(item => item.daysAway === 0 || (item.daysAway > 0 && item.daysAway === item.recurring.leadDays))
    .map(item => reminderFor(item, categories));
}
