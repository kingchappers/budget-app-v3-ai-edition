import { LineChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { PotSummary } from '~/lib/types';

export function PotsTrend({ pots }: { pots: PotSummary[] }) {
  const withHistory = pots.filter(pot => pot.months.length > 0);
  const totalReserved = pots.reduce((sum, pot) => sum + pot.balance, 0);

  if (withHistory.length === 0) {
    return <Text c="dimmed" size="sm">No pot activity to show for this period.</Text>;
  }

  return (
    <Stack gap="md">
      <Group gap={4}>
        <Text fw={600}>Total reserved:</Text>
        <Text fw={600}>{formatPence(totalReserved)}</Text>
      </Group>
      {withHistory.map(pot => (
        <div key={pot.categoryId}>
          <LineChart
            h={120}
            data={pot.months.map(month => ({ month: formatMonthLabel(month.yearMonth), Balance: month.closing }))}
            dataKey="month"
            series={[{ name: 'Balance', color: 'teal.6' }]}
            valueFormatter={formatPence}
            withDots={false}
          />
        </div>
      ))}
    </Stack>
  );
}
