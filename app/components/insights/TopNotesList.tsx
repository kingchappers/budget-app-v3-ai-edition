import { Group, Stack, Text, Title } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { TopNote } from '~/lib/types';

export function TopNotesList({ notes }: { notes: TopNote[] }) {
  if (notes.length === 0) {
    return <Text c="dimmed" size="sm">No notes to group yet in this window.</Text>;
  }

  return (
    <div>
      <Title order={5} mb="xs">Top merchants and notes</Title>
      <Stack gap="xs">
        {notes.map(note => (
          <Group key={note.note} justify="space-between" wrap="nowrap">
            <Text fw={500} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {note.note}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" c="dimmed">×{note.count}</Text>
              <Text fw={600}>{formatPence(note.total)}</Text>
            </Group>
          </Group>
        ))}
      </Stack>
    </div>
  );
}
