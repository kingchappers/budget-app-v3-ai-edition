import { useMemo } from 'react';
import { shiftMonth, todayIso } from '~/lib/months';
import { useCategories, useRecurring, useTransactions } from '~/lib/queries';
import { computeDueItems, type DueItem } from '~/lib/recurring';

export interface DueRecurringState {
  items: DueItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useDueRecurring(): DueRecurringState {
  const recurring = useRecurring();
  const categories = useCategories();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const current = useTransactions(thisMonth);
  const next = useTransactions(shiftMonth(thisMonth, 1));

  const items = useMemo(() => computeDueItems({
    recurring: recurring.data ?? [],
    categories: categories.data ?? [],
    transactions: [...(current.data ?? []), ...(next.data ?? [])],
    today,
  }), [recurring.data, categories.data, current.data, next.data, today]);

  return {
    items,
    isLoading: recurring.isLoading || categories.isLoading || current.isLoading || next.isLoading,
    error: recurring.error ?? null,
    refetch: () => { void recurring.refetch(); },
  };
}
