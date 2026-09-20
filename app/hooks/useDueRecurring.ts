import { useCallback, useMemo } from 'react';
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

  const error = recurring.error ?? categories.error ?? current.error ?? next.error ?? null;

  const items = useMemo(() => {
    if (error) return [];
    return computeDueItems({
      recurring: recurring.data ?? [],
      categories: categories.data ?? [],
      transactions: [...(current.data ?? []), ...(next.data ?? [])],
      today,
    });
  }, [error, recurring.data, categories.data, current.data, next.data, today]);

  const refetchRecurring = recurring.refetch;
  const refetchCategories = categories.refetch;
  const refetchCurrent = current.refetch;
  const refetchNext = next.refetch;
  const recurringFailed = recurring.error != null;
  const categoriesFailed = categories.error != null;
  const currentFailed = current.error != null;
  const nextFailed = next.error != null;

  const refetch = useCallback((): void => {
    const anyFailed = recurringFailed || categoriesFailed || currentFailed || nextFailed;
    if (recurringFailed || !anyFailed) void refetchRecurring();
    if (categoriesFailed || !anyFailed) void refetchCategories();
    if (currentFailed || !anyFailed) void refetchCurrent();
    if (nextFailed || !anyFailed) void refetchNext();
  }, [
    recurringFailed, categoriesFailed, currentFailed, nextFailed,
    refetchRecurring, refetchCategories, refetchCurrent, refetchNext,
  ]);

  return {
    items,
    isLoading: recurring.isLoading || categories.isLoading || current.isLoading || next.isLoading,
    error,
    refetch,
  };
}
