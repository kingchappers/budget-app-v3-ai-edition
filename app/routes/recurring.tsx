import { useState } from 'react';
import { ActionIcon, Button, Group, Loader, Menu, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { LoadError } from '~/components/layout/LoadError';
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { RecurringForm } from '~/components/recurring/RecurringForm';
import { CategoryIcon } from '~/components/categories/CategoryIcon';
import { useUndoableDelete } from '~/hooks/useUndoableDelete';
import { formatMonthName, shiftMonth, todayIso } from '~/lib/months';
import { useCategories, useDeleteRecurring, useRecurring, useSetRecurringHandled, useTransactions } from '~/lib/queries';
import { formatDayOfMonth, skippedPeriod } from '~/lib/recurring';
import { transactionLabel } from '~/lib/trash';
import { formatSignedPence } from '~/lib/transactionTypes';
import type { Category, Recurring, Transaction } from '~/lib/types';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/recurring';

function scheduleText(item: Recurring): string {
  const day = `Monthly on the ${formatDayOfMonth(item.dayOfMonth)}`;
  if (item.leadDays === 0) return `${day} · no early reminder`;
  return `${day} · remind ${item.leadDays} ${item.leadDays === 1 ? 'day' : 'days'} before`;
}

function byDay(a: Recurring, b: Recurring): number {
  if (a.dayOfMonth !== b.dayOfMonth) return a.dayOfMonth - b.dayOfMonth;
  return a.description.localeCompare(b.description);
}

function recurringLabel(item: Recurring, category: Category | undefined): string {
  return item.description || category?.name || 'Recurring item';
}

interface RecurringRowProps {
  item: Recurring;
  category: Category | undefined;
  categoriesLoaded: boolean;
  skipped: string | null;
  onEdit: (item: Recurring) => void;
  onDelete: (item: Recurring) => void;
  onUndoSkip: (item: Recurring, skipped: string) => void;
}

function RecurringRow({ item, category, categoriesLoaded, skipped, onEdit, onDelete, onUndoSkip }: RecurringRowProps) {
  const label = recurringLabel(item, category);

  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
          <CategoryIcon icon={category?.icon ?? 'tag'} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text truncate>{label}</Text>
          <Text size="xs" c="dimmed" truncate>{scheduleText(item)}</Text>
          {categoriesLoaded && !category && <Text size="xs" c="danger">Category deleted</Text>}
          {skipped && (
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed">{`Skipped for ${formatMonthName(skipped)}`}</Text>
              <Button
                variant="subtle"
                size="compact-xs"
                aria-label={`Undo skip for ${label}`}
                onClick={() => onUndoSkip(item, skipped)}
              >
                Undo
              </Button>
            </Group>
          )}
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text fw={500} style={{ whiteSpace: 'nowrap' }}>{formatSignedPence(item.type, item.amount)}</Text>
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(item)}>Edit</Menu.Item>
            <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(item)}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}

function useSkipWindowTransactions(today: string): Transaction[] | null {
  const thisMonth = today.slice(0, 7);
  const current = useTransactions(thisMonth);
  const next = useTransactions(shiftMonth(thisMonth, 1));
  if (current.data === undefined || next.data === undefined) return null;
  return [...current.data, ...next.data];
}

function RecurringContent() {
  const recurring = useRecurring();
  const categories = useCategories();
  const remove = useDeleteRecurring();
  const setHandled = useSetRecurringHandled();
  const undoableDelete = useUndoableDelete();
  const today = todayIso();
  const windowTransactions = useSkipWindowTransactions(today);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);

  function undoSkip(item: Recurring, skipped: string): void {
    setHandled.mutate({ recurringId: item.recurringId, period: shiftMonth(skipped, -1) });
  }

  function deleteItem(item: Recurring): void {
    const name = recurringLabel(item, categories.data?.find(c => c.categoryId === item.categoryId));
    undoableDelete({
      label: transactionLabel({ amount: item.amount, description: '' }, name),
      name,
      ref: { entityType: 'RECURRING', id: item.recurringId },
      run: () => remove.mutateAsync(item.recurringId),
    });
  }

  if (recurring.error) {
    return (
      <LoadError thing="recurring items" onRetry={() => recurring.refetch()} />
    );
  }

  if (recurring.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const items = [...(recurring.data ?? [])].sort(byDay);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Recurring</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>New</Button>
      </Group>

      {items.length === 0 && (
        <Text c="dimmed">No recurring items yet. Use Repeat monthly on a transaction, or add one here.</Text>
      )}

      {items.map(item => (
        <RecurringRow
          key={item.recurringId}
          item={item}
          category={categories.data?.find(c => c.categoryId === item.categoryId)}
          categoriesLoaded={categories.data !== undefined}
          skipped={windowTransactions === null ? null : skippedPeriod(item, windowTransactions, today)}
          onEdit={setEditing}
          onDelete={deleteItem}
          onUndoSkip={undoSkip}
        />
      ))}

      <RecurringForm
        opened={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        editing={editing}
      />
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Recurring') }];

export default function RecurringPage() {
  return (
    <DefaultLayout>
      <RecurringContent />
    </DefaultLayout>
  );
}
