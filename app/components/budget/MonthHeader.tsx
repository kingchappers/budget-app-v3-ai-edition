import { ActionIcon, Group, Title, VisuallyHidden } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { formatMonthLabel, shiftMonth } from '~/lib/months';

// `pageTitle` is the page's own name for screen readers, since the month is only part of what the page is about.
export function MonthHeader({ yearMonth, onChange, pageTitle }: { yearMonth: string; onChange: (ym: string) => void; pageTitle: string }) {
  return (
    <>
      <VisuallyHidden><Title order={1}>{pageTitle}</Title></VisuallyHidden>
      <Group justify="space-between" mb="md">
        <ActionIcon variant="subtle" aria-label="Previous month" onClick={() => onChange(shiftMonth(yearMonth, -1))}>
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Title order={2} size="h3">{formatMonthLabel(yearMonth)}</Title>
        <ActionIcon variant="subtle" aria-label="Next month" onClick={() => onChange(shiftMonth(yearMonth, 1))}>
          <IconChevronRight size={20} />
        </ActionIcon>
      </Group>
    </>
  );
}
