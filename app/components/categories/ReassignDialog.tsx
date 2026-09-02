import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import type { Category } from '~/lib/types';

export function ReassignDialog({
  opened, category, candidates, onCancel, onConfirm, pending,
}: {
  opened: boolean;
  category: Category | null;
  candidates: Category[];
  onCancel: () => void;
  onConfirm: (toCategoryId: string) => void;
  pending: boolean;
}) {
  const [target, setTarget] = useState<string | null>(null);

  return (
    <Modal opened={opened} onClose={onCancel} title={`Delete ${category?.name ?? ''}?`}>
      <Stack>
        <Text size="sm">
          Its transactions will be moved to another category so none are lost.
          This applies to every month, not just this one.
        </Text>
        <Select
          label="Move transactions to"
          placeholder="Choose a category"
          data={candidates.map(c => ({ value: c.categoryId, label: c.name }))}
          value={target}
          onChange={setTarget}
          searchable
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onCancel}>Cancel</Button>
          <Button color="red" disabled={!target} loading={pending}
            onClick={() => target && onConfirm(target)}>
            Move and delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
