const LEGACY_PREFIX = 'budget.';
const PREFIX = 'hoardwise.';

function legacyKeys(store: Storage): string[] {
  const found: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null && key.startsWith(LEGACY_PREFIX)) found.push(key);
  }
  return found;
}

// Copies first and removes second, so a failed write leaves the old value where it was.
function moveKey(store: Storage, legacyKey: string): void {
  const value = store.getItem(legacyKey);
  const newKey = PREFIX + legacyKey.slice(LEGACY_PREFIX.length);
  if (value !== null && store.getItem(newKey) === null) store.setItem(newKey, value);
  store.removeItem(legacyKey);
}

export function migrateLegacyStorage(store: Storage | null): void {
  if (store === null) return;
  let keys: string[];
  try {
    keys = legacyKeys(store);
  } catch (error) {
    console.error('storage: could not look for settings saved under the old name', error);
    return;
  }
  for (const key of keys) {
    try {
      moveKey(store, key);
    } catch (error) {
      console.error('storage: could not move', key, error);
    }
  }
}

export function migrateLegacyBrowserStorage(): void {
  let store: Storage | null = null;
  try {
    store = window.localStorage;
  } catch (error) {
    console.error('storage: localStorage is unavailable', error);
  }
  migrateLegacyStorage(store);
}
