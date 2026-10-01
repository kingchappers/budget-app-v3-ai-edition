import { useState } from 'react';
import { Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { LoadError } from '~/components/layout/LoadError';
import { notifications } from '@mantine/notifications';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { TOAST_MS } from '~/components/layout/ToastAction';
import { ApiError } from '~/lib/apiError';
import { useCategories, useRestoreFromTrash, useTrash } from '~/lib/queries';
import { groupTrash, trashEntryLabel, type TrashEntry } from '~/lib/trash';

const deletedAtFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

function entryKey(entry: TrashEntry): string {
  return `${entry.entityType}#${entry.id}`;
}

function restoreFailedMessage(error: unknown, label: string): string {
  if (error instanceof ApiError && error.status === 409) {
    return `${label} is already in place, so it wasn't restored.`;
  }
  return `Couldn't restore ${label}. It's still here, so you can try again.`;
}

interface DeletedRowProps {
  label: string;
  deletedAt: string;
  restoring: boolean;
  onRestore: () => void;
}

function DeletedRow({ label, deletedAt, restoring, onRestore }: DeletedRowProps) {
  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <div style={{ minWidth: 0 }}>
        <Text truncate>{label}</Text>
        <Text size="sm">Deleted {deletedAtFormat.format(new Date(deletedAt))}</Text>
      </div>
      <Button variant="light" size="compact-sm" loading={restoring} onClick={onRestore} aria-label={`Restore ${label}`}>
        Restore
      </Button>
    </Group>
  );
}

function DeletedContent() {
  const trash = useTrash();
  const categories = useCategories();
  const restore = useRestoreFromTrash();
  const [restoring, setRestoring] = useState<string | null>(null);

  function restoreEntry(entry: TrashEntry, label: string): void {
    const key = entryKey(entry);
    setRestoring(key);
    restore.mutateAsync({ entityType: entry.entityType, id: entry.id }).then(
      () => notifications.show({ message: `Restored ${label}`, autoClose: TOAST_MS }),
      (error: unknown) => {
        console.error('Restore from Recently deleted failed', { entityType: entry.entityType, error });
        notifications.show({ message: restoreFailedMessage(error, label), autoClose: false });
      },
    ).finally(() => setRestoring(current => (current === key ? null : current)));
  }

  const intro = (
    <>
      <Title order={1} size="h3">Recently deleted</Title>
      <Text c="dimmed" size="sm">Deleted items are kept for 30 days, then removed for good.</Text>
    </>
  );

  if (trash.error) {
    return (
      <Stack>
        {intro}
        <LoadError thing="recently deleted items" onRetry={() => trash.refetch()} />
      </Stack>
    );
  }

  if (trash.isLoading) {
    return <Stack>{intro}<Group justify="center" py="xl"><Loader /></Group></Stack>;
  }

  const groups = groupTrash(trash.data ?? []);

  return (
    <Stack>
      {intro}
      {groups.length === 0 && <Text c="dimmed">Nothing deleted in the last 30 days.</Text>}
      {groups.map(group => (
        <div key={group.entityType}>
          <Title order={2} size="h5" mt="md" mb="xs">{group.label}</Title>
          {group.entries.map(entry => {
            const label = trashEntryLabel(entry, categories.data ?? []);
            return (
              <DeletedRow
                key={entryKey(entry)}
                label={label}
                deletedAt={entry.deletedAt}
                restoring={restoring === entryKey(entry)}
                onRestore={() => restoreEntry(entry, label)}
              />
            );
          })}
        </div>
      ))}
    </Stack>
  );
}

export default function Deleted() {
  return (
    <DefaultLayout>
      <DeletedContent />
    </DefaultLayout>
  );
}
