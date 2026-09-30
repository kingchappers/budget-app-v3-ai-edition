import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Group, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { CategoryProgress } from '~/lib/summary';

function remainingLabel(spent: number, target: number): string {
  const left = target - spent;
  return left < 0 ? `${formatPence(-left)} over` : `${formatPence(left)} left`;
}

export function CategoryProgressRow({ progress, to }: { progress: CategoryProgress; to?: string }) {
  const { name, spent, target, percent, isOver, period, rawTarget } = progress;
  const content: ReactNode = (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>{name}</Text>
        <Text fw={600}>{remainingLabel(spent, target)}</Text>
      </Group>
      <Progress value={Math.min(percent, 100)} color={isOver ? 'danger' : 'primary'} aria-label={`${name} progress`} />
      <Text size="sm">
        {formatPence(spent)} spent of {formatPence(target)}
        {period === 'WEEKLY' && ` · ${formatPence(rawTarget)}/wk`}
      </Text>
    </Stack>
  );

  if (!to) return <div style={{ marginBottom: 'var(--mantine-spacing-sm)' }}>{content}</div>;

  return (
    <UnstyledButton
      component={Link}
      to={to}
      display="block"
      mb="sm"
      style={{ borderRadius: 'var(--mantine-radius-sm)' }}
    >
      {content}
    </UnstyledButton>
  );
}
