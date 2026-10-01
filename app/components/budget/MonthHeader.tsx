import { ActionIcon, Button, Group, Stack, Title, VisuallyHidden } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { currentYearMonth, formatMonthLabel, shiftMonth } from '~/lib/months';

// `pageTitle` is the page's own name for screen readers, since the month is only part of what the page is about.
export function MonthHeader({ yearMonth, onChange, pageTitle }: { yearMonth: string; onChange: (ym: string) => void; pageTitle?: string }) {
  const isCurrent = yearMonth === currentYearMonth();
  return (
    <Stack gap={4} mb="md" align="stretch">
      {pageTitle && <VisuallyHidden><Title order={1}>{pageTitle}</Title></VisuallyHidden>}
      <Group justify="space-between" wrap="nowrap">
        <ActionIcon variant="subtle" aria-label="Previous month" onClick={() => onChange(shiftMonth(yearMonth, -1))}>
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Title order={2} size="h3" ta="center" style={{ minWidth: 0 }}>{formatMonthLabel(yearMonth)}</Title>
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
