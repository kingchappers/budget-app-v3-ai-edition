import { useQueryClient } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { notifications } from '@mantine/notifications';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { ApiError } from '~/lib/apiError';
import type { TransactionInput } from '~/lib/api';
import { formatPence } from '~/lib/money';
import { enqueue } from '~/lib/offlineQueue';
import { clearPendingEntry, discardQueuedEntry, setPendingEntry } from '~/lib/pendingEntries';
import { useCategories, useCreateTransaction, useDeleteTransaction } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export interface SaveOptions {
  onUndo?: () => void;
}

export function useSaveWithUndo(): (input: TransactionInput, options?: SaveOptions) => Promise<Transaction | null> {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const qc = useQueryClient();
  const userSub = useAuth0().user?.sub ?? '';

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

  function save(input: TransactionInput, options?: SaveOptions): Promise<Transaction | null> {
    const toastId = `saved-${crypto.randomUUID()}`;
    const transactionId = crypto.randomUUID();
    const withId: TransactionInput = { ...input, transactionId };
    const queuedAt = new Date().toISOString();
    let undone = false;

    // Show the row immediately, the same instant Save is pressed, whether
    // this ends up an ordinary online create or a queued offline one — there
    // is only this one mechanism for "show it now", not a separate optimistic
    // insert plus a separate queued-row insert. `queued: false` here: this is
    // still just an in-flight attempt, not yet a durable offline entry, so it
    // must not show the banner, the pending badge, or a Discard action.
    setPendingEntry(qc, { id: transactionId, input, queuedAt, userSub, queued: false });

    const outcome = create.mutateAsync(withId).then(
      created => created,
      async (error: unknown) => {
        if (error instanceof ApiError) {
          notifications.hide(toastId);
          clearPendingEntry(qc, transactionId);
          // A cancelled entry must not offer Retry, or one tap would re-create it.
          if (!undone) showFailureToast(input, options);
          return null;
        }

        if (undone) {
          // Already undone before this settled: never let it reach the
          // queue at all, rather than enqueueing it and immediately
          // discarding it again — that gap was a real race, since a
          // concurrent flush triggered between the two could still send it.
          clearPendingEntry(qc, transactionId);
          notifications.hide(toastId);
          return null;
        }

        // Network failure: persist it so it survives a reload, and keep the
        // row showing (via the pending map already set above) until the next
        // successful flush. Deliberately does NOT hide the Saved/Undo toast
        // here — that used to happen on every rejection, which for an
        // offline failure (near-instant) left Undo a window of milliseconds.
        await enqueue({ id: transactionId, input, queuedAt, userSub });
        setPendingEntry(qc, { id: transactionId, input, queuedAt, userSub, queued: true });
        notifications.update({
          id: toastId,
          message: (
            <ToastAction
              text={`Saved offline · ${describeInput(input)}`}
              actionLabel="Undo"
              onAction={() => {
                undone = true;
                notifications.hide(toastId);
                void outcome.then(async created => {
                  if (created) return;
                  await discardQueuedEntry(qc, transactionId);
                  options?.onUndo?.();
                });
              }}
            />
          ),
        });
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
              // Not created yet: either still in flight (the rejection
              // handler above will see `undone` and discard it once it
              // lands) or already queued (discard it now).
              await discardQueuedEntry(qc, transactionId);
              options?.onUndo?.();
            });
          }}
        />
      ),
    });

    return outcome;
  }

  return save;
}
