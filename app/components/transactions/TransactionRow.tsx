import { ActionIcon, Group, Menu, Text, ThemeIcon } from '@mantine/core';
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import { getCategoryIcon } from '~/lib/categoryIcons';
import type { Transaction } from '~/lib/types';

const OUTGOING = new Set(['EXPENSE', 'INVESTMENT_IN']);

export function TransactionRow({
  transaction, categoryName, categoryIcon, onEdit, onDelete,
}: {
  transaction: Transaction;
  categoryName: string;
  categoryIcon: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
}) {
  const label = transaction.description || categoryName;
  const sign = OUTGOING.has(transaction.type) ? '−' : '+';
  const Icon = getCategoryIcon(categoryIcon);

  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
          <Icon size={18} stroke={1.6} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text truncate>{label}</Text>
          <Text size="xs" c="dimmed">{categoryName} · {transaction.date}</Text>
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{sign}{formatPence(transaction.amount)}</Text>
        {(onEdit || onDelete) && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDelete && <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
