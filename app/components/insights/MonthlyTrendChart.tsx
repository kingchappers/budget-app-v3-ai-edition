import { LineChart } from '@mantine/charts';
import { Text } from '@mantine/core';
import { CHART_COLORS, CHART_DASHES } from '~/lib/chartColors';
import type { MonthlyTrendRow, TrackingStatus } from '~/lib/insights';
import { trendSummary } from '~/lib/insightsText';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import { ChartData } from './ChartData';

const STATUS_WORDS: Record<TrackingStatus, string> = {
  tracked: 'Tracked',
  partly: 'Partly tracked',
  marked: 'Marked as not tracked',
};

export function MonthlyTrendChart({ rows, statuses = {} }: { rows: MonthlyTrendRow[]; statuses?: Record<string, TrackingStatus> }) {
  const hasActivity = rows.some(row => row.income > 0 || row.spent > 0 || row.saved !== 0);
  if (!hasActivity) {
    return <Text c="dimmed" size="sm">Nothing to show for this period.</Text>;
  }

  const data = rows.map(row => ({
    month: formatMonthLabel(row.yearMonth),
    Income: row.income,
    Spent: row.spent,
    Saved: row.saved,
  }));
  const showStatus = rows.some(row => (statuses[row.yearMonth] ?? 'tracked') !== 'tracked');

  return (
    <ChartData
      summary={`${trendSummary(rows)} Income is the solid line, spent is dashed and saved is dotted.`}
      caption="Income, spent and saved by month"
      columns={['Month', 'Income', 'Spent', 'Saved', ...(showStatus ? ['Tracking'] : [])]}
      rows={rows.map(row => [
        formatMonthLabel(row.yearMonth),
        formatPence(row.income),
        formatPence(row.spent),
        row.saved < 0 ? `−${formatPence(-row.saved)}` : formatPence(row.saved),
        ...(showStatus ? [STATUS_WORDS[statuses[row.yearMonth] ?? 'tracked']] : []),
      ])}
    >
      <LineChart
        h={220}
        data={data}
        dataKey="month"
        series={[
          { name: 'Income', color: CHART_COLORS.positive, strokeDasharray: CHART_DASHES.solid },
          { name: 'Spent', color: CHART_COLORS.negative, strokeDasharray: CHART_DASHES.dashed },
          { name: 'Saved', color: CHART_COLORS.info, strokeDasharray: CHART_DASHES.dotted },
        ]}
        valueFormatter={formatPence}
        withLegend
      />
    </ChartData>
  );
}
