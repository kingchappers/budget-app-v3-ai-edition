import { useEffect, useRef } from 'react';
import { Button, Group, Paper, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useOfflineQueue } from '~/hooks/useOfflineQueue';
import { listQueue } from '~/lib/offlineQueue';
import { queryKeys } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

export function OfflineQueueBanner() {
  const { pendingMap, flushNow } = useOfflineQueue();
  const qc = useQueryClient();
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    async function hydrateThenFlush(): Promise<void> {
      const entries = await listQueue();
      for (const entry of entries) {
        const yearMonth = entry.input.date.slice(0, 7);
        const key = queryKeys.transactions(yearMonth);
        const previous = qc.getQueryData<Transaction[]>(key);
        if (previous !== undefined) {
          const row: Transaction = { ...entry.input, transactionId: entry.id, yearMonth, createdAt: entry.queuedAt };
          qc.setQueryData<Transaction[]>(key, [...previous.filter(t => t.transactionId !== entry.id), row]);
        }
      }
      qc.setQueryData<Record<string, { lastError?: string }>>(
        queryKeys.offlineQueue,
        () => Object.fromEntries(entries.map(e => [e.id, { lastError: e.lastError }])),
      );
      await flushNow();
    }

    void hydrateThenFlush();
  }, [qc, flushNow]);

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

  const count = Object.keys(pendingMap).length;
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
