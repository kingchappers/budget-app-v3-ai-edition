import { Button, Group, Stack, Text } from '@mantine/core';
import type { MonthCoverage, TrackingStatus } from '~/lib/insights';
import { formatMonthLabel } from '~/lib/months';

export interface TrackedMonth {
  coverage: MonthCoverage;
  status: TrackingStatus;
}

function describe({ coverage, status }: TrackedMonth): string {
  const days = `entries on ${coverage.daysWithEntries} of ${coverage.daysCounted} ${coverage.daysCounted === 1 ? 'day' : 'days'}`;
  if (status === 'marked') return `Marked as not tracked (${days})`;
  if (status === 'partly') return `Partly tracked (${days})`;
  return `Tracked (${days})`;
}

// Says how much of each month was logged, and lets a month be left out of comparisons.
export function TrackingList({ months, onMark, onInclude }: {
  months: TrackedMonth[];
  onMark: (yearMonth: string) => void;
  onInclude: (yearMonth: string) => void;
}) {
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        Months with entries on fewer than a quarter of their days are left out of comparisons and budget counts.
        You can also leave a month out yourself, for example if you were away.
      </Text>
      {months.map(month => {
        const { yearMonth } = month.coverage;
        const label = formatMonthLabel(yearMonth);
        return (
          <Group key={yearMonth} justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Text fw={500}>{label}</Text>
              <Text size="sm" c="dimmed">{describe(month)}</Text>
            </div>
            {month.status === 'marked' ? (
              <Button variant="subtle" size="compact-sm" aria-label={`Include ${label} again`} onClick={() => onInclude(yearMonth)}>
                Include again
              </Button>
            ) : (
              <Button variant="subtle" size="compact-sm" aria-label={`Mark ${label} as not tracked`} onClick={() => onMark(yearMonth)}>
                Mark as not tracked
              </Button>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
