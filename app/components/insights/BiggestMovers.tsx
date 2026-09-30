import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { Mover } from '~/lib/insights';

function MoverRow({ mover, sign }: { mover: Mover; sign: '+' | '−' }) {
  return (
    <Group justify="space-between">
      <Text>{mover.name}</Text>
      <Text c={sign === '+' ? 'red' : 'teal'}>{sign}{formatPence(Math.abs(mover.deltaPence))}</Text>
    </Group>
  );
}

export interface BiggestMoversListProps {
  up: Mover[];
  down: Mover[];
  // What the change is measured against, in words, e.g. "1–15 Aug". Empty when there is no fair comparison.
  comparedWith?: string;
}

export function BiggestMoversList({ up, down, comparedWith }: BiggestMoversListProps) {
  if (comparedWith === '') {
    return <Text c="dimmed" size="sm">Not compared, because the months needed were only partly tracked.</Text>;
  }
  if (up.length === 0 && down.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }
  const against = comparedWith ? ` compared with ${comparedWith}` : '';

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Stack gap="xs">
        <Text fw={600}>{`Spending up${against}`}</Text>
        {up.map(mover => <MoverRow key={mover.categoryId} mover={mover} sign="+" />)}
      </Stack>
      <Stack gap="xs">
        <Text fw={600}>{`Spending down${against}`}</Text>
        {down.map(mover => <MoverRow key={mover.categoryId} mover={mover} sign="−" />)}
      </Stack>
    </SimpleGrid>
  );
}
