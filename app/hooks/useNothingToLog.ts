import { useCallback, useMemo } from 'react';
import { usePreferences } from '~/lib/preferences';

export interface NothingToLog {
  days: ReadonlySet<string>;
  mark: (days: string[]) => void;
  toggle: (day: string) => void;
}

// The days a user said they had nothing to log. Kept per user on this device.
export function useNothingToLog(userSub: string): NothingToLog {
  const [preferences, setPreferences] = usePreferences();
  const stored = preferences.nothingToLog[userSub];
  const days = useMemo(() => new Set(stored ?? []), [stored]);

  const write = useCallback((next: Set<string>): void => {
    setPreferences({ nothingToLog: { ...preferences.nothingToLog, [userSub]: [...next].sort() } });
  }, [preferences.nothingToLog, setPreferences, userSub]);

  const mark = useCallback((toAdd: string[]): void => write(new Set([...days, ...toAdd])), [days, write]);

  const toggle = useCallback((day: string): void => {
    const next = new Set(days);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    write(next);
  }, [days, write]);

  return { days, mark, toggle };
}
