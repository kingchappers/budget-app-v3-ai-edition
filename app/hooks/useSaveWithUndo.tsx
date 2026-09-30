import { useQueryClient } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { notifications } from '@mantine/notifications';
import { ToastAction } from '~/components/layout/ToastAction';
import { ApiError } from '~/lib/apiError';
import type { TransactionInput } from '~/lib/api';
import { formatPence } from '~/lib/money';
import { formatDayLabel, todayIso } from '~/lib/months';
import { enqueue } from '~/lib/offlineQueue';
import { clearPendingEntry, discardQueuedEntry, setPendingEntry } from '~/lib/pendingEntries';
import { usePreferences } from '~/lib/preferences';
import { undoAutoClose } from '~/lib/undoDuration';
import { useCategories, useCreateTransaction, useDeleteTransaction } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

// Module-level so that saves made from different components (the Add sheet,
// the Due card) still replace each other's notification: only the most
// recent save's Undo is on screen at a time.
let latestSaveToastId: string | null = null;

export interface SaveHandle {
  // What was saved, e.g. "£4.80 · Dining", for wording an Undo button.
  label: string;
  undo: () => void;
}

export interface SaveOptions {
  // For a category that was only just created, which the loaded list does not have yet.
  categoryName?: string;
  onUndo?: () => void;
  // Called as soon as the save starts, so a caller can offer its own Undo
  // (for example inside a sheet that stays open) alongside the notification.
  onSaveStarted?: (handle: SaveHandle) => void;
}

export function useSaveWithUndo(): (input: TransactionInput, options?: SaveOptions) => Promise<Transaction | null> {
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const qc = useQueryClient();
  const userSub = useAuth0().user?.sub ?? '';
  const [{ undoDuration }] = usePreferences();

  // "£3.50 · Coffee", with the day added when the entry is not for today: "£3.50 · Coffee · Mon 22 Sep".
  function describeInput(input: TransactionInput, categoryName?: string): string {
    const name = categoryName ?? categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    const base = `${formatPence(input.amount)} · ${name}`;
    const day = formatDayLabel(input.date, todayIso());
    return day === 'Today' ? base : `${base} · ${day}`;
  }

  function showFailureToast(input: TransactionInput, options?: SaveOptions): void {
    const toastId = `failed-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      color: 'danger',
      autoClose: false,
      closeButtonProps: { 'aria-label': 'Close notification' },
      message: (
        <ToastAction
          text={`Couldn't save ${describeInput(input, options?.categoryName)}`}
          actionLabel="Retry"
          onAction={() => {
            notifications.hide(toastId);
            void save(input, options);
          }}
        />
      ),
    });
  }

  function showSaveToast(toastId: string, text: string, onUndo: () => void): void {
    if (latestSaveToastId && latestSaveToastId !== toastId) notifications.hide(latestSaveToastId);
    latestSaveToastId = toastId;
    // While it is still saving the message waits; the chosen time starts once it has settled.
    notifications.show({
      id: toastId,
      autoClose: false,
      withCloseButton: true,
      closeButtonProps: { 'aria-label': 'Close notification' },
      message: <ToastAction text={text} actionLabel="Undo" onAction={onUndo} />,
    });
  }

  function relabelSaveToast(toastId: string, text: string, onUndo: () => void): void {
    notifications.update({
      id: toastId,
      autoClose: undoAutoClose(undoDuration),
      message: <ToastAction text={text} actionLabel="Undo" onAction={onUndo} />,
    });
  }

  function save(input: TransactionInput, options?: SaveOptions): Promise<Transaction | null> {
    const toastId = `saved-${crypto.randomUUID()}`;
    const transactionId = crypto.randomUUID();
    const withId: TransactionInput = { ...input, transactionId };
    const queuedAt = new Date().toISOString();
    const description = describeInput(input, options?.categoryName);
    let undone = false;

    // Show the row immediately, the same instant Save is pressed, whether
    // this ends up an ordinary online create or a queued offline one — there
    // is only this one mechanism for "show it now", not a separate optimistic
    // insert plus a separate queued-row insert. `queued: false` here: this is
    // still just an in-flight attempt, not yet a durable offline entry, so it
    // must not show the banner, the pending badge, or a Discard action.
    setPendingEntry(qc, { id: transactionId, input, queuedAt, userSub, queued: false });

    const outcome: Promise<Transaction | null> = create.mutateAsync(withId).then(
      created => {
        if (!undone) relabelSaveToast(toastId, `Saved ${description}`, undo);
        return created;
      },
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
        // successful flush. The Undo notification stays open, relabelled.
        await enqueue({ id: transactionId, input, queuedAt, userSub });
        setPendingEntry(qc, { id: transactionId, input, queuedAt, userSub, queued: true });
        relabelSaveToast(toastId, `Saved offline · ${description}`, undo);
        return null;
      },
    );

    function undo(): void {
      if (undone) return;
      undone = true;
      notifications.hide(toastId);
      void outcome.then(async created => {
        if (created) {
          remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
          options?.onUndo?.();
          return;
        }
        // Not created yet: either still in flight (the rejection handler
        // above will see `undone` and discard it once it lands) or already
        // queued (discard it now).
        await discardQueuedEntry(qc, transactionId);
        options?.onUndo?.();
      });
    }

    showSaveToast(toastId, `Saving ${description}…`, undo);
    options?.onSaveStarted?.({ label: description, undo });

    return outcome;
  }

  return save;
}
