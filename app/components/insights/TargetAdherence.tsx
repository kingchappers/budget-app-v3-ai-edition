import { List, Text } from '@mantine/core';
import type { TargetAdherenceRow } from '~/lib/insights';

export function TargetAdherence({ rows }: { rows: TargetAdherenceRow[] }) {
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">No budgets set for this period.</Text>;
  }

  const sorted = [...rows].sort((a, b) => b.monthsOverTarget - a.monthsOverTarget);

  return (
    <List spacing="xs">
      {sorted.map(row => (
        <List.Item key={row.categoryId}>
          {row.name}: {row.monthsOverTarget} of {row.monthsInSpan} months over target
        </List.Item>
      ))}
    </List>
  );
}
