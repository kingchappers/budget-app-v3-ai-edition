import { List, Text } from '@mantine/core';
import type { MonthTargetOutcome, PotMilestone } from '~/lib/insights';
import { formatMonthName } from '~/lib/months';
import { formatPence } from '~/lib/money';

function outcomeText({ yearMonth, targeted, spent }: MonthTargetOutcome): string | null {
  const month = formatMonthName(yearMonth);
  if (spent < targeted) return `${month} finished ${formatPence(targeted - spent)} under budget.`;
  if (spent === targeted) return `${month} finished on budget.`;
  return null;
}

// Acknowledges outcomes only, never consistency: no streaks, no counts of days in a row.
export function Milestones({ pots, months }: { pots: PotMilestone[]; months: MonthTargetOutcome[] }) {
  const lines = [
    ...pots.map(pot => `${pot.name}: goal reached.`),
    ...months.map(outcomeText).filter((line): line is string => line !== null),
  ];

  if (lines.length === 0) {
    return <Text c="dimmed" size="sm">Nothing to note for this period.</Text>;
  }

  return (
    <List spacing="xs" listStyleType="none" aria-label="Milestones">
      {lines.map(line => <List.Item key={line}>{line}</List.Item>)}
    </List>
  );
}
