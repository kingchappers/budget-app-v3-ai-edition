import { describe, it, expect } from 'vitest';
import { accountsWithoutBalance, accountTypeLabel, balanceAsOf, balanceChangeNote, monthEndIso, netWorthAsOf, typeOptionsForKind, updatedAgo } from '../accounts';
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

describe('updatedAgo', () => {
  const entries = (...dates: string[]): BalanceEntry[] => dates.map(date => ({ date, pence: 100 }));

  it('says today and yesterday in words', () => {
    expect(updatedAgo(entries('2026-09-28'), '2026-09-28')).toBe('Updated today');
    expect(updatedAgo(entries('2026-09-27'), '2026-09-28')).toBe('Updated yesterday');
  });

  it('counts the days since the latest balance was entered', () => {
    expect(updatedAgo(entries('2026-08-01', '2026-09-05'), '2026-09-28')).toBe('Updated 23 days ago');
  });

  it('uses the latest entry whatever order they are stored in', () => {
    expect(updatedAgo(entries('2026-09-20', '2026-09-01'), '2026-09-28')).toBe('Updated 8 days ago');
  });

  it('ignores a balance dated in the future', () => {
    expect(updatedAgo(entries('2026-09-01', '2026-12-01'), '2026-09-28')).toBe('Updated 27 days ago');
  });

  it('says so when there is nothing entered yet', () => {
    expect(updatedAgo([], '2026-09-28')).toBe('Not updated yet');
    expect(updatedAgo(entries('2026-12-01'), '2026-09-28')).toBe('Not updated yet');
  });
});

describe('accountsWithoutBalance', () => {
  it('lists only the accounts that have no balance entered', () => {
    const empty = account({ accountId: 'empty' });
    const filled = account({ accountId: 'filled', balances: [{ date: '2026-09-01', pence: 100 }] });
    expect(accountsWithoutBalance([empty, filled])).toEqual([empty]);
  });
});

describe('balanceChangeNote', () => {
  const today = '2026-09-28';

  it('says nothing with fewer than two balances', () => {
    expect(balanceChangeNote([], today)).toBeNull();
    expect(balanceChangeNote([{ date: '2026-09-01', pence: 5000 }], today)).toBeNull();
  });

  it('says how the latest balance compares with the one before, without judging it', () => {
    expect(balanceChangeNote([{ date: '2026-08-10', pence: 32000 }, { date: '2026-09-10', pence: 27000 }], today)).toBe('£50.00 lower than on 10 Aug');
    expect(balanceChangeNote([{ date: '2026-08-10', pence: 27000 }, { date: '2026-09-10', pence: 32000 }], today)).toBe('£50.00 higher than on 10 Aug');
    expect(balanceChangeNote([{ date: '2026-08-10', pence: 27000 }, { date: '2026-09-10', pence: 27000 }], today)).toBe('Same as on 10 Aug');
  });

  it('ignores balances dated in the future and works out of order', () => {
    expect(balanceChangeNote([{ date: '2026-10-10', pence: 1 }, { date: '2026-09-10', pence: 27000 }, { date: '2026-08-10', pence: 32000 }], today)).toBe('£50.00 lower than on 10 Aug');
  });
});
