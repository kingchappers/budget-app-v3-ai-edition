import { ActionIcon, Button, Group, Stack, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { currentYearMonth, formatMonthLabel, shiftMonth } from '~/lib/months';

export function MonthHeader({ yearMonth, onChange }: { yearMonth: string; onChange: (ym: string) => void }) {
  const isCurrent = yearMonth === currentYearMonth();
  return (
    <Stack gap={4} mb="md" align="stretch">
      <Group justify="space-between">
        <ActionIcon variant="subtle" aria-label="Previous month" onClick={() => onChange(shiftMonth(yearMonth, -1))}>
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Title order={3}>{formatMonthLabel(yearMonth)}</Title>
        <ActionIcon variant="subtle" aria-label="Next month" onClick={() => onChange(shiftMonth(yearMonth, 1))}>
          <IconChevronRight size={20} />
        </ActionIcon>
      </Group>
      {!isCurrent && (
        <Button variant="light" size="compact-sm" style={{ alignSelf: 'center' }} onClick={() => onChange(currentYearMonth())}>
          Back to this month
        </Button>
      )}
    </Stack>
  );
}
