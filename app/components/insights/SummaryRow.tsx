import { Group, Paper, SimpleGrid, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import type { SummaryTotals } from '~/lib/insights';

function percentChange(deltaPence: number, previousPence: number): number | null {
  if (previousPence === 0) return null;
  // Divide by the previous period's magnitude, not its signed value, so the
  // percentage's sign always matches the pence change's direction even when
  // the previous period was itself negative (e.g. Net swinging from a loss
  // to a gain reads as a positive change, not an inverted one).
  return Math.round((deltaPence / Math.abs(previousPence)) * 100);
}

function Figure({
  label, pence, previousPence, higherIsGood,
}: {
  label: string;
  pence: number;
  previousPence: number;
  higherIsGood: boolean;
}) {
  const deltaPence = pence - previousPence;
  const percent = percentChange(deltaPence, previousPence);
  const up = deltaPence >= 0;
  const good = up === higherIsGood;
  const color = good ? 'success' : 'attention';
  const Arrow = up ? IconArrowUp : IconArrowDown;
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="lg">{formatPence(pence)}</Text>
      {deltaPence !== 0 && (
        <Group gap={4} wrap="nowrap" data-tone={good ? 'good' : 'bad'}>
          <Arrow size={12} color={`var(--mantine-color-${color}-text)`} aria-hidden />
          <Text size="xs" c={color}>
            {formatPence(Math.abs(deltaPence))} {up ? 'more' : 'less'}{percent !== null ? ` (${Math.abs(percent)}%)` : ''}
          </Text>
        </Group>
      )}
    </Paper>
  );
}

export function SummaryRow({ current, previous }: { current: SummaryTotals; previous: SummaryTotals }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      <Figure label="Income" pence={current.income} previousPence={previous.income} higherIsGood />
      <Figure label="Spent" pence={current.spent} previousPence={previous.spent} higherIsGood={false} />
      <Figure label="Saved" pence={current.saved} previousPence={previous.saved} higherIsGood />
      <Figure label="Net" pence={current.net} previousPence={previous.net} higherIsGood />
    </SimpleGrid>
  );
}
