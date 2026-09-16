import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { earliestStartDate } from '~/lib/banks';
import { stashBankCallback } from '~/lib/bankCallback';
import { todayIso } from '~/lib/months';
import { useConnectBank } from '~/lib/queries';

export interface ConnectBankModalProps {
  opened: boolean;
  onClose: () => void;
  redirect?: (url: string) => void;
}

const goTo = (url: string) => window.location.assign(url);

export function ConnectBankModal({ opened, onClose, redirect = goTo }: ConnectBankModalProps) {
  const today = todayIso();
  const connect = useConnectBank();
  const [startDate, setStartDate] = useState<string>(today);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const { url, state } = await connect.mutateAsync({ startDate });
      stashBankCallback(window.sessionStorage, { state });
      redirect(url);
    } catch (cause) {
      console.error('Failed to start bank connection', cause);
      setError('Could not start the bank connection. Please try again.');
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Connect a bank">
      <Stack>
        <Text size="sm">
          You will be sent to your bank to approve access. TrueLayer will show your bank&apos;s own search.
        </Text>
        <DateInput
          label="Import transactions from"
          description="Pick the day after your manually entered transactions end"
          valueFormat="DD/MM/YYYY"
          value={startDate}
          onChange={value => setStartDate(value ?? today)}
          minDate={earliestStartDate(today)}
          maxDate={today}
        />
        {error && <Text c="danger" size="sm">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={connect.isPending}>Connect</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
