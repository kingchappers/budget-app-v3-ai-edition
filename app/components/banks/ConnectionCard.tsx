import { useState } from 'react';
import { Badge, Button, Card, Group, Modal, Stack, Text } from '@mantine/core';
import { describeSyncAge, lastSyncedAt, statusBadge } from '~/lib/banks';
import type { BankConnection } from '~/lib/types';

export interface ConnectionCardProps {
  connection: BankConnection;
  nowMs: number;
  onReconnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionCard({ connection, nowMs, onReconnect, onDisconnect }: ConnectionCardProps) {
  const badge = statusBadge(connection);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap">
          <Text fw={600}>{connection.displayName}</Text>
          <Badge color={badge.color} variant="light">{badge.label}</Badge>
        </Group>
        {connection.accounts.map(account => (
          <Text key={account.accountUid} size="sm">
            {account.displayName}{account.last4 ? ` ••${account.last4}` : ''}
          </Text>
        ))}
        <Text size="xs" c="dimmed">{describeSyncAge(lastSyncedAt(connection), nowMs)}</Text>
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="light" onClick={onReconnect}>Reconnect</Button>
          <Button size="xs" variant="subtle" color="danger" onClick={() => setConfirming(true)}>Disconnect</Button>
        </Group>
      </Stack>

      <Modal opened={confirming} onClose={() => setConfirming(false)} title="Disconnect bank">
        <Stack>
          <Text size="sm">
            Disconnect {connection.displayName}? Unreviewed inbox items from this bank are removed.
            Transactions you have already confirmed stay in your budget.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button color="danger" onClick={() => { setConfirming(false); onDisconnect(); }}>
              Confirm disconnect
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
