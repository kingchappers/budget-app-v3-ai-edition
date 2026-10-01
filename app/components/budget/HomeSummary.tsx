import { Link } from 'react-router';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import { currentYearMonth, monthPhrase } from '~/lib/months';
import { leftToSpendSentence, type MonthSummary } from '~/lib/summary';

export function HomeSummary({ summary, yearMonth }: { summary: MonthSummary; yearMonth: string }) {
  const sentence = leftToSpendSentence(summary, yearMonth);
  return (
    <Stack gap="xs">
      {sentence && <Text size="lg" fw={600}>{sentence}</Text>}
      {sentence && (
        <Text size="sm">
          {summary.spentUnbudgeted > 0
            ? `This counts only categories with a budget. ${formatPence(summary.spentUnbudgeted)} of other spending is not included.`
            : 'This counts only categories with a budget.'}
        </Text>
      )}
      <Group justify="space-between">
        <Text>Spent {monthPhrase(yearMonth)}</Text>
        <Text fw={600}>{formatPence(summary.spentTotal)}</Text>
      </Group>
      <Group justify="space-between">
        <Text>Income {monthPhrase(yearMonth)}</Text>
        <Text fw={600}>{formatPence(summary.incomeTotal)}</Text>
      </Group>
      {summary.incomeTotal === 0 && yearMonth === currentYearMonth() && (
        <Text size="sm">No income recorded yet this month.</Text>
      )}
    </Stack>
  );
}

export function OtherSpendingRow({ amount, yearMonth }: { amount: number; yearMonth: string }) {
  return (
    <UnstyledButton
      component={Link}
      to={`/transactions?month=${yearMonth}&spending=untargeted`}
      display="block"
      py={4}
      style={{ borderRadius: 'var(--mantine-radius-sm)' }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>Other spending (no budget)</Text>
        <Group gap={4} wrap="nowrap">
          <Text fw={600}>{formatPence(amount)}</Text>
          <IconChevronRight size={16} aria-hidden color="var(--mantine-color-dimmed)" />
        </Group>
      </Group>
    </UnstyledButton>
  );
}
