import { useState } from 'react';
import { Button, Card, Group, SegmentedControl, Select, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import { categoryTypeFor, TYPE_OPTIONS } from '~/lib/transactionTypes';
import type { Category, InboxItem, TransactionType } from '~/lib/types';

export interface InboxRowProps {
  item: InboxItem;
  accountLabel: string;
  categories: Category[];
  onConfirm: (input: { type: TransactionType; categoryId: string }) => void;
  onIgnore: () => void;
  busy?: boolean;
}

function fitsType(categories: Category[], categoryId: string, type: TransactionType): boolean {
  return categories.some(c => c.categoryId === categoryId && c.type === categoryTypeFor(type));
}

export function InboxRow({ item, accountLabel, categories, onConfirm, onIgnore, busy = false }: InboxRowProps) {
  const [type, setType] = useState<TransactionType>(item.suggestion?.type ?? item.suggestedType);
  const [categoryId, setCategoryId] = useState<string | null>(item.suggestion?.categoryId ?? null);

  const options = categories
    .filter(c => c.type === categoryTypeFor(type))
    .map(c => ({ value: c.categoryId, label: c.name }));

  function changeType(value: string) {
    const next = value as TransactionType;
    setType(next);
    if (categoryId && !fitsType(categories, categoryId, next)) setCategoryId(null);
  }

  function confirm() {
    if (!categoryId) return;
    onConfirm({ type, categoryId });
  }

  const sign = item.direction === 'OUT' ? '−' : '+';

  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Text fw={500} truncate>{item.description}</Text>
            <Text size="xs" c="dimmed">{accountLabel}</Text>
          </div>
          <Text fw={600} c={item.direction === 'IN' ? 'success' : undefined}>{sign}{formatPence(item.amount)}</Text>
        </Group>
        <SegmentedControl size="xs" fullWidth value={type} onChange={changeType} data={TYPE_OPTIONS} />
        <Group align="flex-end" wrap="wrap" gap="xs">
          <Select
            label="Category"
            placeholder="Choose category"
            data={options}
            value={categoryId}
            onChange={setCategoryId}
            style={{ flex: 1, minWidth: 160 }}
          />
          <Group gap="xs">
            <Button variant="default" onClick={onIgnore} disabled={busy}>Ignore</Button>
            <Button onClick={confirm} disabled={!categoryId || busy}>Confirm</Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
