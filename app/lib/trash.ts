import { NAMES } from './glossary';
import { formatPence } from './money';
import type { Account, Category, Transaction } from './types';

export type TrashEntityType = 'TRANSACTION' | 'TARGET' | 'RECURRING' | 'ACCOUNT';

export interface TrashEntry {
  entityType: TrashEntityType;
  id: string;
  item: Record<string, unknown>;
  deletedAt: string;
  expiresAt: number;
}

export interface TrashRef {
  entityType: TrashEntityType;
  id: string;
}

export interface TrashGroup {
  entityType: TrashEntityType;
  label: string;
  entries: TrashEntry[];
}

const GROUPS: { entityType: TrashEntityType; label: string }[] = [
  { entityType: 'TRANSACTION', label: 'Transactions' },
  { entityType: 'TARGET', label: NAMES.budgets },
  { entityType: 'RECURRING', label: 'Recurring' },
  { entityType: 'ACCOUNT', label: 'Accounts' },
];

export function transactionTrashId(transaction: Pick<Transaction, 'yearMonth' | 'transactionId'>): string {
  return `${transaction.yearMonth}#${transaction.transactionId}`;
}

export function transactionLabel(transaction: Pick<Transaction, 'amount' | 'description'>, categoryName: string): string {
  return `${formatPence(transaction.amount)} · ${transaction.description || categoryName}`;
}

export function targetLabel(targetAmount: number, categoryName: string): string {
  return `${formatPence(targetAmount)} budget · ${categoryName}`;
}

export function accountDeleteSummary(account: Pick<Account, 'name' | 'balances'>): string {
  const count = account.balances.length;
  if (count === 0) return account.name;
  return `${account.name} and its ${count} balance ${count === 1 ? 'entry' : 'entries'}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function categoryName(categories: Category[], categoryId: unknown, fallback: string): string {
  return categories.find(c => c.categoryId === categoryId)?.name ?? fallback;
}

export function trashEntryLabel(entry: TrashEntry, categories: Category[]): string {
  const { item } = entry;
  switch (entry.entityType) {
    case 'TRANSACTION':
      return transactionLabel(
        { amount: pence(item.amount), description: text(item.description) },
        categoryName(categories, item.categoryId, 'Transaction'),
      );
    case 'TARGET':
      return targetLabel(pence(item.targetAmount), categoryName(categories, item.categoryId, 'Category'));
    case 'RECURRING':
      return transactionLabel(
        { amount: pence(item.amount), description: text(item.description) },
        categoryName(categories, item.categoryId, 'Recurring item'),
      );
    case 'ACCOUNT':
      return accountDeleteSummary({
        name: text(item.name) || 'Account',
        balances: Array.isArray(item.balances) ? item.balances : [],
      });
  }
}

export function groupTrash(entries: TrashEntry[]): TrashGroup[] {
  return GROUPS
    .map(group => ({ ...group, entries: entries.filter(entry => entry.entityType === group.entityType) }))
    .filter(group => group.entries.length > 0);
}
