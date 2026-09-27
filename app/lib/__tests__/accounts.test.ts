import { describe, it, expect } from 'vitest';
import { accountTypeLabel, balanceAsOf, monthEndIso, netWorthAsOf, typeOptionsForKind } from '../accounts';
import type { Account, BalanceEntry } from '../types';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'acc-1', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '', ...overrides };
}

describe('balanceAsOf', () => {
  const entries: BalanceEntry[] = [{ date: '2026-07-01', pence: 1000 }, { date: '2026-09-01', pence: 3000 }];

  it('is 0 before the first entry and 0 with no entries', () => {
    expect(balanceAsOf(entries, '2026-06-01')).toBe(0);
    expect(balanceAsOf([], '2026-09-01')).toBe(0);
  });

  it('is the last entry at or before the date', () => {
    expect(balanceAsOf(entries, '2026-08-01')).toBe(1000);
    expect(balanceAsOf(entries, '2026-09-01')).toBe(3000);
  });
});

describe('netWorthAsOf', () => {
  it('sums assets and subtracts liabilities', () => {
    const accounts = [
      account({ accountId: 'a', kind: 'ASSET', balances: [{ date: '2026-09-01', pence: 500000 }] }),
      account({ accountId: 'b', kind: 'LIABILITY', type: 'CREDIT_CARD', balances: [{ date: '2026-09-01', pence: 20000 }] }),
    ];
    expect(netWorthAsOf(accounts, '2026-09-15')).toBe(480000);
  });

  it('goes negative when liabilities exceed assets', () => {
    const accounts = [account({ kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 100000 }] })];
    expect(netWorthAsOf(accounts, '2026-09-15')).toBe(-100000);
  });

  it('is 0 for no accounts', () => {
    expect(netWorthAsOf([], '2026-09-15')).toBe(0);
  });
});

describe('monthEndIso', () => {
  it('gives the last calendar day of the month', () => {
    expect(monthEndIso('2026-02')).toBe('2026-02-28');
    expect(monthEndIso('2026-04')).toBe('2026-04-30');
  });
});

describe('typeOptionsForKind', () => {
  it('offers the three asset types for ASSET', () => {
    expect(typeOptionsForKind('ASSET').map(o => o.value)).toEqual(['CASH', 'SAVINGS', 'INVESTMENT']);
  });

  it('offers the two liability types for LIABILITY', () => {
    expect(typeOptionsForKind('LIABILITY').map(o => o.value)).toEqual(['CREDIT_CARD', 'LOAN']);
  });
});

describe('accountTypeLabel', () => {
  it.each([
    ['CASH', 'Cash'], ['SAVINGS', 'Savings'], ['INVESTMENT', 'Investment'],
    ['CREDIT_CARD', 'Credit card'], ['LOAN', 'Loan'],
  ] as const)('%s -> %s', (type, label) => {
    expect(accountTypeLabel(type)).toBe(label);
  });
});
