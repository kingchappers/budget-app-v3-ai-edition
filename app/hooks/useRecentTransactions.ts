import { useMemo } from 'react';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import { useTransactionsRange } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export const RECENT_MONTHS = 12;
export const RECENT_LIMIT = 200;

function newestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date > b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  return 0;
}

// The user's most recent transactions, whatever month they fall in. Chips and
// category memory both learn from this, so neither resets on the 1st and
// neither forgets a habit just because a few quiet months went by.
export function useRecentTransactions(enabled: boolean): Transaction[] | undefined {
  const to = currentYearMonth();
  const data = useTransactionsRange(shiftMonth(to, -(RECENT_MONTHS - 1)), to, enabled).data;
  return useMemo(() => (data ? [...data].sort(newestFirst).slice(0, RECENT_LIMIT) : undefined), [data]);
}
