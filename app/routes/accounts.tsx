import { useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { SaveStatus, type SaveState } from '~/components/layout/SaveStatus';
import { AccountRow } from '~/components/accounts/AccountRow';
import { AccountHistorySheet } from '~/components/accounts/AccountHistorySheet';
import { UpdateBalanceSheet } from '~/components/accounts/UpdateBalanceSheet';
import { useUndoableDelete } from '~/hooks/useUndoableDelete';
import { balanceAsOf, netWorthAsOf, typeOptionsForKind } from '~/lib/accounts';
import { todayIso } from '~/lib/months';
import { formatPence } from '~/lib/money';
import { accountDeleteSummary } from '~/lib/trash';
import { useAccounts, useCreateAccount, useDeleteAccount } from '~/lib/queries';
import type { Account, AccountKind, AccountType } from '~/lib/types';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/accounts';

function AccountsContent() {
  const accounts = useAccounts();
  const create = useCreateAccount();
  const remove = useDeleteAccount();
  const undoableDelete = useUndoableDelete();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('ASSET');
  const [type, setType] = useState<AccountType>('CASH');
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openAccount, setOpenAccount] = useState<Account | null>(null);
  const [updatingAccount, setUpdatingAccount] = useState<Account | null>(null);
  const [createState, setCreateState] = useState<SaveState>('idle');

  function addAccount(): void {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setCreateState('saving');
    create.mutate({ name: trimmed, kind, type }, {
      onSuccess: () => {
        setName('');
        setCreateState('saved');
      },
      onError: (createError: Error) => {
        console.error(`Failed to create a ${type} account:`, createError);
        setCreateState('error');
      },
    });
  }

  function requestDelete(account: Account): void {
    setPendingDelete(account);
    setConfirmOpen(true);
  }

  function confirmDelete(): void {
    if (!pendingDelete || !confirmOpen) return;
    const account = pendingDelete;
    setConfirmOpen(false);
    undoableDelete({
      label: accountDeleteSummary(account),
      name: account.name,
      ref: { entityType: 'ACCOUNT', id: account.accountId },
      run: () => remove.mutateAsync(account.accountId),
    });
  }

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
      <Title order={1} size="h3">Accounts</Title>

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
          value={name} onChange={e => { setName(e.currentTarget.value); setCreateState('idle'); }} />
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
        <Button disabled={name.trim() === ''} loading={createState === 'saving'} onClick={addAccount}>
          Add
        </Button>
      </Group>
      <SaveStatus state={createState} onRetry={addAccount} />

      {all.length === 0 && <Text c="dimmed">No accounts yet. Add one above.</Text>}

      {assets.length > 0 && (
        <div>
          <Title order={2} size="h5" mt="md" mb="xs">Assets</Title>
          {assets.map(account => (
            <AccountRow
              key={account.accountId}
              account={account}
              onOpen={() => setOpenAccount(account)}
              onDelete={() => requestDelete(account)}
              onUpdate={() => setUpdatingAccount(account)}
            />
          ))}
        </div>
      )}

      {liabilities.length > 0 && (
        <div>
          <Title order={2} size="h5" mt="md" mb="xs">Liabilities</Title>
          {liabilities.map(account => (
            <AccountRow
              key={account.accountId}
              account={account}
              onOpen={() => setOpenAccount(account)}
              onDelete={() => requestDelete(account)}
              onUpdate={() => setUpdatingAccount(account)}
            />
          ))}
        </div>
      )}

      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onExitTransitionEnd={() => setPendingDelete(null)}
        title="Delete account"
        centered
      >
        {pendingDelete && (
          <Stack>
            <Text>
              {accountDeleteSummary(pendingDelete)} will move to Recently deleted.
              {' '}You can restore {pendingDelete.balances.length > 0 ? 'them' : 'it'} from there for 30 days.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button onClick={confirmDelete}>Delete {accountDeleteSummary(pendingDelete)}</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <AccountHistorySheet
        account={openAccount}
        onClose={() => setOpenAccount(null)}
        onUpdate={() => { setUpdatingAccount(openAccount); setOpenAccount(null); }}
      />
      <UpdateBalanceSheet account={updatingAccount} onClose={() => setUpdatingAccount(null)} />
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Accounts') }];

export default function Accounts() {
  return (
    <DefaultLayout>
      <AccountsContent />
    </DefaultLayout>
  );
}
