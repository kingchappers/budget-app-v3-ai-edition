import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, Card, Group, Loader, Menu, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { useUndoableDelete } from '~/hooks/useUndoableDelete';
import { categoryLabel } from '~/lib/categoryIcons';
import { groupCategories } from '~/lib/categoryGroups';
import { formatPencePlain, parsePounds } from '~/lib/money';
import { targetLabel } from '~/lib/trash';
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
  const removeTarget = useDeleteTarget();
  const undoableDelete = useUndoableDelete();

  // The saved target changes on save, remove, undo and a failed remove;
  // the inputs follow it so an Undo puts the amount back in the box.
  useEffect(() => {
    setValue(amountPence !== null ? formatPencePlain(amountPence) : '');
    setSelectedPeriod(period);
  }, [amountPence, period]);

  function remove(targetAmount: number): void {
    undoableDelete({
      label: targetLabel(targetAmount, category.name),
      name: `the ${category.name} target`,
      ref: { entityType: 'TARGET', id: category.categoryId },
      run: () => removeTarget.mutateAsync(category.categoryId),
    });
  }

  function save() {
    const parsed = parsePounds(value);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    setTarget.mutate({ categoryId: category.categoryId, targetAmount: parsed.pence, period: selectedPeriod });
  }

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>{categoryLabel(category)}</Text>
        {amountPence !== null && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${category.name} target`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconTrash size={14} />} onClick={() => remove(amountPence)}>Remove target</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Group align="flex-end">
        <TextInput
          label="Target" placeholder="0.00" inputMode="decimal" style={{ flex: 1, minWidth: 100 }}
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
