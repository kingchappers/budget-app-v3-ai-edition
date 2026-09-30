import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { shiftMonth } from '../../app/lib/months';
import { LOOK_BACK_MONTHS } from '../../app/lib/recurring';
import type { Category, Recurring, Transaction } from '../../app/lib/types';
import { docClient, PUSH_INDEX_PK, TABLE, pk, pushIndexSk } from '../api/db';
import { toRecurring } from '../api/recurring';
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

type Item = Record<string, unknown>;

async function queryAll(keyCondition: string, values: Record<string, unknown>, projection?: string): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: values,
      ...(projection ? { ProjectionExpression: projection } : {}),
      ExclusiveStartKey: startKey,
    }));
    items.push(...((result.Items ?? []) as Item[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

// Everyone who has turned reminders on, found with one Query on the index partition.
export async function listSubscribedUsers(): Promise<string[]> {
  const items = await queryAll('PK = :pk', { ':pk': PUSH_INDEX_PK }, 'SK');
  return items.map(item => String(item.SK).replace(/^USER#/, ''));
}

export async function loadSubscriptions(userId: string): Promise<StoredSubscription[]> {
  const items = await queryAll('PK = :pk AND begins_with(SK, :prefix)', { ':pk': pk(userId), ':prefix': 'PUSHSUB#' });
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
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: LOOK_BACK_MONTHS + 2 }, (_, index) => shiftMonth(thisMonth, index - LOOK_BACK_MONTHS));

  const [recurring, categories, ...perMonth] = await Promise.all([
    queryAll('PK = :pk AND begins_with(SK, :prefix)', { ':pk': pk(userId), ':prefix': 'RECUR#' }),
    queryAll('PK = :pk AND begins_with(SK, :prefix)', { ':pk': pk(userId), ':prefix': 'CAT#' }, 'categoryId'),
    ...months.map(month => queryAll('PK = :pk AND begins_with(SK, :prefix)', { ':pk': pk(userId), ':prefix': `TXN#${month}#` })),
  ]);

  return {
    recurring: recurring.map(toRecurring),
    categories: categories.map(item => ({ categoryId: String(item.categoryId) }) as Category),
    transactions: perMonth.flat() as unknown as Transaction[],
  };
}

// Drops a subscription the push service says is gone, and the user from the index once none is left.
export async function removeSubscription(userId: string, sk: string): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: sk } }));
  const remaining = await queryAll('PK = :pk AND begins_with(SK, :prefix)', { ':pk': pk(userId), ':prefix': 'PUSHSUB#' }, 'SK');
  if (remaining.length === 0) {
    await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: PUSH_INDEX_PK, SK: pushIndexSk(userId) } }));
  }
}
