import { useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { AccountRow } from '~/components/accounts/AccountRow';
import { balanceAsOf, netWorthAsOf, typeOptionsForKind } from '~/lib/accounts';
import { todayIso } from '~/lib/months';
import { formatPence } from '~/lib/money';
import { useAccounts, useCreateAccount, useDeleteAccount } from '~/lib/queries';
import type { Account, AccountKind, AccountType } from '~/lib/types';

function AccountsContent() {
  const accounts = useAccounts();
  const create = useCreateAccount();
  const remove = useDeleteAccount();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('ASSET');
  const [type, setType] = useState<AccountType>('CASH');
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  if (accounts.error) {
    return (
      <Alert color="danger" title="Could not load accounts">
        <Button onClick={() => accounts.refetch()}>Try again</Button>
      </Alert>
    );
  }
  if (accounts.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = accounts.data ?? [];
  const today = todayIso();
  const assets = all.filter(a => a.kind === 'ASSET');
  const liabilities = all.filter(a => a.kind === 'LIABILITY');
  const totalAssets = netWorthAsOf(assets, today);
  const totalLiabilities = liabilities.reduce((sum, account) => sum + balanceAsOf(account.balances, today), 0);
  const netWorth = totalAssets - totalLiabilities;

  return (
    <Stack>
      <Title order={3}>Accounts</Title>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Text>Assets: {formatPence(totalAssets)}</Text>
        <Text>Liabilities: {formatPence(totalLiabilities)}</Text>
        <Group gap={4}>
          <Text fw={700}>Net worth:</Text>
          <Text fw={700}>{formatPence(netWorth)}</Text>
        </Group>
      </SimpleGrid>

      <Group align="flex-end">
        <TextInput label="Name" placeholder="e.g. Lloyds" style={{ flex: 1, minWidth: 160 }}
          value={name} onChange={e => setName(e.currentTarget.value)} />
        <Select
          label="Kind"
          data={[{ value: 'ASSET', label: 'Asset' }, { value: 'LIABILITY', label: 'Liability' }]}
          value={kind}
          onChange={v => {
            const next = v as AccountKind;
            setKind(next);
            setType(typeOptionsForKind(next)[0].value);
          }}
          allowDeselect={false}
        />
        <Select label="Type" data={typeOptionsForKind(kind)} value={type}
          onChange={v => { if (v) setType(v as AccountType); }} allowDeselect={false} />
        <Button
          disabled={name.trim() === ''}
          loading={create.isPending}
          onClick={() => {
            create.mutate({ name: name.trim(), kind, type });
            setName('');
          }}
        >
          Add
        </Button>
      </Group>

      {all.length === 0 && <Text c="dimmed">No accounts yet. Add one above.</Text>}

      {assets.length > 0 && (
        <div>
          <Title order={5} mt="md" mb="xs">Assets</Title>
          {assets.map(account => (
            <AccountRow key={account.accountId} account={account} onOpen={() => {}} onDelete={() => setPendingDelete(account)} />
          ))}
        </div>
      )}

      {liabilities.length > 0 && (
        <div>
          <Title order={5} mt="md" mb="xs">Liabilities</Title>
          {liabilities.map(account => (
            <AccountRow key={account.accountId} account={account} onOpen={() => {}} onDelete={() => setPendingDelete(account)} />
          ))}
        </div>
      )}

      <Modal opened={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete account" centered>
        <Stack>
          <Text>Delete {pendingDelete?.name}? This can't be undone.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button color="danger" onClick={() => {
              if (!pendingDelete) return;
              remove.mutate(pendingDelete.accountId);
              setPendingDelete(null);
            }}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default function Accounts() {
  return (
    <DefaultLayout>
      <AccountsContent />
    </DefaultLayout>
  );
}
