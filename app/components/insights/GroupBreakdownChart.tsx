import { BarChart } from '@mantine/charts';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { GroupBreakdownRow } from '~/lib/insights';

export function GroupBreakdownChart({ rows, onSelectGroup }: { rows: GroupBreakdownRow[]; onSelectGroup: (group: string) => void }) {
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  const data = rows.map(row => ({ label: row.label, Current: row.current, Previous: row.previous }));

  return (
    <Stack gap="xs">
      <BarChart
        h={Math.max(160, rows.length * 50)}
        data={data}
        dataKey="label"
        series={[{ name: 'Current', color: 'teal.6' }, { name: 'Previous', color: 'gray.5' }]}
        orientation="vertical"
        valueFormatter={formatPence}
        withLegend
        withXAxis={false}
        withYAxis={false}
      />
      {rows.map(row => (
        <UnstyledButton key={row.group} onClick={() => onSelectGroup(row.group)}>
          <Group justify="space-between">
            <Text>{row.label}</Text>
            <Group gap={4}>
              <Text size="sm" c="dimmed">{formatPence(row.current)}</Text>
              <Text size="sm" c="dimmed">·</Text>
              <Text size="sm" c="dimmed">{formatPence(row.previous)}</Text>
            </Group>
          </Group>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
