import { TermHelp } from '~/components/layout/TermHelp';
import { useState } from 'react';
import { useSelectedMonth } from '~/hooks/useSelectedMonth';
import { Button, Group, Input, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { LoadError } from '~/components/layout/LoadError';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { CollapsibleSection } from '~/components/insights/CollapsibleSection';
import { InsightsHeadline } from '~/components/insights/InsightsHeadline';
import { Milestones } from '~/components/insights/Milestones';
import { SummaryRow } from '~/components/insights/SummaryRow';
import { TrackingList, type TrackedMonth } from '~/components/insights/TrackingList';
import { GroupBreakdownChart } from '~/components/insights/GroupBreakdownChart';
import { MonthlyTrendChart } from '~/components/insights/MonthlyTrendChart';
import { BiggestMoversList } from '~/components/insights/BiggestMovers';
import { TargetAdherence } from '~/components/insights/TargetAdherence';
import { PotsTrend } from '~/components/insights/PotsTrend';
import { NetWorth } from '~/components/insights/NetWorth';
import {
  biggestMovers, canGoNewer, categoriesInGroup, countableMonths, fetchRangeForAnchor, groupBreakdown, monthCoverage, monthRange, monthlyTrend,
  monthsInPeriod, monthTargetOutcome, planComparison, reachedPotGoals, splitPeriods, summaryTotals, targetAdherence, trackingStatus,
  type Slice, type TrackingStatus,
} from '~/lib/insights';
import { headlineSentences, leftOutNote } from '~/lib/insightsText';
import { currentYearMonth, formatMonthLabel, shiftMonth, todayIso } from '~/lib/months';
import { usePreferences } from '~/lib/preferences';
import { formatPence } from '~/lib/money';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { useAccounts, useCategories, usePots, useTargets, useTransactionsRange } from '~/lib/queries';
import { NAMES } from '~/lib/glossary';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/insights';

const SPAN_OPTIONS = [
  { label: 'This month', value: '1' },
  { label: '3 months', value: '3' },
  { label: '6 months', value: '6' },
  { label: '12 months', value: '12' },
];

function periodLabel(from: string, to: string): string {
  return from === to ? formatMonthLabel(from) : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`;
}

const NOTHING: Slice = { months: [], cap: null };

function InsightsContent() {
  const [preferences, setPreferences] = usePreferences();
  const [months, setMonths] = useState(6);
  const [anchor, setAnchor] = useSelectedMonth();
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
      <LoadError thing="insights" onRetry={() => { categories.refetch(); targets.refetch(); pots.refetch(); range.refetch(); }} />
    );
  }
  if (categories.isLoading || targets.isLoading || pots.isLoading || range.isLoading) {
    return <Group justify="center" py="xl"><Loader /></Group>;
  }

  const today = todayIso();
  const notTracked = preferences.notTrackedMonths;
  const transactions = range.data ?? [];
  const categoryList = categories.data ?? [];
  const targetList = targets.data ?? [];

  // Compare like with like: a month in progress against the same days of the one before,
  // and leave out any month (and its pair) that was barely tracked.
  const plan = planComparison(transactions, current, previous, today, notTracked);
  const currentScope = plan.comparable ? plan.current : current;
  const previousScope = plan.comparable ? plan.previous : NOTHING;
  const currentTotals = summaryTotals(transactions, currentScope);
  const previousTotals = plan.comparable ? summaryTotals(transactions, previousScope) : null;
  const breakdown = groupBreakdown(transactions, categoryList, currentScope, previousScope);
  const trendMonths = monthsInPeriod(current);
  const trend = monthlyTrend(transactions, trendMonths);
  const drillDown = openGroup ? categoriesInGroup(transactions, categoryList, openGroup, currentScope) : [];
  const openGroupLabel = breakdown.find(row => row.group === openGroup)?.label ?? '';
  const movers = plan.comparable ? biggestMovers(transactions, categoryList, currentScope, previousScope) : { up: [], down: [] };
  const countable = countableMonths(transactions, trendMonths, today, notTracked);
  const adherence = targetAdherence(transactions, categoryList, targetList, countable);
  const outcomes = countable
    .map(yearMonth => monthTargetOutcome(transactions, categoryList, targetList, yearMonth))
    .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== null);
  const headline = headlineSentences({
    plan,
    currentTotals,
    previousTotals: previousTotals ?? currentTotals,
    movers,
    outcomes,
  });

  const shownMonths: TrackedMonth[] = [...monthsInPeriod(previous), ...trendMonths].map(yearMonth => {
    const coverage = monthCoverage(transactions, yearMonth, today);
    return { coverage, status: trackingStatus(coverage, notTracked) };
  });
  const statuses: Record<string, TrackingStatus> = Object.fromEntries(shownMonths.map(month => [month.coverage.yearMonth, month.status]));

  const earlierAnchor = shiftMonth(anchor, -months);
  const laterAnchorRaw = shiftMonth(anchor, months);
  const laterAnchor = laterAnchorRaw > currentYearMonth() ? currentYearMonth() : laterAnchorRaw;
  const earlierLabel = monthRange(shiftMonth(earlierAnchor, -(months - 1)), earlierAnchor);
  const laterLabel = monthRange(shiftMonth(laterAnchor, -(months - 1)), laterAnchor);
  const note = plan.comparable
    ? [`Comparing ${plan.currentLabel} with ${plan.previousLabel}.`, leftOutNote(plan.leftOut)].filter(Boolean).join(' ')
    : null;

  return (
    <Stack>
      <Title order={1} size="h3">Insights</Title>
      <Input.Wrapper label="Show">
        <SegmentedControl
          fullWidth
          mt={4}
          // Four options do not fit side by side at the larger text sizes.
          orientation={preferences.textSize === 'standard' ? 'horizontal' : 'vertical'}
          value={String(months)}
          onChange={value => setMonths(Number(value))}
          data={SPAN_OPTIONS}
        />
      </Input.Wrapper>
      <Text fw={600} ta="center">{periodLabel(current[0], current[1])}</Text>
      <Group gap="xs" wrap="wrap" grow>
        <Button
          variant="subtle"
          leftSection={<IconChevronLeft size={18} />}
          aria-label={`Earlier: ${earlierLabel}`}
          onClick={() => setAnchor(earlierAnchor)}
          h="auto"
          mih={44}
          styles={{ label: { whiteSpace: 'normal' } }}
        >
          {earlierLabel}
        </Button>
        <Button
          variant="subtle"
          rightSection={<IconChevronRight size={18} />}
          aria-label={`Later: ${laterLabel}`}
          disabled={!canGoNewer(anchor)}
          onClick={() => setAnchor(laterAnchor)}
          h="auto"
          mih={44}
          styles={{ label: { whiteSpace: 'normal' } }}
        >
          {laterLabel}
        </Button>
      </Group>

      <InsightsHeadline sentences={headline} />
      <SummaryRow current={currentTotals} previous={previousTotals} previousLabel={plan.previousLabel} />
      {note && <Text size="sm" c="dimmed">{note}</Text>}

      <CollapsibleSection id="tracking" title="How much was tracked">
        <TrackingList
          months={shownMonths}
          onMark={yearMonth => setPreferences({ notTrackedMonths: [...new Set([...notTracked, yearMonth])].sort() })}
          onInclude={yearMonth => setPreferences({ notTrackedMonths: notTracked.filter(month => month !== yearMonth) })}
        />
      </CollapsibleSection>

      <CollapsibleSection id="groups" title="Spending by group">
        <GroupBreakdownChart
          rows={breakdown}
          onSelectGroup={setOpenGroup}
          currentLabel={plan.comparable ? plan.currentLabel : ''}
          previousLabel={plan.comparable ? plan.previousLabel : ''}
        />
      </CollapsibleSection>

      <CollapsibleSection id="trend" title="Monthly trend">
        <MonthlyTrendChart rows={trend} statuses={statuses} />
      </CollapsibleSection>

      <CollapsibleSection id="movers" title="Biggest movers">
        <BiggestMoversList up={movers.up} down={movers.down} comparedWith={plan.comparable ? plan.previousLabel : ''} />
      </CollapsibleSection>

      <CollapsibleSection id="targets" title={NAMES.budgets}>
        <TargetAdherence rows={adherence} />
      </CollapsibleSection>

      <CollapsibleSection id="pots" title="Pots">
        <PotsTrend pots={pots.data ?? []} categories={categoryList} current={current} />
      </CollapsibleSection>

      <CollapsibleSection id="netWorth" title="Net worth">
        <TermHelp terms={['netWorth']} />
        <NetWorth accounts={accounts.data ?? []} months={trendMonths} />
      </CollapsibleSection>

      {preferences.showMilestones && (
        <CollapsibleSection id="milestones" title="Milestones">
          <Milestones pots={reachedPotGoals(pots.data ?? [], categoryList)} months={outcomes} />
        </CollapsibleSection>
      )}

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
