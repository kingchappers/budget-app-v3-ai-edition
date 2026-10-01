import { useRef, useState } from 'react';
import { useUpdateCategory } from '~/lib/queries';
import type { Category } from '~/lib/types';

export const CATEGORY_NAME_ERROR = 'Enter a name from 1 to 50 characters';
const DEFAULT_FAILURE_MESSAGE = 'Could not rename. Try again.';

export function useInlineCategoryRename(
  category: Category | undefined,
  onError: (message: string) => void,
  failureMessage: string = DEFAULT_FAILURE_MESSAGE,
) {
  const update = useUpdateCategory();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category?.name ?? '');
  // Guards against committing twice, for example a double click on Save
  // before the field has unmounted.
  const committedRef = useRef(false);

  function start(): void {
    if (!category) return;
    committedRef.current = false;
    setDraft(category.name);
    setEditing(true);
  }

  function cancel(): void {
    committedRef.current = true;
    setEditing(false);
  }

  function commit(): void {
    if (committedRef.current || !category) return;
    committedRef.current = true;
    setEditing(false);

    const trimmed = draft.trim();
    if (trimmed === category.name) return;
    if (trimmed.length === 0 || trimmed.length > 50) {
      onError(CATEGORY_NAME_ERROR);
      return;
    }
    update.mutate(
      { categoryId: category.categoryId, name: trimmed },
      { onError: () => onError(failureMessage) },
    );
  }

  return { editing, draft, setDraft, start, cancel, commit };
}
