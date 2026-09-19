import { useId, useState } from 'react';
import { Button, Chip, Group, Input, Select, Text } from '@mantine/core';
import type { Category } from '~/lib/types';

export interface CategoryChipsProps {
  chips: Category[];
  all: Category[];
  value: string | null;
  onChange: (categoryId: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function CategoryChips({ chips, all, value, onChange, loading = false, error = null }: CategoryChipsProps) {
  const groupName = useId();
  const [showAll, setShowAll] = useState(false);

  if (loading) return <Text size="sm" c="dimmed">Loading categories…</Text>;
  if (error) return <Text size="sm" c="danger">{error}</Text>;

  const chosenOutsideChips = value !== null && !chips.some(c => c.categoryId === value)
    ? all.find(c => c.categoryId === value)
    : undefined;
  const visible = chosenOutsideChips ? [...chips, chosenOutsideChips] : chips;

  return (
    <Input.Wrapper label="Category">
      <Chip.Group multiple={false} value={value ?? ''} onChange={onChange}>
        <Group gap="xs" mt={4} role="radiogroup" aria-label="Category">
          {visible.map(c => (
            <Chip key={c.categoryId} name={groupName} value={c.categoryId} variant="outline">{c.name}</Chip>
          ))}
          <Button variant="subtle" size="compact-sm" aria-expanded={showAll} onClick={() => setShowAll(open => !open)}>
            More…
          </Button>
        </Group>
      </Chip.Group>
      {showAll && (
        <Select
          mt="xs"
          aria-label="All categories"
          placeholder="Search categories"
          searchable
          autoFocus
          data={all.map(c => ({ value: c.categoryId, label: c.name }))}
          value={value}
          onChange={picked => {
            if (!picked) return;
            onChange(picked);
            setShowAll(false);
          }}
        />
      )}
    </Input.Wrapper>
  );
}
