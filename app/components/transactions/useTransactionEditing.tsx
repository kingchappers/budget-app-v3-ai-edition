import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RecurringForm, type RecurringDraft } from '~/components/recurring/RecurringForm';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
import { useDeleteTransaction } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export interface TransactionRowActions {
  pending: boolean;
  pendingError?: string;
  onEdit: (t: Transaction) => void;
  onDuplicate: (t: Transaction) => void;
  onRepeat: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
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
  const { pendingMap, discard } = useOfflineQueue();

  const rowActions = (t: Transaction): TransactionRowActions => ({
    pending: pendingMap[t.transactionId]?.queued === true,
    pendingError: pendingMap[t.transactionId]?.lastError,
    onEdit: setEditing,
    onDuplicate: setDuplicating,
    onRepeat: setRepeating,
    onDelete: item => remove.mutate({ transactionId: item.transactionId, yearMonth: item.yearMonth }),
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
