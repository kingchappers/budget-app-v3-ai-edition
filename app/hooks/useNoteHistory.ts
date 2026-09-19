import { useMemo } from 'react';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import { buildNoteIndex, type NoteIndex } from '~/lib/noteMemory';
import { useTransactions } from '~/lib/queries';

export function useNoteHistory(opened: boolean): NoteIndex {
  const thisMonth = currentYearMonth();
  const current = useTransactions(thisMonth, opened).data;
  const previous = useTransactions(shiftMonth(thisMonth, -1), opened).data;
  const beforePrevious = useTransactions(shiftMonth(thisMonth, -2), opened).data;

  return useMemo(
    () => buildNoteIndex([...(current ?? []), ...(previous ?? []), ...(beforePrevious ?? [])]),
    [current, previous, beforePrevious],
  );
}
