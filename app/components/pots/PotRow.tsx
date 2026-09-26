import { Badge, Button, Card, Group, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence } from '~/lib/money';
import { goalPercent, thisMonthSummary } from '~/lib/pots';
import type { Category, PotSummary } from '~/lib/types';

export interface PotRowProps {
  pot: PotSummary;
  category: Category;
  onSetAside: () => void;
  onOpen?: () => void;
}

function formatBalance(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence);
}

export function PotRow({ pot, category, onSetAside, onOpen }: PotRowProps) {
  const percent = goalPercent(pot.balance, pot.goalAmount);
  const activity = thisMonthSummary(pot);
  const name = categoryLabel(category);

  const details = (
    <Stack gap={4}>
      <Group gap="xs" wrap="wrap">
        <Text fw={500}>{name}</Text>
        {pot.autoAmountNow > 0 && <Badge size="xs" variant="light">Auto {formatPence(pot.autoAmountNow)}/mo</Badge>}
        {pot.balance < 0 && <Badge size="xs" variant="light" color="danger">Below zero</Badge>}
      </Group>
      <Text fw={700} size="lg" c={pot.balance < 0 ? 'danger' : undefined}>{formatBalance(pot.balance)}</Text>
      {pot.goalAmount !== null && (
        <>
          <Progress value={percent ?? 0} aria-label={`${category.name} goal progress`} />
          <Text size="xs" c="dimmed">{formatPence(Math.max(0, pot.balance))} of {formatPence(pot.goalAmount)}</Text>
        </>
      )}
      {activity && <Text size="xs" c="dimmed">{activity}</Text>}
    </Stack>
  );

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        {onOpen
          ? <UnstyledButton onClick={onOpen} style={{ flex: 1, minWidth: 0 }} aria-label={`Open ${category.name} history`}>{details}</UnstyledButton>
          : <div style={{ flex: 1, minWidth: 0 }}>{details}</div>}
        <Button size="compact-sm" variant="light" onClick={onSetAside} aria-label={`Set aside to ${category.name}`}>
          Set aside
        </Button>
      </Group>
    </Card>
  );
}
