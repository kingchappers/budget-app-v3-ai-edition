import { Paper, SimpleGrid, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { SummaryTotals } from '~/lib/insights';

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Figure({ label, pence, previousPence }: { label: string; pence: number; previousPence: number }) {
  const change = percentChange(pence, previousPence);
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="lg">{formatPence(pence)}</Text>
      {change !== null && (
        <Text size="xs" c={change >= 0 ? 'teal' : 'red'}>{change >= 0 ? '+' : ''}{change}%</Text>
      )}
    </Paper>
  );
}

export function SummaryRow({ current, previous }: { current: SummaryTotals; previous: SummaryTotals }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      <Figure label="Income" pence={current.income} previousPence={previous.income} />
      <Figure label="Spent" pence={current.spent} previousPence={previous.spent} />
      <Figure label="Saved" pence={current.saved} previousPence={previous.saved} />
      <Figure label="Net" pence={current.net} previousPence={previous.net} />
    </SimpleGrid>
  );
}
