import { List, Stack, Text } from '@mantine/core';
import type { TargetAdherenceRow } from '~/lib/insights';

function months(count: number): string {
  return `${count} ${count === 1 ? 'month' : 'months'}`;
}

// Leads with what went well, then where spending went over.
export function TargetAdherence({ rows }: { rows: TargetAdherenceRow[] }) {
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">No budgets set for this period.</Text>;
  }

  const counted = rows.filter(row => row.monthsInSpan > 0);
  if (counted.length === 0) {
    return <Text c="dimmed" size="sm">No finished, tracked months in this period to count against your budgets yet.</Text>;
  }

  const wentWell = [...counted].filter(row => row.monthsWithin > 0).sort((a, b) => b.monthsWithin / b.monthsInSpan - a.monthsWithin / a.monthsInSpan);
  const toLookAt = [...counted].filter(row => row.monthsOverTarget > 0).sort((a, b) => b.monthsOverTarget - a.monthsOverTarget);

  return (
    <Stack gap="sm">
      {wentWell.length > 0 && (
        <div>
          <Text fw={600}>Went well</Text>
          <List spacing="xs">
            {wentWell.map(row => (
              <List.Item key={row.categoryId}>
                {row.name}: within budget in {row.monthsWithin} of {months(row.monthsInSpan)}
              </List.Item>
            ))}
          </List>
        </div>
      )}
      {toLookAt.length > 0 && (
        <div>
          <Text fw={600}>Went over budget</Text>
          <List spacing="xs">
            {toLookAt.map(row => (
              <List.Item key={row.categoryId}>
                {row.name}: over budget in {row.monthsOverTarget} of {months(row.monthsInSpan)}
              </List.Item>
            ))}
          </List>
        </div>
      )}
    </Stack>
  );
}
