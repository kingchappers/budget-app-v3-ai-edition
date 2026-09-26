import { Group, Stack, Text, Title } from '@mantine/core';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence } from '~/lib/money';
import { PotTrend } from '~/components/pots/PotTrend';
import type { Category, CategorySpendTrend } from '~/lib/types';

const MAX_ROWS = 6;

export function CategoryTrendList({ trends, categories }: { trends: CategorySpendTrend[]; categories: Category[] }) {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const rows = trends
    .filter(t => t.total > 0)
    .map(trend => ({ trend, category: categoryById.get(trend.categoryId) }))
    .filter((row): row is { trend: CategorySpendTrend; category: Category } => row.category !== undefined)
    .slice(0, MAX_ROWS);

  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">No spending yet in this window.</Text>;
  }

  return (
    <div>
      <Title order={5} mb="xs">Category trends</Title>
      <Stack gap="sm">
        {rows.map(({ trend, category }) => (
          <div key={trend.categoryId}>
            <Group justify="space-between" mb={4}>
              <Text fw={500}>{categoryLabel(category)}</Text>
              <Text size="sm" c="dimmed">{formatPence(trend.total)}</Text>
            </Group>
            <PotTrend values={trend.months.map(m => m.spent)} label={`${category.name} spending trend`} />
          </div>
        ))}
      </Stack>
    </div>
  );
}
