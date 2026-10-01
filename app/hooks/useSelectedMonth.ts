import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { currentYearMonth, isYearMonth } from '~/lib/months';

// The month being looked at lives in the URL (?month=2026-08), so it survives a
// reload, can be shared as a link, and is the same on every page that shows a
// month. The current month is the default and keeps the URL clean.
export function useSelectedMonth(): [string, (yearMonth: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('month');
  const yearMonth = raw !== null && isYearMonth(raw) ? raw : currentYearMonth();

  const setYearMonth = useCallback((next: string): void => {
    setSearchParams(previous => {
      const params = new URLSearchParams(previous);
      if (next === currentYearMonth()) params.delete('month');
      else params.set('month', next);
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  return [yearMonth, setYearMonth];
}
