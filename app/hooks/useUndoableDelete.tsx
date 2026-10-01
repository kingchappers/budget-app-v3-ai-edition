import { notifications } from '@mantine/notifications';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { ApiError } from '~/lib/apiError';
import { usePreferences } from '~/lib/preferences';
import { useRestoreFromTrash } from '~/lib/queries';
import { undoAutoClose } from '~/lib/undoDuration';
import type { TrashRef } from '~/lib/trash';

export interface UndoableDelete {
  // What was deleted, e.g. "£3.50 · Coffee", shown after "Deleted" and "Restored".
  label: string;
  // The short name used in follow-up messages, e.g. "Coffee".
  name: string;
  ref: TrashRef;
  run: () => Promise<unknown>;
}

function restoreFailureMessage(error: unknown, name: string): string {
  if (error instanceof ApiError && error.status === 409) {
    return `${name} is already in place, so it wasn't restored.`;
  }
  return `Couldn't restore ${name}. It's in Recently deleted.`;
}

function showMessage(message: string, autoClose: number | false): void {
  notifications.show({ message, autoClose });
}

export function useUndoableDelete(): (del: UndoableDelete) => void {
  const restore = useRestoreFromTrash();
  const [{ undoDuration }] = usePreferences();

  function undo(del: UndoableDelete): void {
    restore.mutateAsync(del.ref).then(
      () => showMessage(`Restored ${del.label}`, TOAST_MS),
      (error: unknown) => {
        console.error('Restore after undo failed', { entityType: del.ref.entityType, error });
        showMessage(restoreFailureMessage(error, del.name), false);
      },
    );
  }

  return (del: UndoableDelete): void => {
    const toastId = `deleted-${crypto.randomUUID()}`;

    const deleted = del.run().then(
      () => true,
      (error: unknown) => {
        console.error('Delete failed', { entityType: del.ref.entityType, error });
        notifications.hide(toastId);
        showMessage(`Couldn't delete ${del.name}. It's still here.`, false);
        return false;
      },
    );

    notifications.show({
      id: toastId,
      autoClose: undoAutoClose(undoDuration),
      withCloseButton: true,
      closeButtonProps: { 'aria-label': 'Close notification' },
      message: (
        <ToastAction
          text={`Deleted ${del.label}`}
          actionLabel="Undo"
          onAction={() => {
            notifications.hide(toastId);
            void deleted.then(ok => {
              if (ok) undo(del);
            });
          }}
        />
      ),
    });
  };
}
