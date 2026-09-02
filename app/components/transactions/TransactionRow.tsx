import { ActionIcon, Group, Menu, Text } from '@mantine/core';
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import type { Transaction } from '~/lib/types';

const OUTGOING = new Set(['EXPENSE', 'INVESTMENT_IN']);

export function TransactionRow({
  transaction, categoryName, onEdit, onDelete,
}: {
  transaction: Transaction;
  categoryName: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
}) {
  const label = transaction.description || categoryName;
  const sign = OUTGOING.has(transaction.type) ? '−' : '+';

  return (
    <Group justify="space-between" wrap="nowrap" py={6}>
      <div style={{ minWidth: 0 }}>
        <Text truncate>{label}</Text>
        <Text size="xs" c="dimmed">{categoryName} · {transaction.date}</Text>
      </div>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{sign}{formatPence(transaction.amount)}</Text>
        {(onEdit || onDelete) && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDelete && <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
