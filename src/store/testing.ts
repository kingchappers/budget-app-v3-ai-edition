import { setStore } from '.';
import { SqliteStore } from './sqlite';
import type { Store } from './types';

let active: SqliteStore | undefined;

export function useTestStore(): SqliteStore {
  active?.close();
  active = new SqliteStore(':memory:');
  setStore(active);
  return active;
}

export function resetTestStore(): void {
  setStore(undefined);
  active?.close();
  active = undefined;
}

export async function seedUser(
  store: Store,
  userId: string,
  items: Array<{ SK: string } & Record<string, unknown>>,
): Promise<void> {
  for (const item of items) {
    await store.put({ ...item, PK: `USER#${userId}` });
  }
}
