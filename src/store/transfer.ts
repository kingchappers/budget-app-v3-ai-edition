import { pk } from '../api/db';
import type { Item, Store } from './types';

// Push subscriptions are bound to the old host's VAPID keys, so they are never moved.
const PUSH_SUBSCRIPTION_PREFIX = 'PUSHSUB#';

export interface ImportOptions {
  asUser: string;
  replace?: boolean;
}

function isTransferable(item: Item): boolean {
  return !item.SK.startsWith(PUSH_SUBSCRIPTION_PREFIX);
}

export async function exportUser(store: Store, userId: string): Promise<Item[]> {
  const items = await store.query(pk(userId));
  return items.filter(isTransferable);
}

export function toJsonl(items: Item[]): string {
  return items.map(item => `${JSON.stringify(item)}\n`).join('');
}

export function parseJsonl(text: string): Item[] {
  const items: Item[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const lineNumber = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Line ${lineNumber} is not valid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Line ${lineNumber} is not an object`);
    }
    const { PK, SK } = parsed as Record<string, unknown>;
    if (typeof PK !== 'string' || typeof SK !== 'string') {
      throw new Error(`Line ${lineNumber} is missing PK or SK`);
    }
    items.push(parsed as Item);
  });
  return items;
}

export async function importUser(store: Store, items: Item[], options: ImportOptions): Promise<number> {
  if (new Set(items.map(item => item.PK)).size > 1) {
    throw new Error('The file holds more than one user partition');
  }
  if (items.some(item => !item.PK.startsWith('USER#'))) {
    throw new Error('Only USER# partitions can be imported');
  }

  const transferable = items.filter(isTransferable);
  if (transferable.length === 0) {
    throw new Error('The file holds no importable items');
  }

  const target = pk(options.asUser);
  const existing = (await store.query(target, { attributes: ['SK'] })).filter(isTransferable);
  if (existing.length > 0 && !options.replace) {
    throw new Error(`User "${options.asUser}" already has data; pass --replace to overwrite it`);
  }

  for (const item of transferable) {
    await store.put({ ...item, PK: target });
  }
  const imported = new Set(transferable.map(item => item.SK));
  for (const item of existing) {
    if (imported.has(item.SK)) continue;
    await store.delete({ PK: target, SK: item.SK });
  }
  return transferable.length;
}
