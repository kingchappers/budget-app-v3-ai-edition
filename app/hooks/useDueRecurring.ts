import { useCallback, useMemo } from 'react';
import { shiftMonth, todayIso } from '~/lib/months';
import { useCategories, useRecurring, useTransactions } from '~/lib/queries';
import { computeDueItems, LOOK_BACK_MONTHS, type DueItem } from '~/lib/recurring';
import type { Transaction } from '~/lib/types';

export interface DueRecurringState {
  items: DueItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface Source {
  isLoading: boolean;
  error: Error | null;
  refetch: () => unknown;
}

// A fixed number of hook calls, in a fixed order: three months back, this month and next.
function useWindowTransactions(thisMonth: string): Array<Source & { data: Transaction[] | undefined }> {
  return [
    useTransactions(shiftMonth(thisMonth, -LOOK_BACK_MONTHS)),
    useTransactions(shiftMonth(thisMonth, -2)),
    useTransactions(shiftMonth(thisMonth, -1)),
    useTransactions(thisMonth),
    useTransactions(shiftMonth(thisMonth, 1)),
  ];
}

export function useDueRecurring(): DueRecurringState {
  const recurring = useRecurring();
  const categories = useCategories();
  const today = todayIso();
  const months = useWindowTransactions(today.slice(0, 7));

  const sources: Source[] = [recurring, categories, ...months];
  const error = sources.find(source => source.error != null)?.error ?? null;
  const monthData = months.map(month => month.data);

  const items = useMemo(() => {
    if (error) return [];
    return computeDueItems({
      recurring: recurring.data ?? [],
      categories: categories.data ?? [],
      transactions: monthData.flatMap(rows => rows ?? []),
      today,
    });
    // monthData is rebuilt each render, so depend on its stable members instead.
  }, [error, recurring.data, categories.data, today, ...monthData]);

  const failed = sources.map(source => (source.error != null ? '1' : '0')).join('');
  const refetchers = sources.map(source => source.refetch);

  const refetch = useCallback((): void => {
    const anyFailed = failed.includes('1');
    refetchers.forEach((run, index) => {
      if (!anyFailed || failed[index] === '1') void run();
    });
  }, [failed, ...refetchers]);

  return {
    items,
    isLoading: sources.some(source => source.isLoading),
    error,
    refetch,
  };
}
