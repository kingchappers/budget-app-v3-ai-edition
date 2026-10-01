import { formatPence } from './money';
import { daysBetweenIso, formatShortDate, lastDayOfMonth } from './months';
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

// When the balance shown was last entered, in words: "Updated today", "Updated 23 days ago".
export function updatedAgo(entries: BalanceEntry[], today: string): string {
  const dates = entries.map(entry => entry.date).filter(date => date <= today).sort();
  const latest = dates[dates.length - 1];
  if (latest === undefined) return 'Not updated yet';
  const days = daysBetweenIso(latest, today);
  if (days === 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  return `Updated ${days} days ago`;
}

// Accounts with no balance entered. They count as £0, so the net worth total is not complete without them.
export function accountsWithoutBalance(accounts: Account[]): Account[] {
  return accounts.filter(account => account.balances.length === 0);
}

// How the latest balance compares with the one before it, in plain words, e.g. "£50.00 lower than on 10 Sep".
// Said without judgement: for a debt, lower is progress, but the words are the same for every account.
export function balanceChangeNote(entries: BalanceEntry[], today: string): string | null {
  const sorted = entries.filter(entry => entry.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const latest = sorted[sorted.length - 1];
  const before = sorted[sorted.length - 2];
  const difference = latest.pence - before.pence;
  if (difference === 0) return `Same as on ${formatShortDate(before.date)}`;
  return `${formatPence(Math.abs(difference))} ${difference < 0 ? 'lower' : 'higher'} than on ${formatShortDate(before.date)}`;
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
