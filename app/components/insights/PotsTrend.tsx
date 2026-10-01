import { LineChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import { CHART_COLORS } from '~/lib/chartColors';
import type { Period } from '~/lib/insights';
import { potSummary } from '~/lib/insightsText';
import { NAMES } from '~/lib/glossary';
import { formatMonthLabel } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { Category, PotSummary } from '~/lib/types';
import { ChartData } from './ChartData';

interface PotWithMonthsInSpan {
  pot: PotSummary;
  name: string;
  monthsInSpan: PotSummary['months'];
}

export function PotsTrend({ pots, categories, current }: { pots: PotSummary[]; categories: Category[]; current: Period }) {
  const withHistory: PotWithMonthsInSpan[] = pots
    .map(pot => ({
      pot,
      name: categories.find(c => c.categoryId === pot.categoryId)?.name ?? 'Unknown pot',
      monthsInSpan: pot.months.filter(month => month.yearMonth >= current[0] && month.yearMonth <= current[1]),
    }))
    .filter(entry => entry.monthsInSpan.length > 0);
  const totalReserved = pots.reduce((sum, pot) => sum + pot.balance, 0);

  if (withHistory.length === 0) {
    return <Text c="dimmed" size="sm">No pot activity to show for this period.</Text>;
  }

  return (
    <Stack gap="md">
      <Group gap={4}>
        <Text fw={600}>{NAMES.totalInPots}:</Text>
        <Text fw={600}>{formatPence(totalReserved)}</Text>
      </Group>
      {withHistory.map(({ pot, name, monthsInSpan }) => (
        <div key={pot.categoryId}>
          <Text size="sm" fw={500} mb={4}>{name}</Text>
          <ChartData
            summary={potSummary(name, monthsInSpan)}
            caption={`${name} balance by month`}
            columns={['Month', 'Balance at end of month']}
            rows={monthsInSpan.map(month => [formatMonthLabel(month.yearMonth), formatPence(month.closing)])}
          >
            <LineChart
              h={120}
              data={monthsInSpan.map(month => ({ month: formatMonthLabel(month.yearMonth), Balance: month.closing }))}
              dataKey="month"
              series={[{ name: 'Balance', color: CHART_COLORS.info }]}
              valueFormatter={formatPence}
              withDots
            />
          </ChartData>
        </div>
      ))}
    </Stack>
  );
}
