import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { PotHistorySheet } from '~/components/pots/PotHistorySheet';
import { PotRow } from '~/components/pots/PotRow';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { bucketKeyFor, groupItems } from '~/lib/categoryGroups';
import { currentYearMonth } from '~/lib/months';
import { useCategories, usePots } from '~/lib/queries';
import type { Category, PotSummary } from '~/lib/types';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/pots';
import { redirect } from 'react-router';
import { planPath } from '~/lib/planTabs';

export function PotsContent() {
  const asOf = currentYearMonth();
  const categories = useCategories();
  const pots = usePots(asOf);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  // A link from a recurring bill: open this pot with a monthly amount filled in but not saved.
  const [openId, setOpenId] = useState<string | null>(() => params.get('pot'));
  const [suggestedMonthly] = useState<number | undefined>(() => {
    const value = params.get('monthly');
    return value !== null && /^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
  });
  const preset = useMemo(
    () => (addingTo ? { type: 'SET_ASIDE' as const, categoryId: addingTo } : null),
    [addingTo],
  );

  if (categories.error || pots.error) {
    return (
      <Alert color="danger" title="Could not load pots">
        <Button onClick={() => { categories.refetch(); pots.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || pots.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const categoryById = new Map((categories.data ?? []).map(c => [c.categoryId, c]));
  const rows = (pots.data ?? [])
    .map(pot => ({ pot, category: categoryById.get(pot.categoryId) }))
    .filter((row): row is { pot: PotSummary; category: Category } => row.category !== undefined);

  return (
    <Stack>
      <Title order={3}>Pots</Title>
      {rows.length === 0 && (
        <Text c="dimmed">No pots yet. Add a category with the Pot type on the Categories page.</Text>
      )}
      {groupItems(rows, row => bucketKeyFor(row.category), row => row.category.name).map(bucket => (
        <div key={bucket.key}>
          <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
          {bucket.items.map(({ pot, category }) => (
            <PotRow
              key={pot.categoryId}
              pot={pot}
              category={category}
              onSetAside={() => setAddingTo(pot.categoryId)}
              onOpen={() => setOpenId(pot.categoryId)}
            />
          ))}
        </div>
      ))}
      <TransactionSheet
        opened={addingTo !== null}
        onClose={() => setAddingTo(null)}
        yearMonth={asOf}
        preset={preset}
      />
      <PotHistorySheet
        pot={rows.find(row => row.pot.categoryId === openId)?.pot ?? null}
        category={rows.find(row => row.pot.categoryId === openId)?.category}
        suggestedMonthly={suggestedMonthly}
        onClose={() => {
          setOpenId(null);
          if (params.has('pot') || params.has('monthly')) {
            // Only what opened the pot goes; the Plan page's own ?tab=pots stays.
            const next = new URLSearchParams(params);
            next.delete('pot');
            next.delete('monthly');
            setParams(next, { replace: true });
          }
        }}
      />
    </Stack>
  );
}

// This page now lives under Plan. The old address still works and leads there.
export function clientLoader({ request }: Route.ClientLoaderArgs) {
  throw redirect(planPath('pots', new URL(request.url).search));
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Pots') }];

export default function Pots() {
  return (
    <DefaultLayout>
      <PotsContent />
    </DefaultLayout>
  );
}
