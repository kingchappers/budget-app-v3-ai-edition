import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RecurringForm, type RecurringDraft } from '~/components/recurring/RecurringForm';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
import { useUndoableDelete } from '~/hooks/useUndoableDelete';
import { useCategories, useDeleteTransaction } from '~/lib/queries';
import { transactionLabel, transactionTrashId } from '~/lib/trash';
import type { Transaction } from '~/lib/types';

export interface TransactionRowActions {
  saving: boolean;
  pending: boolean;
  pendingError?: string;
  onEdit: (t: Transaction) => void;
  onDuplicate: (t: Transaction) => void;
  onRepeat: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  onRetry: () => void;
  onDiscard: (t: Transaction) => void;
}

export interface TransactionEditing {
  rowActions: (t: Transaction) => TransactionRowActions;
  sheets: ReactNode;
}

function toRecurringDraft(t: Transaction): RecurringDraft {
  return {
    type: t.type,
    categoryId: t.categoryId,
    amount: t.amount,
    description: t.description,
    dayOfMonth: Number(t.date.slice(8, 10)),
  };
}

export function useTransactionEditing(yearMonth: string): TransactionEditing {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [duplicating, setDuplicating] = useState<Transaction | null>(null);
  const [repeating, setRepeating] = useState<Transaction | null>(null);
  const repeatDraft = useMemo<RecurringDraft | null>(() => (repeating ? toRecurringDraft(repeating) : null), [repeating]);
  const remove = useDeleteTransaction();
  const undoableDelete = useUndoableDelete();
  const { data: categories } = useCategories();
  const { pendingMap, discard, flushNow } = useOfflineQueue();

  function deleteTransaction(item: Transaction): void {
    const categoryName = categories?.find(c => c.categoryId === item.categoryId)?.name ?? 'Unknown category';
    undoableDelete({
      label: transactionLabel(item, categoryName),
      name: item.description || categoryName,
      ref: { entityType: 'TRANSACTION', id: transactionTrashId(item) },
      run: () => remove.mutateAsync({ transactionId: item.transactionId, yearMonth: item.yearMonth }),
    });
  }

  const rowActions = (t: Transaction): TransactionRowActions => ({
    saving: pendingMap[t.transactionId]?.queued === false,
    pending: pendingMap[t.transactionId]?.queued === true,
    pendingError: pendingMap[t.transactionId]?.lastError,
    onEdit: setEditing,
    onDuplicate: setDuplicating,
    onRepeat: setRepeating,
    onDelete: deleteTransaction,
    onRetry: () => void flushNow(),
    onDiscard: item => void discard(item.transactionId),
  });

  const sheets = (
    <>
      <TransactionSheet
        opened={editing !== null || duplicating !== null}
        onClose={() => {
          setEditing(null);
          setDuplicating(null);
        }}
        yearMonth={yearMonth}
        editing={editing}
        template={duplicating}
      />
      <RecurringForm opened={repeating !== null} onClose={() => setRepeating(null)} draft={repeatDraft} />
    </>
  );

  return { rowActions, sheets };
}
