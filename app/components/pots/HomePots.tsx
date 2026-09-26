import { Link } from 'react-router';
import { Anchor, Group, Progress, Stack, Text, Title } from '@mantine/core';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence } from '~/lib/money';
import { goalPercent } from '~/lib/pots';
import type { Category, PotSummary } from '~/lib/types';

function formatBalance(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence);
}

function isShown(pot: PotSummary): boolean {
  return pot.balance !== 0 || pot.goalAmount !== null || pot.monthlyAmount !== null;
}

export function HomePots({ pots, categories }: { pots: PotSummary[]; categories: Category[] }) {
  const categoryById = new Map(categories.map(c => [c.categoryId, c]));
  const rows = pots
    .filter(isShown)
    .map(pot => ({ pot, category: categoryById.get(pot.categoryId) }))
    .filter((row): row is { pot: PotSummary; category: Category } => row.category !== undefined);
  if (rows.length === 0) return null;

  return (
    <div>
      <Title order={5} mb="xs">Pots</Title>
      {rows.map(({ pot, category }) => {
        const percent = goalPercent(pot.balance, pot.goalAmount);
        return (
          <Stack key={pot.categoryId} gap={4} mb="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={500}>{categoryLabel(category)}</Text>
              <Text fw={600} c={pot.balance < 0 ? 'danger' : undefined}>{formatBalance(pot.balance)}</Text>
            </Group>
            {pot.goalAmount !== null && (
              <>
                <Progress value={percent ?? 0} aria-label={`${category.name} goal progress`} />
                <Text size="xs" c="dimmed">{formatPence(Math.max(0, pot.balance))} of {formatPence(pot.goalAmount)}</Text>
              </>
            )}
          </Stack>
        );
      })}
      <Anchor component={Link} to="/pots" size="sm">See all pots</Anchor>
    </div>
  );
}
