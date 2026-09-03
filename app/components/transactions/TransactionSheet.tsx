import { useEffect, useState } from 'react';
import { Button, Drawer, Group, SegmentedControl, Select, Stack, TextInput } from '@mantine/core';
import { parsePounds, formatPencePlain } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useCategories, useCreateTransaction, useUpdateTransaction } from '~/lib/queries';
import type { Transaction, TransactionType } from '~/lib/types';

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
}

const TYPE_OPTIONS: { label: string; value: TransactionType }[] = [
  { label: 'Spend', value: 'EXPENSE' },
  { label: 'Income', value: 'INCOME' },
  { label: 'Invest in', value: 'INVESTMENT_IN' },
  { label: 'Invest out', value: 'INVESTMENT_OUT' },
];

export function TransactionSheet({ opened, onClose, yearMonth, editing }: TransactionSheetProps) {
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  const create = useCreateTransaction(yearMonth);
  const update = useUpdateTransaction(yearMonth);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
    }
    setError(null);
  }, [opened, editing]);

  const expectedCategoryType =
    type === 'EXPENSE' ? 'EXPENSE' : type === 'INCOME' ? 'INCOME' : 'INVESTMENT';

  const options = categories
    .filter(c => c.type === expectedCategoryType)
    .map(c => ({ value: c.categoryId, label: c.name }));

  async function handleSave() {
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

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto"
      title={editing ? 'Edit transaction' : 'Add transaction'}>
      <Stack>
        <TextInput
          label="Amount"
          placeholder="0.00"
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
        <Select
          label="Category"
          placeholder={categoriesLoading ? 'Loading categories…' : 'Choose'}
          searchable
          disabled={categoriesLoading}
          data={options}
          value={categoryId}
          onChange={setCategoryId}
          error={categoriesError ? 'Could not load categories' : null}
        />
        <TextInput
          label="Note (optional)"
          value={description}
          onChange={e => setDescription(e.currentTarget.value)}
          maxLength={200}
        />
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={e => setDate(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={pending}>Save</Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
