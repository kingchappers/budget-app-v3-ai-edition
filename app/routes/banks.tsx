import { useState } from 'react';
import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { ConnectBankModal } from '~/components/banks/ConnectBankModal';
import { ConnectionCard } from '~/components/banks/ConnectionCard';
import { SyncNowButton } from '~/components/banks/SyncNowButton';
import { useConnections, useDisconnectBank } from '~/lib/queries';
import type { BankConnection } from '~/lib/types';

function BanksContent() {
  const connections = useConnections();
  const disconnect = useDisconnectBank();
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState<BankConnection | null>(null);
  const nowMs = Date.now();

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Title order={2}>Banks</Title>
        <Group gap="xs" align="flex-start">
          <SyncNowButton />
          <Button onClick={() => setConnectOpen(true)}>Connect a bank</Button>
        </Group>
      </Group>

      {connections.isLoading && <Loader size="sm" />}
      {connections.isError && <Alert color="danger">Could not load your bank connections.</Alert>}
      {connections.data?.length === 0 && (
        <Text c="dimmed">No banks connected yet. Connect a bank to import transactions into your inbox for review.</Text>
      )}
      {connections.data?.map(connection => (
        <ConnectionCard
          key={connection.connectionId}
          connection={connection}
          nowMs={nowMs}
          onReconnect={() => setReconnecting(connection)}
          onDisconnect={() => disconnect.mutate(connection.connectionId)}
        />
      ))}

      <ConnectBankModal opened={connectOpen} onClose={() => setConnectOpen(false)} />
      {reconnecting && (
        <ConnectBankModal opened reconnect={reconnecting} onClose={() => setReconnecting(null)} />
      )}
    </Stack>
  );
}

export default function Banks() {
  return (
    <DefaultLayout>
      <BanksContent />
    </DefaultLayout>
  );
}
