import { useEffect, useRef } from 'react';
import { Button, Group, Paper, Text } from '@mantine/core';
import { useAuth } from '~/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
import { clearPendingEntriesForLogout, hydrateOnce } from '~/lib/pendingEntries';

export function OfflineQueueBanner() {
  const { pendingMap, flushNow } = useOfflineQueue();
  const qc = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const userSub = user?.sub;
  const wasAuthenticated = useRef(isAuthenticated);

  useEffect(() => {
    if (!userSub) return;
    // hydrateOnce guards itself at module level (per userSub), not with a
    // component ref, because every route renders its own <DefaultLayout> and
    // therefore its own instance of this banner: a ref-based guard would
    // reset, and re-hydrate, on every navigation.
    void hydrateOnce(qc, userSub).then(() => flushNow());
  }, [qc, userSub, flushNow]);

  useEffect(() => {
    if (wasAuthenticated.current && !isAuthenticated) {
      // Signed out: drop the reactive pending state so a different account
      // signing in on this device never sees it. The durable IndexedDB queue
      // is untouched — it's still tagged with the previous user's sub and
      // will hydrate back in correctly if they sign in again.
      clearPendingEntriesForLogout(qc);
    }
    wasAuthenticated.current = isAuthenticated;
  }, [isAuthenticated, qc]);

  useEffect(() => {
    function handleOnline(): void { void flushNow(); }
    function handleVisibility(): void {
      if (document.visibilityState === 'visible') void flushNow();
    }
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushNow]);

  // Only a durably queued entry counts here — an ordinary online save also
  // spends a moment in pendingMap, and shouldn't flash the banner too.
  const count = Object.values(pendingMap).filter(entry => entry.queued).length;
  if (count === 0) return null;

  return (
    <Paper withBorder p="xs" mb="sm">
      <Group justify="space-between">
        <Text size="sm">{count} waiting to sync</Text>
        <Button size="compact-sm" variant="light" onClick={() => void flushNow()}>Sync now</Button>
      </Group>
    </Paper>
  );
}
