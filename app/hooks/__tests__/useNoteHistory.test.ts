import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import type { Transaction } from '~/lib/types';

const mockUseTransactions = vi.hoisted(() => vi.fn());
vi.mock('~/lib/queries', () => ({ useTransactions: mockUseTransactions }));

import { useNoteHistory } from '../useNoteHistory';

const thisMonth = currentYearMonth();
const lastMonth = shiftMonth(thisMonth, -1);
const monthBefore = shiftMonth(thisMonth, -2);

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: thisMonth, amount: 100, type: 'EXPENSE',
    categoryId: 'cat-dining', description: '', date: `${thisMonth}-10`, createdAt: '', ...over,
  };
}

let dataByMonth: Record<string, Transaction[] | undefined>;

beforeEach(() => {
  dataByMonth = {};
  mockUseTransactions.mockReset();
  mockUseTransactions.mockImplementation((month: string) => ({ data: dataByMonth[month] }));
});

describe('useNoteHistory', () => {
  it('requests the current month and the two before it, enabled while open', () => {
    renderHook(() => useNoteHistory(true));
    expect(mockUseTransactions).toHaveBeenCalledWith(thisMonth, true);
    expect(mockUseTransactions).toHaveBeenCalledWith(lastMonth, true);
    expect(mockUseTransactions).toHaveBeenCalledWith(monthBefore, true);
  });

  it('disables all three requests while closed', () => {
    renderHook(() => useNoteHistory(false));
    expect(mockUseTransactions.mock.calls.length).toBe(3);
    expect(mockUseTransactions.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
  });

  it('indexes notes from all three months', () => {
    dataByMonth[thisMonth] = [txn({ transactionId: 'a', description: 'Coffee' })];
    dataByMonth[lastMonth] = [txn({ transactionId: 'b', description: 'Rent' })];
    dataByMonth[monthBefore] = [txn({ transactionId: 'c', description: 'Gym' })];

    const { result } = renderHook(() => useNoteHistory(true));

    expect([...result.current.keys()].sort()).toEqual(['coffee', 'gym', 'rent']);
  });

  it('copes with months that have not loaded yet', () => {
    const { result } = renderHook(() => useNoteHistory(true));
    expect(result.current.size).toBe(0);
  });

  it('picks up data that arrives later', () => {
    const { result, rerender } = renderHook(() => useNoteHistory(true));
    expect(result.current.has('coffee')).toBe(false);

    dataByMonth[thisMonth] = [txn({ description: 'Coffee' })];
    rerender();

    expect(result.current.has('coffee')).toBe(true);
  });
});
