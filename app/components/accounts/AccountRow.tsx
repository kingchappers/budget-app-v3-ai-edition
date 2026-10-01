import { ActionIcon, Button, Card, Group, Menu, Text, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';
import { accountTypeLabel, balanceAsOf, balanceChangeNote, updatedAgo } from '~/lib/accounts';
import { todayIso } from '~/lib/months';
import { formatPence } from '~/lib/money';
import type { Account } from '~/lib/types';

export function AccountRow({
  account, onOpen, onDelete, onUpdate,
}: {
  account: Account;
  onOpen: () => void;
  onDelete: () => void;
  onUpdate: () => void;
}) {
  const balance = balanceAsOf(account.balances, todayIso());
  const change = account.kind === 'LIABILITY' ? balanceChangeNote(account.balances, todayIso()) : null;

  return (
    <Card withBorder mb="xs">
      <Group justify="space-between" wrap="nowrap" align="center">
        <UnstyledButton onClick={onOpen} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={500}>{account.name}</Text>
          <Text size="sm">{accountTypeLabel(account.type)}</Text>
          <VisuallyHidden>Open {account.name} history</VisuallyHidden>
        </UnstyledButton>
        <div style={{ textAlign: 'right' }}>
          <Text fw={700}>{formatPence(balance)}</Text>
          <Text size="sm">{updatedAgo(account.balances, todayIso())}</Text>
          {change && <Text size="sm">{change}</Text>}
        </div>
        <Button size="compact-sm" variant="light" onClick={onUpdate} aria-label={`Update ${account.name}`}>Update</Button>
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" aria-label={`Actions for ${account.name}`}><IconDots size={16} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={onDelete}>Delete</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Card>
  );
}
