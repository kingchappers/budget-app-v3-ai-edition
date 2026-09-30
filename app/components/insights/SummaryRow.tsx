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

interface FigureProps {
  label: string;
  pence: number;
  // Null when there is nothing fair to compare with.
  previousPence: number | null;
  previousLabel: string;
  higherIsGood: boolean;
}

function Figure({ label, pence, previousPence, previousLabel, higherIsGood }: FigureProps) {
  if (previousPence === null) {
    return (
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">{label}</Text>
        <Text fw={700} size="lg">{formatPence(pence)}</Text>
        <Text size="xs" c="dimmed">Not compared</Text>
      </Paper>
    );
  }

  const deltaPence = pence - previousPence;
  const percent = percentChange(deltaPence, previousPence);
  const up = deltaPence >= 0;
  const good = up === higherIsGood;
  const color = good ? 'primary' : 'danger';
  const Arrow = up ? IconArrowUp : IconArrowDown;
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="lg">{formatPence(pence)}</Text>
      {deltaPence !== 0 && (
        <Group gap={4} wrap="nowrap" data-tone={good ? 'good' : 'bad'}>
          <Arrow size={12} color={`var(--mantine-color-${color}-6)`} />
          <Text size="xs" c={color}>
            {up ? '+' : '−'}{formatPence(Math.abs(deltaPence))}{percent !== null ? ` (${up ? '+' : '−'}${Math.abs(percent)}%)` : ''}
          </Text>
        </Group>
      )}
      <Text size="xs" c="dimmed">{previousLabel} {formatPence(previousPence)}</Text>
    </Paper>
  );
}

export interface SummaryRowProps {
  current: SummaryTotals;
  // Null when the period cannot be compared fairly.
  previous: SummaryTotals | null;
  // The previous period in words, e.g. "1–15 Aug".
  previousLabel?: string;
}

export function SummaryRow({ current, previous, previousLabel = 'Previous period' }: SummaryRowProps) {
  const figure = (key: keyof SummaryTotals, label: string, higherIsGood: boolean) => (
    <Figure
      label={label}
      pence={current[key]}
      previousPence={previous ? previous[key] : null}
      previousLabel={previousLabel}
      higherIsGood={higherIsGood}
    />
  );

  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      {figure('income', 'Income', true)}
      {figure('spent', 'Spent', false)}
      {figure('saved', 'Saved', true)}
      {figure('net', 'Net', true)}
    </SimpleGrid>
  );
}
