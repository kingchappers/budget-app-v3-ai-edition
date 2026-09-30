import { useState } from 'react';
import { Alert, Button, Group, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { SaveStatus, type SaveState } from '~/components/layout/SaveStatus';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { parseBalance } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useAddBalance } from '~/lib/queries';
import type { Account } from '~/lib/types';

function UpdateBalanceForm({ account }: { account: Account }) {
  const save = useAddBalance();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  function send(): void {
    const parsed = parseBalance(amount);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    setSaveState('saving');
    save.mutate(
      { accountId: account.accountId, input: { date, pence: parsed.pence } },
      {
        onSuccess: () => setSaveState('saved'),
        onError: (saveError: Error) => {
          console.error(`Failed to save a balance for account ${account.accountId}:`, saveError);
          setSaveState('error');
        },
      },
    );
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    send();
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <DateInput label="Date" valueFormat="DD/MM/YYYY" value={date} onChange={value => { setDate(value ?? todayIso()); setSaveState('idle'); }} />
        <TextInput label="Balance" placeholder="0.00" leftSection="£" inputMode="decimal"
          value={amount} onChange={e => { setAmount(e.currentTarget.value); setSaveState('idle'); }} />
        {error && <Alert color="danger" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <SaveStatus state={saveState} onRetry={send} />
          <Button type="submit" loading={saveState === 'saving'}>Save</Button>
        </Group>
      </Stack>
    </form>
  );
}

export function UpdateBalanceSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  return (
    <ResponsiveSheet opened={account !== null} onClose={onClose} title={account ? `Update ${account.name}` : 'Update balance'}>
      {/* Keyed by accountId, like PotHistorySheet's settings form, so opening
          a different account starts with fresh date/amount/error state
          instead of carrying over whatever was last typed. */}
      {account && <UpdateBalanceForm key={account.accountId} account={account} />}
    </ResponsiveSheet>
  );
}
