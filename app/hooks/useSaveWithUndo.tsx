import { notifications } from '@mantine/notifications';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import type { TransactionInput } from '~/lib/api';
import { formatPence } from '~/lib/money';
import { useCategories, useCreateTransaction, useDeleteTransaction } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export function useSaveWithUndo(): (input: TransactionInput) => Promise<Transaction | null> {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();

  function describeInput(input: TransactionInput): string {
    const categoryName = categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    return `${formatPence(input.amount)} · ${categoryName}`;
  }

  function showFailureToast(input: TransactionInput): void {
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
            void save(input);
          }}
        />
      ),
    });
  }

  function save(input: TransactionInput): Promise<Transaction | null> {
    const toastId = `saved-${crypto.randomUUID()}`;
    let undone = false;
    const outcome = create.mutateAsync(input).then(
      created => created,
      () => {
        notifications.hide(toastId);
        // A cancelled entry must not offer Retry, or one tap would re-create it.
        if (!undone) showFailureToast(input);
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
            void outcome.then(created => {
              if (!created) return;
              remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
            });
          }}
        />
      ),
    });

    return outcome;
  }

  return save;
}
