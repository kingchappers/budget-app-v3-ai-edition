import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useProtectedApi } from '~/hooks/useProtectedApi';
import { createApi, type ConfirmInboxInput, type ConnectBankInput, type TransactionInput } from './api';
import type { Category, InboxItem, InboxPage, TargetPeriod } from './types';

export const queryKeys = {
  categories: ['categories'] as const,
  targets: ['targets'] as const,
  transactions: (yearMonth: string) => ['transactions', yearMonth] as const,
  connections: ['connections'] as const,
  syncStatus: ['syncStatus'] as const,
  inbox: ['inbox'] as const,
  inboxCount: ['inboxCount'] as const,
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

export function useCreateTransaction(yearMonth: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransactionInput) => api.createTransaction(input),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions(yearMonth) });
      if (created.yearMonth !== yearMonth) {
        qc.invalidateQueries({ queryKey: queryKeys.transactions(created.yearMonth) });
      }
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

export function useDeleteTransaction(yearMonth: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transactionId: string) => api.deleteTransaction(yearMonth, transactionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions(yearMonth) }),
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

export function useConnections() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({ queryKey: queryKeys.connections, queryFn: () => api.getConnections(), enabled });
}

export function useConnectBank() {
  const api = useApi();
  return useMutation({ mutationFn: (input: ConnectBankInput) => api.connectBank(input) });
}

export function useCompleteBankCallback() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (state: string) => api.completeBankCallback(state),
    onSuccess: (result) => {
      if (result.status !== 'READY') return;
      qc.invalidateQueries({ queryKey: queryKeys.connections });
      qc.invalidateQueries({ queryKey: queryKeys.syncStatus });
    },
  });
}

export function useClearBankAuth() {
  const api = useApi();
  return useMutation({ mutationFn: (state: string) => api.clearBankAuth(state) });
}

export function useDisconnectBank() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => api.disconnectBank(connectionId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.connections });
      qc.invalidateQueries({ queryKey: queryKeys.inbox });
      qc.invalidateQueries({ queryKey: queryKeys.inboxCount });
    },
  });
}

export function useTriggerSync() {
  const api = useApi();
  return useMutation({ mutationFn: () => api.triggerSync() });
}

export function useInbox() {
  const api = useApi();
  const enabled = useAuthReady();
  return useInfiniteQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ pageParam }) => api.getInbox(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: InboxPage) => lastPage.cursor,
    enabled,
  });
}

export function useInboxCount() {
  const api = useApi();
  const enabled = useAuthReady();
  return useQuery({ queryKey: queryKeys.inboxCount, queryFn: () => api.getInboxCount(), enabled });
}

function removeFromInbox(qc: QueryClient, txnKey: string): InfiniteData<InboxPage> | undefined {
  const previous = qc.getQueryData<InfiniteData<InboxPage>>(queryKeys.inbox);
  qc.setQueryData<InfiniteData<InboxPage>>(queryKeys.inbox, old => old && {
    ...old,
    pages: old.pages.map(page => ({ ...page, items: page.items.filter(item => item.txnKey !== txnKey) })),
  });
  return previous;
}

export function useConfirmInboxItem() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item: InboxItem; input: ConfirmInboxInput }) => api.confirmInboxItem(vars.item, vars.input),
    onMutate: async ({ item }) => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox });
      return { previous: removeFromInbox(qc, item.txnKey) };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.inbox, context.previous);
    },
    onSettled: (_data, _error, { item }) => {
      qc.invalidateQueries({ queryKey: queryKeys.inboxCount });
      qc.invalidateQueries({ queryKey: queryKeys.transactions(item.bookingDate.slice(0, 7)) });
    },
  });
}

export function useIgnoreInboxItem() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: InboxItem) => api.ignoreInboxItem(item),
    onMutate: async item => {
      await qc.cancelQueries({ queryKey: queryKeys.inbox });
      return { previous: removeFromInbox(qc, item.txnKey) };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.inbox, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.inboxCount }),
  });
}
