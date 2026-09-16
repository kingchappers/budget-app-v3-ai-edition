import { useEffect, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useSyncStatus, useTriggerSync } from '~/lib/queries';
import { isSyncFinished, SYNC_MAX_WAIT_MS, syncErrorMessage } from '~/lib/sync';
import type { PendingSync } from '~/lib/types';

export function SyncNowButton() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingSync | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = useSyncStatus(pending);
  const trigger = useTriggerSync();

  useEffect(() => {
    if (!pending || !isSyncFinished(status.data, pending)) return;
    setPending(null);
    qc.invalidateQueries({ queryKey: queryKeys.inbox });
    qc.invalidateQueries({ queryKey: queryKeys.inboxCount });
    qc.invalidateQueries({ queryKey: queryKeys.connections });
  }, [pending, status.data, qc]);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), SYNC_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  function start() {
    setMessage(null);
    const baselineFinishedAt = status.data?.finishedAt ?? null;
    trigger.mutate(undefined, {
      onSuccess: () => setPending({ baselineFinishedAt, requestedAt: Date.now() }),
      onError: error => setMessage(syncErrorMessage(error)),
    });
  }

  const running = status.data?.state === 'RUNNING' || pending !== null || trigger.isPending;

  return (
    <Stack gap={4} align="flex-end">
      <Button variant="light" onClick={start} loading={running}>Sync now</Button>
      {message && <Text size="xs" c="dimmed">{message}</Text>}
    </Stack>
  );
}
