import { LineChart } from '@mantine/charts';
import { Button, Group, Stack, Table, Text } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { balanceAsOf, updatedAgo } from '~/lib/accounts';
import { formatPence } from '~/lib/money';
import { formatShortDate, todayIso } from '~/lib/months';
import type { Account } from '~/lib/types';

export function AccountHistorySheet({
  account, onClose, onUpdate,
}: {
  account: Account | null;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const entries = account ? [...account.balances].reverse() : [];
  const balance = account ? balanceAsOf(account.balances, todayIso()) : 0;

  return (
    <ResponsiveSheet opened={account !== null} onClose={onClose} title={account?.name ?? 'Account'}>
      {account && (
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed">Balance</Text>
              <Text fw={700} size="xl">{formatPence(balance)}</Text>
              <Text size="xs" c="dimmed">{updatedAgo(account.balances, todayIso())}</Text>
            </div>
            <Button size="compact-sm" onClick={onUpdate}>Update</Button>
          </Group>

          {account.balances.length === 0 ? (
            <Text c="dimmed" size="sm">No balance history yet.</Text>
          ) : (
            <>
              <LineChart
                h={160}
                data={account.balances.map(entry => ({ date: formatShortDate(entry.date), Balance: entry.pence }))}
                dataKey="date"
                series={[{ name: 'Balance', color: 'teal.6' }]}
                valueFormatter={formatPence}
                withDots={false}
              />
              <Table>
                <Table.Thead>
                  <Table.Tr><Table.Th>Date</Table.Th><Table.Th>Balance</Table.Th></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {entries.map(entry => (
                    <Table.Tr key={entry.date}>
                      <Table.Td>{formatShortDate(entry.date)}</Table.Td>
                      <Table.Td>{formatPence(entry.pence)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
