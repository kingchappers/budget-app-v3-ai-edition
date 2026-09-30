import { TermHelp } from '~/components/layout/TermHelp';
import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { SummaryRow } from '~/components/insights/SummaryRow';
import { GroupBreakdownChart } from '~/components/insights/GroupBreakdownChart';
import { MonthlyTrendChart } from '~/components/insights/MonthlyTrendChart';
import { BiggestMoversList } from '~/components/insights/BiggestMovers';
import { TargetAdherence } from '~/components/insights/TargetAdherence';
import { PotsTrend } from '~/components/insights/PotsTrend';
import { NetWorth } from '~/components/insights/NetWorth';
import {
  biggestMovers, canGoNewer, categoriesInGroup, fetchRangeForAnchor, groupBreakdown, monthlyTrend, monthsInPeriod, splitPeriods, summaryTotals, targetAdherence,
} from '~/lib/insights';
import { currentYearMonth, formatMonthLabel, shiftMonth } from '~/lib/months';
import { formatPence } from '~/lib/money';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { useAccounts, useCategories, usePots, useTargets, useTransactionsRange } from '~/lib/queries';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/insights';

const SPAN_OPTIONS = [
  { label: 'This month', value: '1' },
  { label: '3M', value: '3' },
  { label: '6M', value: '6' },
  { label: '12M', value: '12' },
];

function periodLabel(from: string, to: string): string {
  return from === to ? formatMonthLabel(from) : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`;
}

function InsightsContent() {
  const [months, setMonths] = useState(6);
  const [anchor, setAnchor] = useState(currentYearMonth());
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const { from, to } = fetchRangeForAnchor(anchor, months);
  const { current, previous } = splitPeriods(from, to);
  useDocumentTitle(pageTitle('Insights', periodLabel(current[0], current[1])));

  const categories = useCategories();
  const targets = useTargets();
  const pots = usePots(anchor);
  const range = useTransactionsRange(from, to);
  const accounts = useAccounts();

  if (categories.error || targets.error || pots.error || range.error) {
    return (
      <Alert color="danger" title="Could not load insights">
        <Button onClick={() => { categories.refetch(); targets.refetch(); pots.refetch(); range.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || targets.isLoading || pots.isLoading || range.isLoading) {
    return <Group justify="center" py="xl"><Loader /></Group>;
  }

  const transactions = range.data ?? [];
  const currentTotals = summaryTotals(transactions, current);
  const previousTotals = summaryTotals(transactions, previous);
  const breakdown = groupBreakdown(transactions, categories.data ?? [], current, previous);
  const trend = monthlyTrend(transactions, monthsInPeriod(current));
  const drillDown = openGroup ? categoriesInGroup(transactions, categories.data ?? [], openGroup, current) : [];
  const openGroupLabel = breakdown.find(row => row.group === openGroup)?.label ?? '';
  const movers = biggestMovers(transactions, categories.data ?? [], current, previous);
  const adherence = targetAdherence(transactions, categories.data ?? [], targets.data ?? [], monthsInPeriod(current));

  return (
    <Stack>
      <Title order={3}>Insights</Title>
      <SegmentedControl
        value={String(months)}
        onChange={value => setMonths(Number(value))}
        data={SPAN_OPTIONS}
      />
      <Group justify="space-between">
        <ActionIcon variant="subtle" aria-label="Earlier" onClick={() => setAnchor(shiftMonth(anchor, -months))}>
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Text fw={600}>{periodLabel(current[0], current[1])}</Text>
        <ActionIcon variant="subtle" aria-label="Later" disabled={!canGoNewer(anchor)} onClick={() => {
          const next = shiftMonth(anchor, months);
          setAnchor(next > currentYearMonth() ? currentYearMonth() : next);
        }}>
          <IconChevronRight size={20} />
        </ActionIcon>
      </Group>
      <SummaryRow current={currentTotals} previous={previousTotals} />

      <Title order={5} mt="md">Spending by group</Title>
      <GroupBreakdownChart rows={breakdown} onSelectGroup={setOpenGroup} />

      <Title order={5} mt="md">Monthly trend</Title>
      <MonthlyTrendChart rows={trend} />

      <Title order={5} mt="md">Biggest movers</Title>
      <BiggestMoversList up={movers.up} down={movers.down} />

      <Title order={5} mt="md">Targets</Title>
      <TargetAdherence rows={adherence} />

      <Title order={5} mt="md">Pots</Title>
      <PotsTrend pots={pots.data ?? []} categories={categories.data ?? []} current={current} />

      <Group gap={0} mt="md">
        <Title order={5}>Net worth</Title>
        <TermHelp terms={['netWorth']} />
      </Group>
      <NetWorth accounts={accounts.data ?? []} months={monthsInPeriod(current)} />

      <ResponsiveSheet opened={openGroup !== null} onClose={() => setOpenGroup(null)} title={openGroupLabel}>
        <Stack>
          {drillDown.map(row => (
            <Group key={row.categoryId} justify="space-between">
              <Text>{row.name}</Text>
              <Text>{formatPence(row.spentPence)}</Text>
            </Group>
          ))}
        </Stack>
      </ResponsiveSheet>
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Insights') }];

export default function Insights() {
  return (
    <DefaultLayout>
      <InsightsContent />
    </DefaultLayout>
  );
}
