import { ActionIcon, Group, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { formatMonthLabel, shiftMonth } from '~/lib/months';

export function MonthHeader({ yearMonth, onChange }: { yearMonth: string; onChange: (ym: string) => void }) {
  return (
    <Group justify="space-between" mb="md">
      <ActionIcon variant="subtle" aria-label="Previous month" onClick={() => onChange(shiftMonth(yearMonth, -1))}>
        <IconChevronLeft size={20} />
      </ActionIcon>
      <Title order={3}>{formatMonthLabel(yearMonth)}</Title>
      <ActionIcon variant="subtle" aria-label="Next month" onClick={() => onChange(shiftMonth(yearMonth, 1))}>
        <IconChevronRight size={20} />
      </ActionIcon>
    </Group>
  );
}
