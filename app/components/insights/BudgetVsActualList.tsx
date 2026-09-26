import { Text, Title } from '@mantine/core';
import { CategoryProgressRow } from '~/components/budget/CategoryProgressRow';
import { formatPence } from '~/lib/money';
import { toProgress } from '~/lib/summary';
import type { CategoryProgress } from '~/lib/summary';
import type { Category, CategorySpendTrend, CategoryTarget } from '~/lib/types';

function byOverThenPercent(a: CategoryProgress, b: CategoryProgress): number {
  if (a.isOver !== b.isOver) return a.isOver ? -1 : 1;
  return b.percent - a.percent;
}

export interface BudgetVsActualListProps {
  categories: Category[];
  targets: CategoryTarget[];
  trends: CategorySpendTrend[];
  yearMonth: string;
  months: number;
}

export function BudgetVsActualList({ categories, targets, trends, yearMonth, months }: BudgetVsActualListProps) {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const trendById = new Map(trends.map(t => [t.categoryId, t]));

  const rows = targets
    .map(target => {
      const category = categoryById.get(target.categoryId);
      if (!category || category.type !== 'EXPENSE') return null;
      const trend = trendById.get(target.categoryId);
      const actual = trend ? trend.months[trend.months.length - 1].spent : 0;
      const average = trend?.average ?? 0;
      return { progress: toProgress(category, target, actual, yearMonth), average };
    })
    .filter((row): row is { progress: CategoryProgress; average: number } => row !== null)
    .sort((a, b) => byOverThenPercent(a.progress, b.progress));

  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">Set a target on a category to see it here.</Text>;
  }

  return (
    <div>
      <Title order={5} mb="xs">Budget vs actual</Title>
      {rows.map(({ progress, average }) => (
        <div key={progress.categoryId}>
          <CategoryProgressRow progress={progress} />
          <Text size="xs" c="dimmed" mt={-8} mb="sm">
            Avg over {months} months: {formatPence(average)}
          </Text>
        </div>
      ))}
    </div>
  );
}
