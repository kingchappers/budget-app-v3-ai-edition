import { useState } from 'react';
import { Alert, Button, Group, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { parseBalance } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useAddBalance } from '~/lib/queries';
import type { Account } from '~/lib/types';

function UpdateBalanceForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const save = useAddBalance();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const parsed = parseBalance(amount);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    save.mutate(
      { accountId: account.accountId, input: { date, pence: parsed.pence } },
      { onSuccess: onClose, onError: () => setError('Could not save. Try again.') },
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <DateInput label="Date" valueFormat="DD/MM/YYYY" value={date} onChange={value => setDate(value ?? todayIso())} />
        <TextInput label="Balance" placeholder="0.00" leftSection="£" inputMode="decimal"
          value={amount} onChange={e => setAmount(e.currentTarget.value)} />
        {error && <Alert color="danger" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>Save</Button>
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
      {account && <UpdateBalanceForm key={account.accountId} account={account} onClose={onClose} />}
    </ResponsiveSheet>
  );
}
