import { Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import { formatDayLabel, todayIso } from '~/lib/months';
import type { BillsBeforePayday } from '~/lib/moneyAhead';

// What is coming before the next pay day, as plain facts. It does not subtract anything from anything:
// the figure above it is a budget, this is bills, and putting them together is the person's call.
export function MoneyAhead({ ahead }: { ahead: BillsBeforePayday }) {
  const days = ahead.daysToPayday === 1 ? 'tomorrow' : `in ${ahead.daysToPayday} days`;
  return (
    <Stack gap={2} aria-label="Before your next pay day" component="section">
      <Text>Next pay day: {formatDayLabel(ahead.payday, todayIso())}, {days}.</Text>
      <Text size="sm">
        {ahead.count === 0
          ? 'No bills are due before then.'
          : `Bills due before then: ${formatPence(ahead.total)} (${ahead.count} ${ahead.count === 1 ? 'bill' : 'bills'}).`}
      </Text>
    </Stack>
  );
}
