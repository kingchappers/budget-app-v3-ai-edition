import { useEffect, useState } from 'react';

// `value` must be referentially stable between renders (e.g. React Query data),
// otherwise the effect would set state on every render.
export function useSnapshotWhileOpen<T>(value: T | undefined, opened: boolean): T | undefined {
  const [snapshot, setSnapshot] = useState(value);

  useEffect(() => {
    if (!opened || snapshot === undefined) setSnapshot(value);
  }, [opened, value, snapshot]);

  return snapshot;
}
