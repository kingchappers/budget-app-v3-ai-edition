import { Alert, Button, Group, Loader, Stack, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { BudgetVsActualList } from '~/components/insights/BudgetVsActualList';
import { CategoryTrendList } from '~/components/insights/CategoryTrendList';
import { TopNotesList } from '~/components/insights/TopNotesList';
import { currentYearMonth } from '~/lib/months';
import { useCategories, useInsights, useTargets } from '~/lib/queries';

const MONTHS = 6;

function InsightsContent() {
  const asOf = currentYearMonth();
  const categories = useCategories();
  const targets = useTargets();
  const insights = useInsights(asOf, MONTHS);

  if (categories.error || targets.error || insights.error) {
    return (
      <Alert color="danger" title="Could not load insights">
        <Button onClick={() => { categories.refetch(); targets.refetch(); insights.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || targets.isLoading || insights.isLoading) {
    return <Group justify="center" py="xl"><Loader /></Group>;
  }

  const data = insights.data ?? { months: [], categories: [], topNotes: [] };

  return (
    <Stack>
      <Title order={3}>Insights</Title>
      <CategoryTrendList trends={data.categories} categories={categories.data ?? []} />
      <BudgetVsActualList
        categories={categories.data ?? []}
        targets={targets.data ?? []}
        trends={data.categories}
        yearMonth={asOf}
        months={MONTHS}
      />
      <TopNotesList notes={data.topNotes} />
    </Stack>
  );
}

export default function Insights() {
  return (
    <DefaultLayout>
      <InsightsContent />
    </DefaultLayout>
  );
}
