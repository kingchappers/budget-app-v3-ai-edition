import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { ApiError } from '~/lib/apiError';
import type { TransactionInput } from '~/lib/api';
import { formatPence } from '~/lib/money';
import { dequeue, enqueue } from '~/lib/offlineQueue';
import { useCategories, useCreateTransaction, useDeleteTransaction, queryKeys } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export interface SaveOptions {
  onUndo?: () => void;
}

export function useSaveWithUndo(): (input: TransactionInput, options?: SaveOptions) => Promise<Transaction | null> {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const qc = useQueryClient();

  function describeInput(input: TransactionInput): string {
    const categoryName = categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    return `${formatPence(input.amount)} · ${categoryName}`;
  }

  function showFailureToast(input: TransactionInput, options?: SaveOptions): void {
    const toastId = `failed-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      color: 'danger',
      autoClose: false,
      message: (
        <ToastAction
          text={`Couldn't save ${describeInput(input)}`}
          actionLabel="Retry"
          onAction={() => {
            notifications.hide(toastId);
            void save(input, options);
          }}
        />
      ),
    });
  }

  async function discardQueuedEntry(transactionId: string, yearMonth: string): Promise<void> {
    await dequeue(transactionId);
    qc.setQueryData<Record<string, { lastError?: string }>>(queryKeys.offlineQueue, (current = {}) => {
      const { [transactionId]: _removed, ...rest } = current;
      return rest;
    });
    qc.setQueryData<Transaction[]>(
      queryKeys.transactions(yearMonth),
      (rows) => rows?.filter(t => t.transactionId !== transactionId),
    );
  }

  function save(input: TransactionInput, options?: SaveOptions): Promise<Transaction | null> {
    const toastId = `saved-${crypto.randomUUID()}`;
    const transactionId = crypto.randomUUID();
    const withId: TransactionInput = { ...input, transactionId };
    let undone = false;
    let queuedYearMonth: string | null = null;

    const outcome = create.mutateAsync(withId).then(
      created => created,
      async (error: unknown) => {
        notifications.hide(toastId);
        if (error instanceof ApiError) {
          // A cancelled entry must not offer Retry, or one tap would re-create it.
          if (!undone) showFailureToast(input, options);
          return null;
        }
        const yearMonth = input.date.slice(0, 7);
        await enqueue({ id: transactionId, input, queuedAt: new Date().toISOString() });
        qc.setQueryData<Record<string, { lastError?: string }>>(
          queryKeys.offlineQueue,
          (current = {}) => ({ ...current, [transactionId]: {} }),
        );
        queuedYearMonth = yearMonth;
        if (undone) await discardQueuedEntry(transactionId, yearMonth);
        return null;
      },
    );

    notifications.show({
      id: toastId,
      autoClose: TOAST_MS,
      message: (
        <ToastAction
          text={`Saved ${describeInput(input)}`}
          actionLabel="Undo"
          onAction={() => {
            undone = true;
            notifications.hide(toastId);
            void outcome.then(async created => {
              if (created) {
                remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
                options?.onUndo?.();
                return;
              }
              if (queuedYearMonth) {
                await discardQueuedEntry(transactionId, queuedYearMonth);
                options?.onUndo?.();
              }
            });
          }}
        />
      ),
    });

    return outcome;
  }

  return save;
}
