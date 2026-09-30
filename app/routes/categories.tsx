import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Select, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { RenameField } from '~/components/categories/RenameField';
import { LoadError } from '~/components/layout/LoadError';
import { IconPencil } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { SaveStatus, type SaveState } from '~/components/layout/SaveStatus';
import { ReassignDialog } from '~/components/categories/ReassignDialog';
import { useInlineCategoryRename } from '~/hooks/useInlineCategoryRename';
import { useCategories, useCreateCategory, useDeleteCategory, useReassignCategory } from '~/lib/queries';
import { defaultGroupFor, groupCategories, groupsForType } from '~/lib/categoryGroups';
import { categoryLabel } from '~/lib/categoryIcons';
import type { Category, CategoryGroup, CategoryType } from '~/lib/types';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/categories';

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
        <RenameField categoryName={category.name} draft={draft} onDraftChange={setDraft} onSave={commit} onCancel={cancel} />
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
  const [createState, setCreateState] = useState<SaveState>('idle');

  function addCategory(): void {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setCreateState('saving');
    createCategory.mutate(
      type === 'INCOME' ? { name: trimmed, type, icon: 'tag' } : { name: trimmed, type, icon: 'tag', group },
      {
        onSuccess: () => {
          setName('');
          setCreateState('saved');
        },
        onError: (createError: Error) => {
          console.error(`Failed to create a ${type} category:`, createError);
          setCreateState('error');
        },
      },
    );
  }

  async function confirmDelete(toCategoryId: string): Promise<void> {
    if (!pendingDelete) return;
    const deleting = pendingDelete;
    const targetName = categories.data?.find(c => c.categoryId === toCategoryId)?.name ?? 'the chosen category';

    try {
      await reassign.mutateAsync({ categoryId: deleting.categoryId, toCategoryId });
    } catch (reassignError) {
      setPendingDelete(null);
      console.error(`Failed to move transactions from category ${deleting.categoryId} to ${toCategoryId}:`, reassignError);
      setError(`Couldn't move the transactions to ${targetName}, so ${deleting.name} wasn't deleted. Some transactions may already have moved. Try again.`);
      return;
    }

    try {
      await deleteCategory.mutateAsync(deleting.categoryId);
      setPendingDelete(null);
    } catch (deleteError) {
      setPendingDelete(null);
      console.error(`Failed to delete category ${deleting.categoryId} after moving its transactions:`, deleteError);
      setError(`Transactions moved to ${targetName}; the category wasn't deleted. Try again.`);
    }
  }

  if (categories.error) {
    return (
      <LoadError thing="categories" onRetry={() => categories.refetch()} />
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
            value={name} onChange={e => { setName(e.currentTarget.value); setCreateState('idle'); }} />
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
          <Button disabled={name.trim() === ''} loading={createState === 'saving'} onClick={addCategory}>
            Add
          </Button>
        </Group>
        <SaveStatus state={createState} onRetry={addCategory} />
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

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Categories') }];

export default function Categories() {
  return (
    <DefaultLayout>
      <CategoriesContent />
    </DefaultLayout>
  );
}
