import { useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { formatPence } from '~/lib/money';
import { currentYearMonth, formatShortDate, todayIso } from '~/lib/months';
import { useArchivePot, useCreateTransaction, useRecurring, useUnarchivePot } from '~/lib/queries';
import type { Category, PotSummary, TransactionType } from '~/lib/types';

interface Settlement {
  type: TransactionType;
  amount: number;
  intro: string;
  button: string;
}

// Archiving stops this month's auto-adding, so it is not part of what is left to settle.
function settlementFor(pot: PotSummary, name: string): Settlement | null {
  const leftover = pot.balance - pot.autoAmountNow;
  if (leftover === 0) return null;
  const amount = formatPence(Math.abs(leftover));
  if (leftover > 0) {
    return {
      type: 'TAKE_OUT',
      amount: leftover,
      intro: `${name} still holds ${amount}. Take it from the pot first, so it goes back to your everyday money.`,
      button: `Take ${amount} from pot and archive`,
    };
  }
  return {
    type: 'SET_ASIDE',
    amount: -leftover,
    intro: `${name} is ${amount} below zero. Add ${amount} to the pot to bring it to zero, then archive it.`,
    button: `Add ${amount} and archive`,
  };
}

export interface ArchivePotSectionProps {
  pot: PotSummary;
  category: Category | undefined;
  onDone: () => void;
}

export function ArchivePotSection({ pot, category, onDone }: ArchivePotSectionProps) {
  const archive = useArchivePot();
  const unarchive = useUnarchivePot();
  const createTransaction = useCreateTransaction();
  const recurring = useRecurring();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = category?.name ?? 'This pot';
  const recurringCount = (recurring.data ?? []).filter(item => item.categoryId === pot.categoryId).length;

  async function restore(): Promise<void> {
    setWorking(true);
    setError(null);
    try {
      await unarchive.mutateAsync(pot.categoryId);
      onDone();
    } catch (restoreError) {
      console.error(`Failed to unarchive pot ${pot.categoryId}:`, restoreError);
      setError(`Couldn't unarchive ${name}. Try again.`);
    } finally {
      setWorking(false);
    }
  }

  async function settle(settlement: Settlement): Promise<boolean> {
    try {
      await createTransaction.mutateAsync({
        amount: settlement.amount,
        type: settlement.type,
        categoryId: pot.categoryId,
        description: `Closing ${name}`,
        date: todayIso(),
      });
      return true;
    } catch (settleError) {
      console.error(`Failed to balance pot ${pot.categoryId} before archiving:`, settleError);
      setError(`Couldn't archive ${name}. Nothing was changed. Try again.`);
      return false;
    }
  }

  async function confirmArchive(settlement: Settlement | null): Promise<void> {
    setWorking(true);
    setError(null);
    try {
      if (settlement && !(await settle(settlement))) return;
      try {
        await archive.mutateAsync({ categoryId: pot.categoryId, month: currentYearMonth() });
        onDone();
      } catch (archiveError) {
        console.error(`Failed to archive pot ${pot.categoryId}:`, archiveError);
        setError(settlement
          ? `${formatPence(settlement.amount)} was ${settlement.type === 'TAKE_OUT' ? 'taken from' : 'added to'} the pot, but it wasn't archived. Try again.`
          : `Couldn't archive ${name}. Nothing was changed. Try again.`);
      }
    } finally {
      setWorking(false);
    }
  }

  if (pot.archivedAt) {
    return (
      <Stack gap="sm">
        <Text fw={600}>Archived</Text>
        <Text size="sm">Archived on {formatShortDate(pot.archivedAt.slice(0, 10))}. It is hidden from your pots and from the pickers when you add an entry.</Text>
        {error && <Alert color="danger" role="alert">{error}</Alert>}
        <Group>
          <Button variant="light" loading={working} onClick={restore}>Unarchive</Button>
        </Group>
      </Stack>
    );
  }

  const settlement = settlementFor(pot, name);

  if (!confirming) {
    return (
      <Group>
        <Button variant="subtle" onClick={() => setConfirming(true)}>Archive pot</Button>
      </Group>
    );
  }

  return (
    <Stack gap="sm">
      <Text fw={600}>Archive {name}</Text>
      {settlement
        ? <Text size="sm">{settlement.intro}</Text>
        : <Text size="sm">Archiving hides {name} from your pots and stops its auto-adding. Its history stays under Archived.</Text>}
      {recurringCount > 0 && (
        <Text size="sm">
          {recurringCount} recurring {recurringCount === 1 ? 'item' : 'items'} for {name} will be cancelled. You can restore {recurringCount === 1 ? 'it' : 'them'} from Recently deleted for 30 days.
        </Text>
      )}
      {error && <Alert color="danger" role="alert">{error}</Alert>}
      <Group>
        <Button loading={working} onClick={() => confirmArchive(settlement)}>
          {settlement ? settlement.button : `Archive ${name}`}
        </Button>
        <Button variant="subtle" disabled={working} onClick={() => { setConfirming(false); setError(null); }}>Cancel</Button>
      </Group>
    </Stack>
  );
}
