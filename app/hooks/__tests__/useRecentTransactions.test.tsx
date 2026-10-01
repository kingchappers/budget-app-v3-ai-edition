import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import type { Transaction } from '~/lib/types';

const mockUseRange = vi.hoisted(() => vi.fn());
vi.mock('~/lib/queries', () => ({ useTransactionsRange: mockUseRange }));

import { RECENT_LIMIT, RECENT_MONTHS, useRecentTransactions } from '../useRecentTransactions';

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't', yearMonth: '2026-09', amount: 100, type: 'EXPENSE', categoryId: 'a',
    description: '', date: '2026-09-10', createdAt: '', ...over,
  };
}

let rangeData: Transaction[] | undefined;

beforeEach(() => {
  rangeData = undefined;
  mockUseRange.mockReset();
  mockUseRange.mockImplementation(() => ({ data: rangeData }));
});

describe('useRecentTransactions', () => {
  it('asks for the last 12 months ending this month, and only while enabled', () => {
    renderHook(() => useRecentTransactions(true));
    const to = currentYearMonth();
    expect(mockUseRange).toHaveBeenCalledWith(shiftMonth(to, -(RECENT_MONTHS - 1)), to, true);
    expect(RECENT_MONTHS).toBe(12);

    mockUseRange.mockClear();
    renderHook(() => useRecentTransactions(false));
    expect(mockUseRange).toHaveBeenCalledWith(expect.any(String), to, false);
  });

  it('is undefined until the transactions have loaded', () => {
    const { result } = renderHook(() => useRecentTransactions(true));
    expect(result.current).toBeUndefined();
  });

  it('returns the newest first, whatever month they fall in', () => {
    rangeData = [
      txn({ transactionId: 'old', date: '2026-01-05' }),
      txn({ transactionId: 'new', date: '2026-09-20' }),
      txn({ transactionId: 'mid', date: '2026-05-15' }),
    ];
    const { result } = renderHook(() => useRecentTransactions(true));
    expect(result.current?.map(t => t.transactionId)).toEqual(['new', 'mid', 'old']);
  });

  it('breaks a tie on the same day by when it was created', () => {
    rangeData = [
      txn({ transactionId: 'first', createdAt: '2026-09-10T08:00:00Z' }),
      txn({ transactionId: 'second', createdAt: '2026-09-10T09:00:00Z' }),
    ];
    const { result } = renderHook(() => useRecentTransactions(true));
    expect(result.current?.map(t => t.transactionId)).toEqual(['second', 'first']);
  });

  it('keeps only the most recent 200', () => {
    rangeData = Array.from({ length: 250 }, (_, i) => txn({
      transactionId: `t${i}`, date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    }));
    const { result } = renderHook(() => useRecentTransactions(true));
    expect(result.current).toHaveLength(RECENT_LIMIT);
    expect(RECENT_LIMIT).toBe(200);
    const oldestKept = result.current?.at(-1)?.date ?? '';
    const newestDropped = rangeData.map(t => t.date).sort().at(49) ?? '';
    expect(oldestKept >= newestDropped).toBe(true);
  });

  it('does not change what it returns while the loaded data is unchanged', () => {
    rangeData = [txn({ transactionId: 'a' })];
    const { result, rerender } = renderHook(() => useRecentTransactions(true));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
