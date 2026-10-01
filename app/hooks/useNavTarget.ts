import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { isYearMonth } from '~/lib/months';

// The pages that show one month at a time. Moving between them keeps the month.
const MONTH_PAGES: ReadonlySet<string> = new Set(['/', '/transactions', '/insights']);

// Returns a function that turns a nav path into a link target that carries the
// month currently being viewed, so switching pages doesn't jump back to today.
export function useNavTarget(): (to: string) => string {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('month');
  const month = raw !== null && isYearMonth(raw) ? raw : null;

  return useCallback((to: string): string => (
    month !== null && MONTH_PAGES.has(to) ? `${to}?month=${month}` : to
  ), [month]);
}
