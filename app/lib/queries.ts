import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useProtectedApi } from '~/hooks/useProtectedApi';
import { createApi, type TransactionInput } from './api';
import type { Category, TargetPeriod, Transaction } from './types';

export const queryKeys = {
  categories: ['categories'] as const,
  targets: ['targets'] as const,
  transactions: (yearMonth: string) => ['transactions', yearMonth] as const,
};

function useApi() {
  const { request } = useProtectedApi();
  return useMemo(() => createApi(request), [request]);
}

// Every endpoint needs a bearer token, so a query fired before Auth0 has finished
// restoring the session rejects and parks in an error state that nothing retries.
function useAuthReady() {
  return useAuth0().isAuthenticated;
}

export function useCategories() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.getCategories(),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useTargets() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.targets,
    queryFn: () => api.getTargets(),
    enabled,
  });
}

export function useTransactions(yearMonth: string) {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.transactions(yearMonth),
    queryFn: () => api.getTransactions(yearMonth),
    enabled,
  });
}

interface CreateContext {
  yearMonth: string;
  tempId: string;
}

export function useCreateTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<Transaction, Error, TransactionInput, CreateContext>({
    mutationFn: (input) => api.createTransaction(input),
    onMutate: async (input) => {
      const yearMonth = input.date.slice(0, 7);
      const key = queryKeys.transactions(yearMonth);
      const tempId = `temp-${crypto.randomUUID()}`;
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Transaction[]>(key);
      if (previous !== undefined) {
        const temp: Transaction = { ...input, transactionId: tempId, yearMonth, createdAt: new Date().toISOString() };
        qc.setQueryData<Transaction[]>(key, [...previous, temp]);
      }
      return { yearMonth, tempId };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      qc.setQueryData<Transaction[]>(
        queryKeys.transactions(context.yearMonth),
        (rows) => rows?.filter(t => t.transactionId !== context.tempId),
      );
    },
    onSettled: (_created, _error, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(input.date.slice(0, 7)) });
    },
  });
}

export function useUpdateTransaction(yearMonth: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; input: TransactionInput }) =>
      api.updateTransaction(yearMonth, vars.transactionId, vars.input),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(yearMonth) });
      if (updated.yearMonth !== yearMonth) {
        qc.invalidateQueries({ queryKey: queryKeys.transactions(updated.yearMonth) });
      }
    },
  });
}

export function useDeleteTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; yearMonth: string }) =>
      api.deleteTransaction(vars.yearMonth, vars.transactionId),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.transactions(vars.yearMonth) }),
  });
}

export function useSetTarget() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; targetAmount: number; period: TargetPeriod }) =>
      api.setTarget(vars.categoryId, vars.targetAmount, vars.period),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.targets }),
  });
}

export function useDeleteTarget() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => api.deleteTarget(categoryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.targets }),
  });
}

export function useCreateCategory() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; type: Category['type']; icon: string }) => api.createCategory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.categories }),
  });
}

export function useReassignCategory() {
  const api = useApi();
  return useMutation({
    mutationFn: (vars: { categoryId: string; toCategoryId: string }) =>
      api.reassignCategory(vars.categoryId, vars.toCategoryId),
  });
}

export function useDeleteCategory() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => api.deleteCategory(categoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories });
      qc.invalidateQueries({ queryKey: queryKeys.targets });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
