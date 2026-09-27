import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useProtectedApi } from '~/hooks/useProtectedApi';
import { createApi, type RecurringInput, type TransactionInput } from './api';
import { clearPendingEntry, OFFLINE_QUEUE_KEY, pendingRowsForMonth, type PendingMap } from './pendingEntries';
import type { Category, CategoryGroup, PotSettingsInput, Recurring, TargetPeriod, Transaction } from './types';

export const queryKeys = {
  categories: ['categories'] as const,
  targets: ['targets'] as const,
  transactions: (yearMonth: string) => ['transactions', yearMonth] as const,
  recurring: ['recurring'] as const,
  pots: (asOf: string) => ['pots', asOf] as const,
  offlineQueue: OFFLINE_QUEUE_KEY,
};

export function useApi() {
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

// Merges any still-pending (unsent or queued-offline) entries for this month
// on top of whatever the server returned, so a pending row survives any
// refetch instead of depending on a one-off cache write that a later
// invalidation would silently erase.
function useTransactionsOverlay(yearMonth: string, serverRows: Transaction[] | undefined): Transaction[] | undefined {
  const { data: pendingMap = {} } = useQuery<PendingMap>({
    queryKey: OFFLINE_QUEUE_KEY,
    queryFn: () => ({}),
    initialData: {},
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return useMemo(() => {
    const pendingRows = pendingRowsForMonth(pendingMap, yearMonth);
    if (pendingRows.length === 0) return serverRows;
    const knownIds = new Set((serverRows ?? []).map(t => t.transactionId));
    const extra = pendingRows.filter(row => !knownIds.has(row.transactionId));
    if (extra.length === 0) return serverRows;
    return [...(serverRows ?? []), ...extra];
  }, [pendingMap, yearMonth, serverRows]);
}

export function useTransactions(yearMonth: string, enabled: boolean = true) {
  const api = useApi();
  const authReady = useAuthReady();
  const query = useQuery({
    queryKey: queryKeys.transactions(yearMonth),
    queryFn: () => api.getTransactions(yearMonth),
    enabled: authReady && enabled,
  });
  const data = useTransactionsOverlay(yearMonth, query.data);
  return { ...query, data };
}

export function useCreateTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<Transaction, Error, TransactionInput>({
    mutationFn: (input) => api.createTransaction(input),
    // The default 'online' mode PAUSES a mutation while the browser reports
    // itself offline rather than letting it fail — so useSaveWithUndo's
    // rejection handler (the thing that queues the entry) would never run,
    // and a create attempted with no signal would just sit in memory and be
    // lost when the app closes. 'always' lets it fail immediately instead.
    networkMode: 'always',
    onSettled: async (created, _error, input) => {
      if (!created) {
        // A rejected mutation: fire the invalidation without awaiting it.
        // useSaveWithUndo's own rejection handler is what decides whether to
        // queue this entry, and TanStack awaits onSettled before mutateAsync
        // rejects — awaiting the invalidation here (plus its own retry) would
        // delay that decision, leaving an entry that should already be
        // safely in IndexedDB sitting only in memory for longer.
        qc.invalidateQueries({ queryKey: queryKeys.transactions(input.date.slice(0, 7)) });
        qc.invalidateQueries({ queryKey: ['pots'] });
        return;
      }
      // Wait for the refetch before clearing the pending overlay row for a
      // successful create, so the real server row is already in place and
      // nothing blinks out in between.
      await qc.invalidateQueries({ queryKey: queryKeys.transactions(input.date.slice(0, 7)) });
      qc.invalidateQueries({ queryKey: ['pots'] });
      if (input.transactionId) clearPendingEntry(qc, input.transactionId);
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
      qc.invalidateQueries({ queryKey: ['pots'] });
    },
  });
}

export function useDeleteTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { transactionId: string; yearMonth: string }) =>
      api.deleteTransaction(vars.yearMonth, vars.transactionId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(vars.yearMonth) });
      qc.invalidateQueries({ queryKey: ['pots'] });
    },
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
    mutationFn: (input: { name: string; type: Category['type']; icon: string; group?: CategoryGroup }) => api.createCategory(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories });
      qc.invalidateQueries({ queryKey: ['pots'] });
    },
  });
}

export function useReassignCategory() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; toCategoryId: string }) =>
      api.reassignCategory(vars.categoryId, vars.toCategoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.recurring });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['pots'] });
    },
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
      qc.invalidateQueries({ queryKey: queryKeys.recurring });
      qc.invalidateQueries({ queryKey: ['pots'] });
    },
  });
}

export function usePots(asOf: string, enabled: boolean = true) {
  const api = useApi();
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.pots(asOf),
    queryFn: () => api.getPots(asOf),
    enabled: authReady && enabled,
  });
}

export function useSavePot() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; input: PotSettingsInput }) =>
      api.savePot(vars.categoryId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pots'] }),
  });
}

export function useRecurring() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({
    queryKey: queryKeys.recurring,
    queryFn: () => api.getRecurring(),
    enabled,
  });
}

export function useCreateRecurring() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecurringInput) => api.createRecurring(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useUpdateRecurring() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { recurringId: string; input: RecurringInput }) =>
      api.updateRecurring(vars.recurringId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useDeleteRecurring() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recurringId: string) => api.deleteRecurring(recurringId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

interface SetHandledVars {
  recurringId: string;
  period: string | null;
}

function withHandledPeriod(rows: Recurring[] | undefined, recurringId: string, period: string | null): Recurring[] | undefined {
  return rows?.map(row => (row.recurringId === recurringId ? { ...row, handledPeriod: period } : row));
}

export function useSetRecurringHandled() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<Recurring, Error, SetHandledVars, { previousPeriod: string | null }>({
    mutationFn: (vars) => api.setRecurringHandled(vars.recurringId, vars.period),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: queryKeys.recurring });
      const rows = qc.getQueryData<Recurring[]>(queryKeys.recurring);
      const previousPeriod = rows?.find(row => row.recurringId === vars.recurringId)?.handledPeriod ?? null;
      qc.setQueryData<Recurring[]>(queryKeys.recurring, current => withHandledPeriod(current, vars.recurringId, vars.period));
      return { previousPeriod };
    },
    onError: (_error, vars, context) => {
      if (!context) return;
      qc.setQueryData<Recurring[]>(queryKeys.recurring, current => withHandledPeriod(current, vars.recurringId, context.previousPeriod));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.recurring });
    },
  });
}
