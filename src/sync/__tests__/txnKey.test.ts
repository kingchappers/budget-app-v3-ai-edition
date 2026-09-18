import { describe, it, expect } from 'vitest';
import { deriveTxnKeys } from '../txnKey';
import type { ProviderTransaction } from '../types';

function txn(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  const base = {
    entryReference: null, amountPence: 350, direction: 'OUT' as const,
    bookingDate: '2026-09-10', description: 'COFFEE SHOP', currency: 'GBP',
  };
  const t = { ...base, ...overrides };
  return { ...t, fallbackBasis: [t.bookingDate, t.amountPence, t.direction, t.description].join('|') };
}

describe('deriveTxnKeys', () => {
  it('produces 32 hex character keys', () => {
    const [key] = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1' })]);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same entry reference', () => {
    const a = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1' })]);
    const b = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1', description: 'changed' })]);
    expect(a).toEqual(b);
  });

  it('gives identical-looking same-day transactions distinct keys', () => {
    const keys = deriveTxnKeys('enable-banking', 'acc-1', [txn(), txn()]);
    expect(new Set(keys).size).toBe(2);
  });

  it('produces the same set of keys regardless of API order', () => {
    const coffee = txn();
    const lunch = txn({ amountPence: 899, description: 'LUNCH' });
    const forward = deriveTxnKeys('enable-banking', 'acc-1', [coffee, lunch, coffee]);
    const shuffled = deriveTxnKeys('enable-banking', 'acc-1', [coffee, coffee, lunch]);
    expect([...forward].sort()).toEqual([...shuffled].sort());
  });

  it('keeps the first key when a second identical transaction appears in a later sync', () => {
    const [first] = deriveTxnKeys('enable-banking', 'acc-1', [txn()]);
    const later = deriveTxnKeys('enable-banking', 'acc-1', [txn(), txn()]);
    expect(later).toContain(first);
  });

  it('isolates accounts', () => {
    const a = deriveTxnKeys('enable-banking', 'acc-1', [txn({ entryReference: 'ref-1' })]);
    const b = deriveTxnKeys('enable-banking', 'acc-2', [txn({ entryReference: 'ref-1' })]);
    expect(a).not.toEqual(b);
  });
});
