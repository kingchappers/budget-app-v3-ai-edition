import { describe, it, expect } from 'vitest';
import { accountDeleteSummary, groupTrash, transactionLabel, trashEntryLabel, transactionTrashId, type TrashEntry } from '../trash';
import type { Account, Category, Transaction } from '../types';

const categories: Category[] = [
  { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-food', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
];

function entry(over: Partial<TrashEntry>): TrashEntry {
  return { entityType: 'TRANSACTION', id: '2026-09#t1', item: {}, deletedAt: '2026-09-29T10:00:00.000Z', expiresAt: 0, ...over };
}

const txn: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 350, type: 'EXPENSE',
  categoryId: 'cat-dining', description: 'Coffee', date: '2026-09-29', createdAt: '',
};

describe('transactionLabel', () => {
  it('shows the amount and the note', () => {
    expect(transactionLabel(txn, 'Dining')).toBe('£3.50 · Coffee');
  });

  it('falls back to the category name when there is no note', () => {
    expect(transactionLabel({ ...txn, description: '' }, 'Dining')).toBe('£3.50 · Dining');
  });
});

describe('accountDeleteSummary', () => {
  const account: Account = { accountId: 'a', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '' };

  it('names the account alone when it has no balance entries', () => {
    expect(accountDeleteSummary(account)).toBe('Lloyds');
  });

  it('counts balance entries, singular and plural', () => {
    expect(accountDeleteSummary({ ...account, balances: [{ date: '2026-09-01', pence: 1 }] })).toBe('Lloyds and its 1 balance entry');
    const balances = Array.from({ length: 14 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, pence: i }));
    expect(accountDeleteSummary({ ...account, balances })).toBe('Lloyds and its 14 balance entries');
  });
});

describe('trashEntryLabel', () => {
  it('describes a transaction', () => {
    expect(trashEntryLabel(entry({ item: { ...txn } }), categories)).toBe('£3.50 · Coffee');
  });

  it('describes a budget with its category', () => {
    const target = entry({ entityType: 'TARGET', id: 'cat-food', item: { categoryId: 'cat-food', targetAmount: 30000, period: 'MONTHLY' } });
    expect(trashEntryLabel(target, categories)).toBe('£300.00 budget · Groceries');
  });

  it('describes a recurring item', () => {
    const recurring = entry({ entityType: 'RECURRING', id: 'r1', item: { amount: 120000, description: '', categoryId: 'cat-food' } });
    expect(trashEntryLabel(recurring, categories)).toBe('£1,200.00 · Groceries');
  });

  it('describes an account with its balance entries', () => {
    const account = entry({ entityType: 'ACCOUNT', id: 'a', item: { name: 'Lloyds', balances: [{ date: '2026-09-01', pence: 1 }] } });
    expect(trashEntryLabel(account, categories)).toBe('Lloyds and its 1 balance entry');
  });

  it('copes with a category that no longer exists or a malformed item', () => {
    expect(trashEntryLabel(entry({ item: { amount: 100, categoryId: 'gone' } }), categories)).toBe('£1.00 · Transaction');
    expect(trashEntryLabel(entry({ entityType: 'ACCOUNT', item: {} }), categories)).toBe('Account');
  });
});

describe('groupTrash', () => {
  it('groups in a fixed order and leaves out empty groups', () => {
    const groups = groupTrash([
      entry({ entityType: 'ACCOUNT', id: 'a' }),
      entry({ entityType: 'TRANSACTION', id: '2026-09#t1' }),
      entry({ entityType: 'TRANSACTION', id: '2026-09#t2' }),
    ]);
    expect(groups.map(g => [g.label, g.entries.length])).toEqual([['Transactions', 2], ['Accounts', 1]]);
  });
});

describe('transactionTrashId', () => {
  it('builds the id the restore endpoint expects', () => {
    expect(transactionTrashId(txn)).toBe('2026-09#t1');
  });
});
