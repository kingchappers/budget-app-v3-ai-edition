import { BarChart } from '@mantine/charts';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { CHART_COLORS } from '~/lib/chartColors';
import { formatPence } from '~/lib/money';
import type { GroupBreakdownRow } from '~/lib/insights';
import { groupSummary } from '~/lib/insightsText';
import { ChartData } from './ChartData';

export interface GroupBreakdownChartProps {
  rows: GroupBreakdownRow[];
  onSelectGroup: (group: string) => void;
  // Names of the two periods in words, e.g. "Apr–Sep 2026". Empty when there is nothing to compare with.
  currentLabel?: string;
  previousLabel?: string;
}

export function GroupBreakdownChart({ rows, onSelectGroup, currentLabel = '', previousLabel = '' }: GroupBreakdownChartProps) {
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  const compared = previousLabel !== '';
  const thisName = currentLabel || 'This period';
  const data = rows.map(row => (compared
    ? { label: row.label, [thisName]: row.current, [previousLabel]: row.previous }
    : { label: row.label, [thisName]: row.current }));
  const series = compared
    ? [{ name: thisName, color: CHART_COLORS.info }, { name: previousLabel, color: CHART_COLORS.neutral }]
    : [{ name: thisName, color: CHART_COLORS.info }];

  return (
    <ChartData
      summary={groupSummary(rows, previousLabel)}
      caption="Spending by group"
      columns={compared ? ['Group', thisName, previousLabel] : ['Group', thisName]}
      rows={rows.map(row => (compared
        ? [row.label, formatPence(row.current), formatPence(row.previous)]
        : [row.label, formatPence(row.current)]))}
    >
      <Stack gap="xs">
        <BarChart
          h={Math.max(160, rows.length * 50)}
          data={data}
          dataKey="label"
          series={series}
          orientation="vertical"
          valueFormatter={formatPence}
          withLegend
          withXAxis={false}
          withYAxis={false}
        />
        {rows.map(row => (
          <UnstyledButton key={row.group} onClick={() => onSelectGroup(row.group)} style={{ minHeight: 44 }}>
            <Group justify="space-between" wrap="wrap">
              <Text>{row.label}</Text>
              <Text size="sm">
                {compared
                  ? `${thisName} ${formatPence(row.current)} · ${previousLabel} ${formatPence(row.previous)}`
                  : `${thisName} ${formatPence(row.current)}`}
              </Text>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </ChartData>
  );
}
