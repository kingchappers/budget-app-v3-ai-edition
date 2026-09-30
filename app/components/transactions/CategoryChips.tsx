import { useId, useState } from 'react';
import { Button, Chip, Group, Input, MultiSelect, Select, Text, useInputWrapperContext } from '@mantine/core';
import { categorySelectData } from '~/lib/categoryGroups';
import { categoryLabel } from '~/lib/categoryIcons';
import { MAX_PINNED_CHIPS } from '~/lib/preferences';
import type { Category } from '~/lib/types';

export interface CategoryChipsProps {
  chips: Category[];
  all: Category[];
  value: string | null;
  onChange: (categoryId: string) => void;
  loading?: boolean;
  error?: string | null;
  fieldError?: string | null;
  // Chips the user has pinned to the front, in their order. Passing
  // onPinnedChange turns on the "Edit chips" button.
  pinnedIds?: readonly string[];
  onPinnedChange?: (ids: string[]) => void;
}

// Pins for the categories on screen replace the old ones for those categories;
// pins for other kinds of category (say, income while adding spending) stay.
function mergePins(selected: string[], existing: readonly string[], onScreen: ReadonlySet<string>): string[] {
  return [...selected, ...existing.filter(id => !onScreen.has(id))].slice(0, MAX_PINNED_CHIPS);
}

interface CategoryRadiosProps {
  groupName: string;
  visible: Category[];
  value: string | null;
  onChange: (categoryId: string) => void;
  invalid: boolean;
}

// A separate component so useInputWrapperContext() reads the labelId from the
// surrounding Input.Wrapper (only visible to descendants of its provider),
// along with describedBy, which points at the wrapper's error message.
function CategoryRadios({ groupName, visible, value, onChange, invalid }: CategoryRadiosProps) {
  const wrapper = useInputWrapperContext();
  return (
    <Chip.Group multiple={false} value={value ?? ''} onChange={onChange}>
      {/* display: contents keeps these chips as flex items of the parent Group
          (so the "More…" button still sits inline after them) while giving
          screen readers a radiogroup that contains only the chips. */}
      <Group
        role="radiogroup"
        aria-labelledby={wrapper?.labelId}
        aria-describedby={wrapper?.describedBy}
        aria-invalid={invalid || undefined}
        style={{ display: 'contents' }}
      >
        {visible.map(c => (
          <Chip key={c.categoryId} name={groupName} value={c.categoryId} variant="outline">{categoryLabel(c)}</Chip>
        ))}
      </Group>
    </Chip.Group>
  );
}

export function CategoryChips({
  chips, all, value, onChange, loading = false, error = null, fieldError = null, pinnedIds = [], onPinnedChange,
}: CategoryChipsProps) {
  const groupName = useId();
  const [showAll, setShowAll] = useState(false);
  const [editingChips, setEditingChips] = useState(false);

  if (loading) return <Text size="sm" c="dimmed">Loading categories…</Text>;
  if (error) return <Text size="sm" c="danger">{error}</Text>;

  // A category chosen from outside the chips takes one place at the end of the
  // row. The buttons below sit on their own row, so nothing here moves them.
  const chosenOutsideChips = value !== null && !chips.some(c => c.categoryId === value)
    ? all.find(c => c.categoryId === value)
    : undefined;
  const visible = chosenOutsideChips ? [...chips, chosenOutsideChips] : chips;

  const selectData = categorySelectData(all);
  const onScreen = new Set(all.map(c => c.categoryId));

  return (
    <Input.Wrapper label="Category" error={fieldError} errorProps={{ role: 'alert' }}>
      <Group gap="xs" mt={4}>
        <CategoryRadios groupName={groupName} visible={visible} value={value} onChange={onChange} invalid={fieldError !== null} />
      </Group>
      <Group gap="xs" mt={4}>
        <Button variant="subtle" size="compact-sm" aria-expanded={showAll} onClick={() => setShowAll(open => !open)}>
          All categories
        </Button>
        {onPinnedChange && (
          <Button variant="subtle" size="compact-sm" aria-expanded={editingChips} onClick={() => setEditingChips(open => !open)}>
            Edit chips
          </Button>
        )}
      </Group>
      {showAll && (
        <Select
          mt="xs"
          aria-label="All categories"
          placeholder="Search categories"
          searchable
          allowDeselect={false}
          autoFocus
          data={selectData}
          value={value}
          onOptionSubmit={() => setShowAll(false)}
          onChange={picked => { if (picked) onChange(picked); }}
        />
      )}
      {editingChips && onPinnedChange && (
        <MultiSelect
          mt="xs"
          label="Your chips"
          description={`Choose up to ${MAX_PINNED_CHIPS}. They always come first, in the order you pick them.`}
          placeholder="Search categories"
          searchable
          data={selectData}
          value={pinnedIds.filter(id => onScreen.has(id))}
          maxValues={MAX_PINNED_CHIPS}
          onChange={ids => onPinnedChange(mergePins(ids, pinnedIds, onScreen))}
        />
      )}
    </Input.Wrapper>
  );
}
