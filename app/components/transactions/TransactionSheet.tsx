import { useEffect, useState } from 'react';
import { Button, Drawer, Group, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useSnapshotWhileOpen } from '~/hooks/useSnapshotWhileOpen';
import { parsePounds, formatPencePlain } from '~/lib/money';
import { currentYearMonth, dateChoiceFor, todayIso, yesterdayIso, type DateChoice } from '~/lib/months';
import { useCategories, useCreateTransaction, useTransactions, useUpdateTransaction } from '~/lib/queries';
import { topCategories } from '~/lib/transactions';
import { TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes';
import type { Transaction, TransactionType } from '~/lib/types';
import { CategoryChips } from './CategoryChips';

const CHIP_LIMIT = 5;

const DATE_OPTIONS: { label: string; value: DateChoice }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Other…', value: 'other' },
];

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
}

export function TransactionSheet({ opened, onClose, yearMonth, editing }: TransactionSheetProps) {
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  const monthTransactions = useSnapshotWhileOpen(useTransactions(currentYearMonth()).data, opened);
  const create = useCreateTransaction();
  const update = useUpdateTransaction(yearMonth);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dateChoice, setDateChoice] = useState<DateChoice>('today');
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
    }
    setNoteOpen(false);
    setError(null);
  }, [opened, editing]);

  const eligible = categories.filter(c => c.type === categoryTypeFor(type));
  const chips = topCategories(monthTransactions ?? [], categories, type, CHIP_LIMIT);

  function chooseDate(choice: DateChoice): void {
    setDateChoice(choice);
    if (choice === 'today') setDate(todayIso());
    if (choice === 'yesterday') setDate(yesterdayIso());
  }

  async function handleSave(): Promise<void> {
    const parsed = parsePounds(amount);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (!categoryId) {
      setError('Choose a category');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Date must be YYYY-MM-DD');
      return;
    }

    const input = { amount: parsed.pence, type, categoryId, description, date };

    try {
      if (editing) {
        await update.mutateAsync({ transactionId: editing.transactionId, input });
      } else {
        await create.mutateAsync(input);
      }
      onClose();
    } catch {
      setError('Could not save. Check your connection and try again.');
    }
  }

  const pending = create.isPending || update.isPending;

  const form = (
    <form onSubmit={e => { e.preventDefault(); void handleSave(); }}>
      <Stack>
        <TextInput
          label="Amount"
          placeholder="0.00"
          leftSection="£"
          inputMode="decimal"
          data-autofocus
          value={amount}
          onChange={e => setAmount(e.currentTarget.value)}
          error={error}
        />
        <SegmentedControl
          fullWidth
          value={type}
          onChange={value => { setType(value as TransactionType); setCategoryId(null); }}
          data={TYPE_OPTIONS}
        />
        <CategoryChips
          chips={chips}
          all={eligible}
          value={categoryId}
          onChange={setCategoryId}
          loading={categoriesLoading}
          error={categoriesError ? 'Could not load categories' : null}
        />
        {editing ? (
          <DateInput
            label="Date"
            valueFormat="DD/MM/YYYY"
            value={date}
            onChange={value => setDate(value ?? '')}
          />
        ) : (
          <>
            <SegmentedControl
              fullWidth
              aria-label="Quick date"
              value={dateChoice}
              onChange={value => chooseDate(value as DateChoice)}
              data={DATE_OPTIONS}
            />
            {dateChoice === 'other' && (
              <DateInput
                label="Date"
                valueFormat="DD/MM/YYYY"
                value={date}
                onChange={value => setDate(value ?? '')}
              />
            )}
          </>
        )}
        {editing || noteOpen ? (
          <TextInput
            label="Note (optional)"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            maxLength={200}
          />
        ) : (
          <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNoteOpen(true)}>
            + Add note
          </Button>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={pending}>Save</Button>
        </Group>
      </Stack>
    </form>
  );

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto"
      title={editing ? 'Edit transaction' : 'Add transaction'}>
      {form}
    </Drawer>
  );
}
