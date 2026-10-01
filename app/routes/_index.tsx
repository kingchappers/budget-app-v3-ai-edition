import { useMemo } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { RELEASE_NOTES } from '~/lib/glossary';
import { WelcomeBackCard } from '~/components/budget/WelcomeBackCard';
import { WhatsChanged } from '~/components/layout/WhatsChanged';
import { GuidedTour } from '~/components/layout/GuidedTour';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { CategoryProgressRow } from '~/components/budget/CategoryProgressRow';
import { HomeSummary, OtherSpendingRow } from '~/components/budget/HomeSummary';
import { TargetsOptionalCard } from '~/components/budget/TargetsOptionalCard';
import { HomePots } from '~/components/pots/HomePots';
import { DueRecurringCard } from '~/components/recurring/DueRecurringCard';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { useTransactionEditing } from '~/components/transactions/useTransactionEditing';
import { groupItems, bucketKeyFor } from '~/lib/categoryGroups';
import { buildMonthSummary } from '~/lib/summary';
import type { CategoryProgress } from '~/lib/summary';
import { formatPence } from '~/lib/money';
import { currentYearMonth, formatMonthLabel, monthPhrase, shiftMonth } from '~/lib/months';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { useSelectedMonth } from '~/hooks/useSelectedMonth';
import { useCategories, usePots, useTargets, useTransactions } from '~/lib/queries';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/_index';

function categoryTransactionsUrl(yearMonth: string, categoryId: string): string {
  return `/transactions?month=${yearMonth}&category=${encodeURIComponent(categoryId)}`;
}

function GroupedProgress({ items, yearMonth }: { items: CategoryProgress[]; yearMonth: string }) {
  return (
    <>
      {groupItems(items, p => bucketKeyFor({ group: p.group, type: 'EXPENSE' }), p => p.name).map(bucket => (
        <div key={bucket.key}>
          <Text size="sm" fw={600} mb={4}>{bucket.label}</Text>
          {bucket.items.map(p => (
            <CategoryProgressRow key={p.categoryId} progress={p} to={categoryTransactionsUrl(yearMonth, p.categoryId)} />
          ))}
        </div>
      ))}
    </>
  );
}

function HomeContent() {
  const [yearMonth, setYearMonth] = useSelectedMonth();
  useDocumentTitle(pageTitle('Home', formatMonthLabel(yearMonth)));
  const categories = useCategories();
  const targets = useTargets();
  const transactions = useTransactions(yearMonth);
  const potsEnabled = yearMonth <= shiftMonth(currentYearMonth(), 1);
  const pots = usePots(yearMonth, potsEnabled);
  const { rowActions, sheets } = useTransactionEditing(yearMonth);

  const isLoading = categories.isLoading || targets.isLoading || transactions.isLoading;
  const error = categories.error || targets.error || transactions.error;

  const summary = useMemo(() => buildMonthSummary({
    transactions: transactions.data ?? [],
    categories: categories.data ?? [],
    targets: targets.data ?? [],
    yearMonth,
  }), [transactions.data, categories.data, targets.data, yearMonth]);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';

  const iconFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.icon ?? 'tag';

  if (error) {
    return (
      <Alert color="danger" title="Could not load your budget">
        <Text mb="sm">Something went wrong fetching this month.</Text>
        <Button onClick={() => { categories.refetch(); targets.refetch(); transactions.refetch(); }}>
          Try again
        </Button>
      </Alert>
    );
  }

  if (isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const hasTargets = summary.spending.length > 0;
  const phrase = monthPhrase(yearMonth);

  return (
    <Stack>
      <WhatsChanged releaseKey="menu-2026-10">{RELEASE_NOTES.menu}</WhatsChanged>
      <WhatsChanged releaseKey="names-2026-10">{RELEASE_NOTES.names}</WhatsChanged>
      <WelcomeBackCard />
      <DueRecurringCard />
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />
      <HomeSummary summary={summary} yearMonth={yearMonth} />

      {!hasTargets && <TargetsOptionalCard />}

      {hasTargets && (
        <div>
          <Title order={5} mb="xs">Spending vs budget</Title>
          <GroupedProgress items={summary.spending} yearMonth={yearMonth} />
          {summary.spentUnbudgeted > 0 && <OtherSpendingRow amount={summary.spentUnbudgeted} yearMonth={yearMonth} />}
        </div>
      )}

      {potsEnabled && (pots.error ? (
        <Text size="sm" c="dimmed">Could not load pots.</Text>
      ) : (
        <HomePots pots={pots.data ?? []} categories={categories.data ?? []} />
      ))}

      <Group justify="space-between">
        <Text>Income {phrase}</Text>
        <Text fw={600}>{formatPence(summary.incomeTotal)}</Text>
      </Group>

      <div>
        <Title order={5} mb="xs">Recent</Title>
        {summary.recent.length === 0
          ? <Text c="dimmed" size="sm">Nothing logged {phrase}.</Text>
          : summary.recent.map(t => (
              <TransactionRow
                key={t.transactionId}
                transaction={t}
                categoryName={nameFor(t.categoryId)}
                categoryIcon={iconFor(t.categoryId)}
                {...rowActions(t)}
              />
            ))}
        <Button component={Link} to={`/transactions?month=${yearMonth}`} variant="subtle" mt="xs">See all</Button>
      </div>

      <Button component={Link} to="/plan?tab=recurring" variant="subtle" style={{ alignSelf: 'flex-start' }}>
        Manage recurring
      </Button>

      {sheets}
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Home') }];

export default function Home() {
  return (
    <DefaultLayout>
      <HomeContent />
      <GuidedTour />
    </DefaultLayout>
  );
}
