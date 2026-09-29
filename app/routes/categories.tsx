import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Select, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { ReassignDialog } from '~/components/categories/ReassignDialog';
import { useInlineCategoryRename } from '~/hooks/useInlineCategoryRename';
import { useCategories, useCreateCategory, useDeleteCategory, useReassignCategory } from '~/lib/queries';
import { defaultGroupFor, groupCategories, groupsForType } from '~/lib/categoryGroups';
import { categoryLabel } from '~/lib/categoryIcons';
import type { Category, CategoryGroup, CategoryType } from '~/lib/types';

const TYPES: { value: CategoryType; label: string }[] = [
  { value: 'EXPENSE', label: 'Spending' },
  { value: 'INCOME', label: 'Income' },
  { value: 'POT', label: 'Pot' },
];

function CategoryRow({ category, onDelete, onError }: {
  category: Category;
  onDelete: (category: Category) => void;
  onError: (message: string) => void;
}) {
  const { editing, draft, setDraft, start, cancel, commit } = useInlineCategoryRename(
    category,
    onError,
    'Could not rename the category. Try again.',
  );

  if (category.isDefault) {
    return (
      <Group justify="space-between" py={6}>
        <Group gap="xs">
          <Text>{categoryLabel(category)}</Text>
          <Badge size="xs" variant="light">default</Badge>
        </Group>
      </Group>
    );
  }

  if (editing) {
    return (
      <Group justify="space-between" py={6}>
        <TextInput
          size="xs"
          autoFocus
          aria-label={`Rename ${category.name}`}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          style={{ flex: 1 }}
        />
      </Group>
    );
  }

  return (
    <Group justify="space-between" py={6}>
      <UnstyledButton onClick={start}>
        <Text>{categoryLabel(category)}</Text>
      </UnstyledButton>
      <Group gap={4}>
        <ActionIcon size="sm" variant="subtle" aria-label={`Rename ${category.name}`} onClick={start}>
          <IconPencil size={14} />
        </ActionIcon>
        <Button size="compact-xs" variant="subtle" color="danger" onClick={() => onDelete(category)}>
          Delete
        </Button>
      </Group>
    </Group>
  );
}

function CategoriesContent() {
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const reassign = useReassignCategory();

  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('EXPENSE');
  const [group, setGroup] = useState<CategoryGroup>('EVERYDAY');
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete(toCategoryId: string) {
    if (!pendingDelete) return;
    try {
      await reassign.mutateAsync({ categoryId: pendingDelete.categoryId, toCategoryId });
      await deleteCategory.mutateAsync(pendingDelete.categoryId);
      setPendingDelete(null);
    } catch {
      setError('Could not delete the category. Nothing was changed.');
      setPendingDelete(null);
    }
  }

  if (categories.error) {
    return (
      <Alert color="danger" title="Could not load categories">
        <Button onClick={() => categories.refetch()}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = categories.data ?? [];

  return (
    <Stack>
      <Title order={3}>Categories</Title>
      {error && <Alert color="danger" onClose={() => setError(null)} withCloseButton>{error}</Alert>}

      <Card withBorder>
        <Group align="flex-end">
          <TextInput label="New category" placeholder="e.g. Padel" style={{ flex: 1, minWidth: 160 }}
            value={name} onChange={e => setName(e.currentTarget.value)} />
          <Select label="Type" data={TYPES} value={type}
            onChange={v => {
              const next = v as CategoryType;
              setType(next);
              const nextGroup = defaultGroupFor(next);
              if (!nextGroup) return;
              const stillValid = groupsForType(next).some(option => option.value === group);
              if (!stillValid) setGroup(nextGroup);
            }} allowDeselect={false} />
          <Select label="Group" data={groupsForType(type)} value={type === 'INCOME' ? null : group}
            onChange={v => { if (v) setGroup(v as CategoryGroup); }}
            disabled={type === 'INCOME'} allowDeselect={false} />
          <Button
            disabled={name.trim() === ''}
            loading={createCategory.isPending}
            onClick={() => {
              createCategory.mutate(type === 'INCOME'
                ? { name: name.trim(), type, icon: 'tag' }
                : { name: name.trim(), type, icon: 'tag', group });
              setName('');
            }}
          >
            Add
          </Button>
        </Group>
      </Card>

      {groupCategories(all).map(bucket => (
        <div key={bucket.key}>
          <Title order={5} mt="md" mb="xs">{bucket.label}</Title>
          {bucket.items.map(c => (
            <CategoryRow key={c.categoryId} category={c} onDelete={setPendingDelete} onError={setError} />
          ))}
        </div>
      ))}

      <ReassignDialog
        opened={pendingDelete !== null}
        category={pendingDelete}
        candidates={all.filter(c => c.type === pendingDelete?.type && c.categoryId !== pendingDelete?.categoryId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        pending={reassign.isPending || deleteCategory.isPending}
      />
    </Stack>
  );
}

export default function Categories() {
  return (
    <DefaultLayout>
      <CategoriesContent />
    </DefaultLayout>
  );
}
