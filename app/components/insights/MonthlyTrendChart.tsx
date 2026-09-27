import { LineChart } from '@mantine/charts';
import { Text } from '@mantine/core';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { MonthlyTrendRow } from '~/lib/insights';

export function MonthlyTrendChart({ rows }: { rows: MonthlyTrendRow[] }) {
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

  return (
    <LineChart
      h={220}
      data={data}
      dataKey="month"
      series={[
        { name: 'Income', color: 'teal.6' },
        { name: 'Spent', color: 'red.6' },
        { name: 'Saved', color: 'blue.6' },
      ]}
      valueFormatter={formatPence}
      withLegend
    />
  );
}
