import type { Store } from './types';

export * from './types';

let current: Store | undefined;
let pending: Promise<Store> | undefined;

export function getStore(): Store {
  if (!current) {
    throw new Error('Store not initialised: call initStore() at startup');
  }
  return current;
}

export function setStore(store: Store | undefined): void {
  current = store;
  pending = undefined;
}

async function createStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const kind = env.STORE || 'dynamodb';
  if (kind === 'dynamodb') {
    const { DynamoStore } = await import('./dynamo');
    return DynamoStore.fromEnv(env);
  }
  if (kind === 'sqlite') {
    const path = env.SQLITE_PATH;
    if (!path) {
      throw new Error('SQLITE_PATH is required when STORE=sqlite');
    }
    const { SqliteStore } = await import('./sqlite');
    return new SqliteStore(path);
  }
  throw new Error(`Unknown STORE "${kind}": expected "dynamodb" or "sqlite"`);
}

// Loads only the chosen backend, so the Lambda never needs node:sqlite and a container never needs the AWS SDK.
export function initStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  if (current) return Promise.resolve(current);
  pending ??= createStore(env).then(
    store => {
      current = store;
      return store;
    },
    error => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}
