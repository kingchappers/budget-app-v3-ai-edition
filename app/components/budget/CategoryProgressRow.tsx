import { Group, Progress, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { CategoryProgress } from '~/lib/summary';

export function CategoryProgressRow({ progress }: { progress: CategoryProgress }) {
  const { name, spent, target, percent, isOver, period, rawTarget } = progress;
  return (
    <Stack gap={4} mb="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>{isOver ? `⚠ ${name}` : name}</Text>
        <Text size="sm" c={isOver ? 'red' : undefined}>
          {formatPence(spent)} / {formatPence(target)} · {percent}%
        </Text>
      </Group>
      <Progress value={Math.min(percent, 100)} color={isOver ? 'red' : 'teal'} aria-label={`${name} progress`} />
      {period === 'WEEKLY' && (
        <Text size="xs" c="dimmed">{formatPence(rawTarget)}/wk (≈{formatPence(target)}/mo)</Text>
      )}
    </Stack>
  );
}


// adding comment for redeloy