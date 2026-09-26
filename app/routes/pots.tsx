import { useMemo, useState } from 'react';
import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { PotRow } from '~/components/pots/PotRow';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { bucketKeyFor, groupItems } from '~/lib/categoryGroups';
import { currentYearMonth } from '~/lib/months';
import { useCategories, usePots } from '~/lib/queries';
import type { Category, PotSummary } from '~/lib/types';

function PotsContent() {
  const asOf = currentYearMonth();
  const categories = useCategories();
  const pots = usePots(asOf);
  const [addingTo, setAddingTo] = useState<string | null>(null);
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
      {groupItems(rows, row => bucketKeyFor(row.category)).map(bucket => (
        <div key={bucket.key}>
          <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
          {bucket.items.map(({ pot, category }) => (
            <PotRow
              key={pot.categoryId}
              pot={pot}
              category={category}
              onSetAside={() => setAddingTo(pot.categoryId)}
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
    </Stack>
  );
}

export default function Pots() {
  return (
    <DefaultLayout>
      <PotsContent />
    </DefaultLayout>
  );
}
