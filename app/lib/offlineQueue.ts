import type { TransactionInput } from './api';

export interface QueuedEntry {
  id: string;
  input: TransactionInput;
  queuedAt: string;
  lastError?: string;
}

const DB_NAME = 'offline-transaction-queue';
const STORE_NAME = 'pending';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function enqueue(entry: QueuedEntry): Promise<void> {
  await withStore('readwrite', store => store.put(entry));
}

export async function dequeue(id: string): Promise<void> {
  await withStore('readwrite', store => store.delete(id));
}

export async function listQueue(): Promise<QueuedEntry[]> {
  const entries = await withStore<QueuedEntry[]>('readonly', store => store.getAll());
  return [...entries].sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
}

export async function markQueueEntryError(id: string, message: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const entry = getRequest.result as QueuedEntry | undefined;
        if (!entry) { resolve(); return; }
        const putRequest = store.put({ ...entry, lastError: message });
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  } finally {
    db.close();
  }
}
