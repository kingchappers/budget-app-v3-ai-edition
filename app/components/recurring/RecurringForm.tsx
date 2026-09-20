import { useEffect, useState } from 'react';
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { formatPencePlain } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useCategories, useCreateRecurring, useUpdateRecurring } from '~/lib/queries';
import { validateRecurringForm, type RecurringFormErrors } from '~/lib/recurring';
import { TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes';
import type { Recurring, TransactionType } from '~/lib/types';

const DEFAULT_LEAD_DAYS = 3;

export interface RecurringDraft {
  type: TransactionType;
  categoryId: string;
  amount: number;
  description: string;
  dayOfMonth: number;
}

export interface RecurringFormProps {
  opened: boolean;
  onClose: () => void;
  editing?: Recurring | null;
  draft?: RecurringDraft | null;
}

export function RecurringForm({ opened, onClose, editing, draft }: RecurringFormProps) {
  const { data: categories = [] } = useCategories();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState<number | string>(1);
  const [leadDays, setLeadDays] = useState<number | string>(DEFAULT_LEAD_DAYS);
  const [errors, setErrors] = useState<RecurringFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    const source = editing ?? draft ?? null;
    setType(source?.type ?? 'EXPENSE');
    setCategoryId(source?.categoryId ?? null);
    setAmount(source ? formatPencePlain(source.amount) : '');
    setDescription(source?.description ?? '');
    setDayOfMonth(source?.dayOfMonth ?? Number(todayIso().slice(8, 10)));
    setLeadDays(editing?.leadDays ?? DEFAULT_LEAD_DAYS);
    setErrors({});
    setFormError(null);
  }, [opened, editing, draft]);

  const options = categories
    .filter(c => c.type === categoryTypeFor(type))
    .map(c => ({ value: c.categoryId, label: c.name }));
  const pending = create.isPending || update.isPending;

  async function handleSubmit(): Promise<void> {
    const result = validateRecurringForm({ type, categoryId, amount, description, dayOfMonth, leadDays });
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(null);
      return;
    }

    setErrors({});
    try {
      if (editing) {
        await update.mutateAsync({ recurringId: editing.recurringId, input: result.value });
      } else {
        await create.mutateAsync(result.value);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save recurring template', { recurringId: editing?.recurringId, error });
      setFormError('Could not save. Check your connection and try again.');
    }
  }

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={editing ? 'Edit recurring item' : 'New recurring item'}>
      <form onSubmit={e => { e.preventDefault(); void handleSubmit(); }}>
        <Stack>
          <SegmentedControl
            fullWidth
            value={type}
            onChange={value => { setType(value as TransactionType); setCategoryId(null); }}
            data={TYPE_OPTIONS}
          />
          <TextInput
            label="Amount"
            placeholder="0.00"
            leftSection="£"
            inputMode="decimal"
            data-autofocus
            value={amount}
            onChange={e => setAmount(e.currentTarget.value)}
            error={errors.amount}
          />
          <Select
            label="Category"
            placeholder="Choose"
            searchable
            data={options}
            value={categoryId}
            onChange={setCategoryId}
            error={errors.category}
          />
          <TextInput
            label="Note (optional)"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
            maxLength={200}
            error={errors.description}
          />
          <Group grow align="flex-start">
            <NumberInput
              label="Day of month"
              min={1}
              max={31}
              allowDecimal={false}
              clampBehavior="none"
              value={dayOfMonth}
              onChange={setDayOfMonth}
              error={errors.dayOfMonth}
            />
            <NumberInput
              label="Remind me (days before)"
              min={0}
              max={14}
              allowDecimal={false}
              clampBehavior="none"
              value={leadDays}
              onChange={setLeadDays}
              error={errors.leadDays}
            />
          </Group>
          {formError && <Text size="sm" c="danger">{formError}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </Group>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}
