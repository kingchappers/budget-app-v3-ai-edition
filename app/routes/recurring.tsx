import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Loader, Menu, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { RecurringForm } from '~/components/recurring/RecurringForm';
import { getCategoryIcon } from '~/lib/categoryIcons';
import { useCategories, useDeleteRecurring, useRecurring } from '~/lib/queries';
import { formatDayOfMonth } from '~/lib/recurring';
import { formatSignedPence } from '~/lib/transactionTypes';
import type { Category, Recurring } from '~/lib/types';

function scheduleText(item: Recurring): string {
  const day = `Monthly on the ${formatDayOfMonth(item.dayOfMonth)}`;
  if (item.leadDays === 0) return `${day} · no early reminder`;
  return `${day} · remind ${item.leadDays} ${item.leadDays === 1 ? 'day' : 'days'} before`;
}

function byDay(a: Recurring, b: Recurring): number {
  if (a.dayOfMonth !== b.dayOfMonth) return a.dayOfMonth - b.dayOfMonth;
  return a.description.localeCompare(b.description);
}

interface RecurringRowProps {
  item: Recurring;
  category: Category | undefined;
  categoriesLoaded: boolean;
  onEdit: (item: Recurring) => void;
  onDelete: (item: Recurring) => void;
}

function RecurringRow({ item, category, categoriesLoaded, onEdit, onDelete }: RecurringRowProps) {
  const label = item.description || category?.name || 'Recurring item';
  const Icon = getCategoryIcon(category?.icon ?? 'tag');

  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
          <Icon size={18} stroke={1.6} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text truncate>{label}</Text>
          <Text size="xs" c="dimmed">{scheduleText(item)}</Text>
          {categoriesLoaded && !category && <Text size="xs" c="danger">Category deleted</Text>}
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{formatSignedPence(item.type, item.amount)}</Text>
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

function RecurringContent() {
  const recurring = useRecurring();
  const categories = useCategories();
  const remove = useDeleteRecurring();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);

  if (recurring.error) {
    return (
      <Alert color="danger" title="Could not load recurring items">
        <Button onClick={() => recurring.refetch()}>Try again</Button>
      </Alert>
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

      {remove.error && (
        <Alert color="danger" title="Could not delete the recurring item">{remove.error.message}</Alert>
      )}

      {items.length === 0 && (
        <Text c="dimmed">No recurring items yet. Use Repeat monthly on a transaction, or add one here.</Text>
      )}

      {items.map(item => (
        <RecurringRow
          key={item.recurringId}
          item={item}
          category={categories.data?.find(c => c.categoryId === item.categoryId)}
          categoriesLoaded={categories.data !== undefined}
          onEdit={setEditing}
          onDelete={target => remove.mutate(target.recurringId)}
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

export default function RecurringPage() {
  return (
    <DefaultLayout>
      <RecurringContent />
    </DefaultLayout>
  );
}
