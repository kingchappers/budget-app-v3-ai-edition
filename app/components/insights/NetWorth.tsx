import { LineChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import { monthEndIso, netWorthAsOf } from '~/lib/accounts';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { Account } from '~/lib/types';

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
  const start = netWorthAsOf(accounts, monthEndIso(months[0]));

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={700} size="lg" c={current < 0 ? 'danger' : undefined}>{current < 0 ? `−${formatPence(-current)}` : formatPence(current)}</Text>
        <Text size="sm" c={current - start >= 0 ? 'teal' : 'red'}>{formatSigned(current - start)}</Text>
      </Group>
      <LineChart
        h={180}
        data={trend.map(row => ({ month: formatMonthLabel(row.yearMonth), 'Net worth': row.netWorth }))}
        dataKey="month"
        series={[{ name: 'Net worth', color: 'teal.6' }]}
        valueFormatter={formatPence}
        withDots={false}
      />
    </Stack>
  );
}
