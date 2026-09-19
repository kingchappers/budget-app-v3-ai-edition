import { categoryTypeFor } from './transactionTypes';
import type { Category, Transaction, TransactionType } from './types';

export type NoteIndex = Map<string, Transaction[]>;

export function normaliseNote(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, ' ');
}

function newestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date > b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  return 0;
}

export function buildNoteIndex(transactions: Transaction[]): NoteIndex {
  const index: NoteIndex = new Map();
  for (const transaction of transactions) {
    const key = normaliseNote(transaction.description);
    if (key === '') continue;
    const group = index.get(key);
    if (group) {
      group.push(transaction);
    } else {
      index.set(key, [transaction]);
    }
  }
  for (const group of index.values()) group.sort(newestFirst);
  return index;
}

export function categoryForNote(
  index: NoteIndex,
  note: string,
  type: TransactionType,
  categories: Category[],
): string | null {
  const key = normaliseNote(note);
  if (key === '') return null;

  const categoryType = categoryTypeFor(type);
  const usable = new Set(categories.filter(c => c.type === categoryType).map(c => c.categoryId));
  const match = index.get(key)?.find(t => usable.has(t.categoryId));
  return match?.categoryId ?? null;
}
