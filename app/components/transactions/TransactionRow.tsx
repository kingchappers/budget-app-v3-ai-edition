import { ActionIcon, Group, Menu, Text, ThemeIcon } from '@mantine/core';
import { IconCopy, IconDots, IconPencil, IconRepeat, IconTrash } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import { CategoryIcon } from '~/components/categories/CategoryIcon';
import type { Transaction } from '~/lib/types';

const OUTGOING = new Set(['EXPENSE', 'INVESTMENT_IN']);

export function TransactionRow({
  transaction, categoryName, categoryIcon, onEdit, onDelete, onDuplicate, onRepeat,
}: {
  transaction: Transaction;
  categoryName: string;
  categoryIcon: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  onDuplicate?: (t: Transaction) => void;
  onRepeat?: (t: Transaction) => void;
}) {
  const label = transaction.description || categoryName;
  const sign = OUTGOING.has(transaction.type) ? '−' : '+';

  return (
    <Group justify="space-between" wrap="nowrap" py={4}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
          <CategoryIcon icon={categoryIcon} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text truncate>{label}</Text>
          <Text size="xs" c="dimmed">{categoryName} · {transaction.date}</Text>
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{sign}{formatPence(transaction.amount)}</Text>
        {(onEdit || onDelete || onDuplicate || onRepeat) && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(transaction)}>Edit</Menu.Item>}
              {onDuplicate && <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => onDuplicate(transaction)}>Duplicate</Menu.Item>}
              {onRepeat && <Menu.Item leftSection={<IconRepeat size={14} />} onClick={() => onRepeat(transaction)}>Repeat monthly</Menu.Item>}
              {onDelete && <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
