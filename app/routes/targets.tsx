import { useState } from 'react';
import { Alert, Button, Card, Group, Loader, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { SaveStatus, type SaveState } from '~/components/layout/SaveStatus';
import { categoryLabel } from '~/lib/categoryIcons';
import { groupCategories } from '~/lib/categoryGroups';
import { formatPencePlain, parsePounds } from '~/lib/money';
import { useCategories, useDeleteTarget, useSetTarget, useTargets } from '~/lib/queries';
import type { Category, TargetPeriod } from '~/lib/types';

function isDirty(value: string, period: TargetPeriod, savedPence: number | null, savedPeriod: TargetPeriod): boolean {
  if (period !== savedPeriod) return true;
  const parsed = parsePounds(value);
  if (!parsed.ok) return value.trim() !== '' || savedPence !== null;
  return parsed.pence !== savedPence;
}

function TargetRow({ category, amountPence, period }: {
  category: Category;
  amountPence: number | null;
  period: TargetPeriod;
}) {
  const [value, setValue] = useState(amountPence !== null ? formatPencePlain(amountPence) : '');
  const [selectedPeriod, setSelectedPeriod] = useState<TargetPeriod>(period);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const setTarget = useSetTarget();
  const clearTarget = useDeleteTarget();

  const unsaved = saveState === 'idle' && isDirty(value, selectedPeriod, amountPence, period);

  function save(): void {
    const parsed = parsePounds(value);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    setSaveState('saving');
    setTarget.mutate(
      { categoryId: category.categoryId, targetAmount: parsed.pence, period: selectedPeriod },
      {
        onSuccess: () => setSaveState('saved'),
        onError: (saveError: Error) => {
          console.error(`Failed to save the target for category ${category.categoryId}:`, saveError);
          setSaveState('error');
        },
      },
    );
  }

  function changeValue(next: string): void {
    setValue(next);
    setSaveState('idle');
  }

  function changePeriod(next: TargetPeriod): void {
    setSelectedPeriod(next);
    setSaveState('idle');
  }

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>{categoryLabel(category)}</Text>
        {amountPence !== null && (
          <Button size="compact-xs" variant="subtle" color="danger"
            onClick={() => { setValue(''); clearTarget.mutate(category.categoryId); }}>
            Clear
          </Button>
        )}
      </Group>
      <Group align="flex-end">
        <TextInput
          label="Target" placeholder="0.00" inputMode="decimal" style={{ flex: 1, minWidth: 100 }}
          value={value} onChange={e => changeValue(e.currentTarget.value)} error={error}
          aria-label={`Target for ${category.name}`}
        />
        <SegmentedControl
          value={selectedPeriod}
          onChange={v => changePeriod(v as TargetPeriod)}
          data={[{ label: '/mo', value: 'MONTHLY' }, { label: '/wk', value: 'WEEKLY' }]}
        />
        <Button onClick={save} loading={saveState === 'saving'}>Save</Button>
      </Group>
      <Group justify="flex-end" mt={4} mih={24}>
        {unsaved && <Text size="sm" c="dimmed">Not saved yet</Text>}
        <SaveStatus state={saveState} onRetry={save} />
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
  const eligible = (categories.data ?? []).filter(c => c.type === 'EXPENSE');

  return (
    <Stack>
      <Title order={3}>Targets</Title>
      <Text c="dimmed" size="sm">Income and pots have no monthly target here. Set a pot's goal and plan on the Pots page.</Text>

      {groupCategories(eligible).map(bucket => (
        <div key={bucket.key}>
          <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
          {bucket.items.map(c => {
            const t = targetFor(c.categoryId);
            return <TargetRow key={c.categoryId} category={c}
              amountPence={t?.targetAmount ?? null} period={t?.period ?? 'MONTHLY'} />;
          })}
        </div>
      ))}
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
