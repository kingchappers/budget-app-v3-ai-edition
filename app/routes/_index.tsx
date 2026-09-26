import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { CategoryProgressRow } from '~/components/budget/CategoryProgressRow';
import { HomePots } from '~/components/pots/HomePots';
import { DueRecurringCard } from '~/components/recurring/DueRecurringCard';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { groupItems, bucketKeyFor } from '~/lib/categoryGroups';
import { buildMonthSummary } from '~/lib/summary';
import type { CategoryProgress } from '~/lib/summary';
import { formatPence } from '~/lib/money';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import { useCategories, usePots, useTargets, useTransactions } from '~/lib/queries';

function GroupedProgress({ items }: { items: CategoryProgress[] }) {
  return (
    <>
      {groupItems(items, p => bucketKeyFor({ group: p.group, type: 'EXPENSE' })).map(bucket => (
        <div key={bucket.key}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>{bucket.label}</Text>
          {bucket.items.map(p => <CategoryProgressRow key={p.categoryId} progress={p} />)}
        </div>
      ))}
    </>
  );
}

function HomeContent() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const categories = useCategories();
  const targets = useTargets();
  const transactions = useTransactions(yearMonth);
  const potsEnabled = yearMonth <= shiftMonth(currentYearMonth(), 1);
  const pots = usePots(yearMonth, potsEnabled);

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

  return (
    <Stack>
      <DueRecurringCard />
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />

      {!hasTargets && (
        <Card withBorder>
          <Text mb="sm">Set a target on a category to track your spending against it.</Text>
          <Button component={Link} to="/targets">Set targets</Button>
        </Card>
      )}

      {summary.spending.length > 0 && (
        <div>
          <Title order={5} mb="xs">Spending vs target</Title>
          <GroupedProgress items={summary.spending} />
        </div>
      )}

      {potsEnabled && (pots.error ? (
        <Text size="sm" c="dimmed">Could not load pots.</Text>
      ) : (
        <HomePots pots={pots.data ?? []} categories={categories.data ?? []} />
      ))}

      <Group justify="space-between">
        <Text c="dimmed">Income this month</Text>
        <Text fw={600}>{formatPence(summary.incomeTotal)}</Text>
      </Group>

      <div>
        <Title order={5} mb="xs">Recent</Title>
        {summary.recent.length === 0
          ? <Text c="dimmed" size="sm">Nothing logged yet this month.</Text>
          : summary.recent.map(t => (
              <TransactionRow key={t.transactionId} transaction={t} categoryName={nameFor(t.categoryId)} categoryIcon={iconFor(t.categoryId)} />
            ))}
        <Button component={Link} to="/transactions" variant="subtle" mt="xs">See all</Button>
      </div>

      <Button component={Link} to="/recurring" variant="subtle" style={{ alignSelf: 'flex-start' }}>
        Manage recurring
      </Button>
    </Stack>
  );
}

export default function Home() {
  return (
    <DefaultLayout>
      <HomeContent />
    </DefaultLayout>
  );
}
