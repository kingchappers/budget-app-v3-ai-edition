import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { Mover } from '~/lib/insights';

// Words carry the meaning; colour only backs them up.
function MoverRow({ mover, direction }: { mover: Mover; direction: 'more' | 'less' }) {
  return (
    <Group justify="space-between">
      <Text>{mover.name}</Text>
      <Text c={direction === 'more' ? 'attention' : 'success'}>{formatPence(Math.abs(mover.deltaPence))} {direction}</Text>
    </Group>
  );
}

export function BiggestMoversList({ up, down }: { up: Mover[]; down: Mover[] }) {
  if (up.length === 0 && down.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Stack gap="xs">
        <Text fw={600}>Up</Text>
        {up.map(mover => <MoverRow key={mover.categoryId} mover={mover} direction="more" />)}
      </Stack>
      <Stack gap="xs">
        <Text fw={600}>Down</Text>
        {down.map(mover => <MoverRow key={mover.categoryId} mover={mover} direction="less" />)}
      </Stack>
    </SimpleGrid>
  );
}
