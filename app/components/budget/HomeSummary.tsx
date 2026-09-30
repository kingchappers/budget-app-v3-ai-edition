import { Link } from 'react-router';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import { monthPhrase } from '~/lib/months';
import { leftToSpendSentence, type MonthSummary } from '~/lib/summary';

export function HomeSummary({ summary, yearMonth }: { summary: MonthSummary; yearMonth: string }) {
  const sentence = leftToSpendSentence(summary, yearMonth);
  return (
    <Stack gap="xs">
      {sentence && <Text size="lg" fw={600}>{sentence}</Text>}
      <Group justify="space-between">
        <Text c="dimmed">Spent {monthPhrase(yearMonth)}</Text>
        <Text fw={600}>{formatPence(summary.spentTotal)}</Text>
      </Group>
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
        <Text fw={500}>Other spending (no target)</Text>
        <Group gap={4} wrap="nowrap">
          <Text fw={600}>{formatPence(amount)}</Text>
          <IconChevronRight size={16} aria-hidden color="var(--mantine-color-dimmed)" />
        </Group>
      </Group>
    </UnstyledButton>
  );
}
