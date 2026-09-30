import { LineChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import { monthEndIso, netWorthAsOf } from '~/lib/accounts';
import { CHART_COLORS } from '~/lib/chartColors';
import { netWorthSummary } from '~/lib/insightsText';
import { formatMonthLabel, shiftMonth } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { Account } from '~/lib/types';
import { ChartData } from './ChartData';

function formatSigned(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : `+${formatPence(pence)}`;
}

export function NetWorth({ accounts, months }: { accounts: Account[]; months: string[] }) {
  if (accounts.length === 0) {
    return <Text c="dimmed" size="sm">No accounts yet. Add one on the Accounts page.</Text>;
  }

  const trend = months.map(yearMonth => ({
    yearMonth,
    netWorth: netWorthAsOf(accounts, monthEndIso(yearMonth)),
  }));
  const current = trend[trend.length - 1]?.netWorth ?? 0;
  // The change is measured from the start of the span, i.e. the day before
  // its first month begins — not that month's own end, which would report
  // "This month" as always +£0 and would leave the first month's movement
  // out of a multi-month span.
  const start = netWorthAsOf(accounts, monthEndIso(shiftMonth(months[0], -1)));
  const change = current - start;

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={700} size="lg" c={current < 0 ? 'danger' : undefined}>{current < 0 ? `−${formatPence(-current)}` : formatPence(current)}</Text>
        <Text size="sm" c={change >= 0 ? 'primary' : 'danger'}>{formatSigned(change)}</Text>
      </Group>
      <ChartData
        summary={netWorthSummary(current, change)}
        caption="Net worth at the end of each month"
        columns={['Month', 'Net worth']}
        rows={trend.map(row => [formatMonthLabel(row.yearMonth), row.netWorth < 0 ? `−${formatPence(-row.netWorth)}` : formatPence(row.netWorth)])}
      >
        <LineChart
          h={180}
          data={trend.map(row => ({ month: formatMonthLabel(row.yearMonth), 'Net worth': row.netWorth }))}
          dataKey="month"
          series={[{ name: 'Net worth', color: CHART_COLORS.positive }]}
          valueFormatter={formatPence}
          withDots
        />
      </ChartData>
    </Stack>
  );
}
