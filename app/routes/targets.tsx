import { useState } from 'react';
import { Alert, Button, Card, Group, Loader, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { formatPencePlain, parsePounds } from '~/lib/money';
import { useCategories, useDeleteTarget, useSetTarget, useTargets } from '~/lib/queries';
import type { Category, TargetPeriod } from '~/lib/types';

function TargetRow({ category, amountPence, period }: {
  category: Category;
  amountPence: number | null;
  period: TargetPeriod;
}) {
  const [value, setValue] = useState(amountPence !== null ? formatPencePlain(amountPence) : '');
  const [selectedPeriod, setSelectedPeriod] = useState<TargetPeriod>(period);
  const [error, setError] = useState<string | null>(null);
  const setTarget = useSetTarget();
  const clearTarget = useDeleteTarget();

  function save() {
    const parsed = parsePounds(value);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    setTarget.mutate({ categoryId: category.categoryId, targetAmount: parsed.pence, period: selectedPeriod });
  }

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>{category.name}</Text>
        {amountPence !== null && (
          <Button size="compact-xs" variant="subtle" color="danger"
            onClick={() => { setValue(''); clearTarget.mutate(category.categoryId); }}>
            Clear
          </Button>
        )}
      </Group>
      <Group align="flex-end" wrap="nowrap">
        <TextInput
          label="Target" placeholder="0.00" inputMode="decimal" style={{ flex: 1 }}
          value={value} onChange={e => setValue(e.currentTarget.value)} error={error}
          aria-label={`Target for ${category.name}`}
        />
        <SegmentedControl
          value={selectedPeriod}
          onChange={v => setSelectedPeriod(v as TargetPeriod)}
          data={[{ label: '/mo', value: 'MONTHLY' }, { label: '/wk', value: 'WEEKLY' }]}
        />
        <Button onClick={save} loading={setTarget.isPending}>Save</Button>
      </Group>
    </Card>
  );
}

function TargetsContent() {
  const categories = useCategories();
  const targets = useTargets();

  if (categories.error || targets.error) {
    return (
      <Alert color="danger" title="Could not load targets">
        <Button onClick={() => { categories.refetch(); targets.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || targets.isLoading) {
    return <Group justify="center" py="xl"><Loader /></Group>;
  }

  const targetFor = (id: string) => targets.data?.find(t => t.categoryId === id);
  const eligible = (categories.data ?? []).filter(c => c.type !== 'INCOME');
  const expense = eligible.filter(c => c.type === 'EXPENSE');
  const investment = eligible.filter(c => c.type === 'INVESTMENT');

  return (
    <Stack>
      <Title order={3}>Targets</Title>
      <Text c="dimmed" size="sm">Income has no target — it is shown as a monthly total instead.</Text>

      <Title order={5} mt="md">Spending</Title>
      {expense.map(c => {
        const t = targetFor(c.categoryId);
        return <TargetRow key={c.categoryId} category={c}
          amountPence={t?.targetAmount ?? null} period={t?.period ?? 'MONTHLY'} />;
      })}

      <Title order={5} mt="md">Saving</Title>
      {investment.map(c => {
        const t = targetFor(c.categoryId);
        return <TargetRow key={c.categoryId} category={c}
          amountPence={t?.targetAmount ?? null} period={t?.period ?? 'MONTHLY'} />;
      })}
    </Stack>
  );
}

export default function Targets() {
  return (
    <DefaultLayout>
      <TargetsContent />
    </DefaultLayout>
  );
}
