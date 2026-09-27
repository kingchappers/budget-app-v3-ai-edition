import { useState } from 'react';
import { Alert, Button, Group, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { parsePounds } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useAddBalance } from '~/lib/queries';
import type { Account } from '~/lib/types';

export function UpdateBalanceSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const save = useAddBalance();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!account) return;
    const parsed = parsePounds(amount);
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(null);
    save.mutate(
      { accountId: account.accountId, input: { date, pence: parsed.pence } },
      { onSuccess: onClose, onError: () => setError('Could not save. Try again.') },
    );
  }

  return (
    <ResponsiveSheet opened={account !== null} onClose={onClose} title={account ? `Update ${account.name}` : 'Update balance'}>
      {account && (
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
      )}
    </ResponsiveSheet>
  );
}
