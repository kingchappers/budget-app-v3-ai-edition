import type { Store } from './types';

export * from './types';

let current: Store | undefined;

export function getStore(): Store {
  if (!current) {
    throw new Error('Store not initialised: call initStore() at startup');
  }
  return current;
}

export function setStore(store: Store | undefined): void {
  current = store;
}
