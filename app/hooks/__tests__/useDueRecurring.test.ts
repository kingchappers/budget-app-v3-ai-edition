import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Category, Recurring, Transaction } from '~/lib/types';

interface QueryState<T> { data?: T; isLoading: boolean; error?: Error | null; refetch?: () => void }

const mockRefetch = vi.fn();
let recurringState: QueryState<Recurring[]>;
let categoriesState: QueryState<Category[]>;
let monthStates: Record<string, QueryState<Transaction[]>>;
const requestedMonths: string[] = [];

vi.mock('~/lib/queries', () => ({
  useRecurring: () => recurringState,
  useCategories: () => categoriesState,
  useTransactions: (month: string) => {
    requestedMonths.push(month);
    return monthStates[month] ?? { data: undefined, isLoading: false };
  },
}));

import { useDueRecurring } from '../useDueRecurring';

function rec(over: Partial<Recurring>): Recurring {
  return {
    recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
    dayOfMonth: 28, leadDays: 3, handledPeriod: null, createdAt: '', updatedAt: '', ...over,
  };
}

function txn(over: Partial<Transaction>): Transaction {
  return {
    transactionId: 't1', yearMonth: '2026-09', amount: 240000, type: 'INCOME', categoryId: 'cat-salary',
    description: 'Salary', date: '2026-09-28', createdAt: '', ...over,
  };
}

const categories: Category[] = [
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
];

describe('useDueRecurring', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 28));
    mockRefetch.mockReset();
    requestedMonths.length = 0;
    recurringState = { data: [rec({})], isLoading: false, error: null, refetch: mockRefetch };
    categoriesState = { data: categories, isLoading: false };
    monthStates = { '2026-09': { data: [], isLoading: false }, '2026-10': { data: [], isLoading: false } };
  });

  afterEach(() => { vi.useRealTimers(); });

  it('asks for today\'s month and the next month of transactions', () => {
    renderHook(() => useDueRecurring());
    expect(requestedMonths).toContain('2026-09');
    expect(requestedMonths).toContain('2026-10');
  });

  it('computes the due items from the templates and today\'s local date', () => {
    const { result } = renderHook(() => useDueRecurring());
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ status: 'today', dueDate: '2026-09-28', period: '2026-09' });
  });

  it('drops an item that a transaction this month already covers', () => {
    monthStates['2026-09'] = { data: [txn({})], isLoading: false };
    const { result } = renderHook(() => useDueRecurring());
    expect(result.current.items).toEqual([]);
  });

  it('uses next month\'s transactions for an occurrence that falls next month', () => {
    recurringState = {
      data: [rec({ recurringId: 'rent', type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', dayOfMonth: 1, handledPeriod: '2026-09' })],
      isLoading: false, error: null, refetch: mockRefetch,
    };
    const { result: unpaid } = renderHook(() => useDueRecurring());
    expect(unpaid.current.items[0]).toMatchObject({ period: '2026-10', dueDate: '2026-10-01' });

    monthStates['2026-10'] = {
      data: [txn({ type: 'EXPENSE', categoryId: 'cat-housing', description: 'Rent', date: '2026-10-01', yearMonth: '2026-10' })],
      isLoading: false,
    };
    const { result: paid } = renderHook(() => useDueRecurring());
    expect(paid.current.items).toEqual([]);
  });

  it('is loading while any of its sources is loading', () => {
    monthStates['2026-10'] = { data: undefined, isLoading: true };
    expect(renderHook(() => useDueRecurring()).result.current.isLoading).toBe(true);

    monthStates['2026-10'] = { data: [], isLoading: false };
    recurringState = { data: undefined, isLoading: true, error: null, refetch: mockRefetch };
    expect(renderHook(() => useDueRecurring()).result.current.isLoading).toBe(true);
  });

  it('surfaces a templates error and can refetch them', () => {
    const boom = new Error('boom');
    recurringState = { data: undefined, isLoading: false, error: boom, refetch: mockRefetch };
    const { result } = renderHook(() => useDueRecurring());

    expect(result.current.error).toBe(boom);
    result.current.refetch();
    expect(mockRefetch).toHaveBeenCalled();
  });
});
