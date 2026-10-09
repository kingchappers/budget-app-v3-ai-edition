import { shiftMonth } from '../../app/lib/months';
import { LOOK_BACK_MONTHS } from '../../app/lib/recurring';
import type { Category, Recurring, Transaction } from '../../app/lib/types';
import { PUSH_INDEX_PK, pk, pushIndexSk } from '../api/db';
import { toRecurring } from '../api/recurring';
import { getStore } from '../store';
import type { DeliverySettings } from './select';

export interface StoredSubscription {
  sk: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  settings: DeliverySettings;
}

export interface ReminderData {
  recurring: Recurring[];
  categories: Category[];
  transactions: Transaction[];
}

// Everyone who has turned reminders on, found with one query on the index partition.
export async function listSubscribedUsers(): Promise<string[]> {
  const items = await getStore().query(PUSH_INDEX_PK, { attributes: ['SK'] });
  return items.map(item => String(item.SK).replace(/^USER#/, ''));
}

export async function loadSubscriptions(userId: string): Promise<StoredSubscription[]> {
  const items = await getStore().query(pk(userId), { skPrefix: 'PUSHSUB#' });
  return items.map(item => ({
    sk: String(item.SK),
    endpoint: String(item.endpoint),
    p256dh: String(item.p256dh),
    auth: String(item.auth),
    settings: {
      hour: Number(item.hour),
      quietStart: item.quietStart === null || item.quietStart === undefined ? null : Number(item.quietStart),
      quietEnd: item.quietEnd === null || item.quietEnd === undefined ? null : Number(item.quietEnd),
      timeZone: String(item.timeZone),
    },
  }));
}

// What the app's own due list needs: bills, the categories they belong to, and recent entries
// (three months back and the month ahead), so a bill already logged is not asked about again.
export async function loadReminderData(userId: string, today: string): Promise<ReminderData> {
  const store = getStore();
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: LOOK_BACK_MONTHS + 2 }, (_, index) => shiftMonth(thisMonth, index - LOOK_BACK_MONTHS));

  const [recurring, categories, ...perMonth] = await Promise.all([
    store.query(pk(userId), { skPrefix: 'RECUR#' }),
    store.query(pk(userId), { skPrefix: 'CAT#', attributes: ['categoryId'] }),
    ...months.map(month => store.query(pk(userId), { skPrefix: `TXN#${month}#` })),
  ]);

  return {
    recurring: recurring.map(toRecurring),
    categories: categories.map(item => ({ categoryId: String(item.categoryId) }) as Category),
    transactions: perMonth.flat() as unknown as Transaction[],
  };
}

// Drops a subscription the push service says is gone, and the user from the index once none is left.
export async function removeSubscription(userId: string, sk: string): Promise<void> {
  const store = getStore();
  await store.delete({ PK: pk(userId), SK: sk });
  const remaining = await store.query(pk(userId), { skPrefix: 'PUSHSUB#', attributes: ['SK'] });
  if (remaining.length === 0) {
    await store.delete({ PK: PUSH_INDEX_PK, SK: pushIndexSk(userId) });
  }
}
