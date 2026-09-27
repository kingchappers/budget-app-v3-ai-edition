import { lastDayOfMonth } from './months';
import type { Account, AccountKind, AccountType, BalanceEntry } from './types';

export function balanceAsOf(entries: BalanceEntry[], date: string): number {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  let pence = 0;
  for (const entry of sorted) {
    if (entry.date > date) break;
    pence = entry.pence;
  }
  return pence;
}

export function netWorthAsOf(accounts: Account[], date: string): number {
  return accounts.reduce((sum, account) => {
    const balance = balanceAsOf(account.balances, date);
    return account.kind === 'LIABILITY' ? sum - balance : sum + balance;
  }, 0);
}

export function monthEndIso(yearMonth: string): string {
  return `${yearMonth}-${String(lastDayOfMonth(yearMonth)).padStart(2, '0')}`;
}

export const ASSET_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'INVESTMENT', label: 'Investment' },
];

export const LIABILITY_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'LOAN', label: 'Loan' },
];

export function typeOptionsForKind(kind: AccountKind): { value: AccountType; label: string }[] {
  return kind === 'ASSET' ? ASSET_TYPE_OPTIONS : LIABILITY_TYPE_OPTIONS;
}

export function accountTypeLabel(type: AccountType): string {
  return [...ASSET_TYPE_OPTIONS, ...LIABILITY_TYPE_OPTIONS].find(option => option.value === type)?.label ?? type;
}
