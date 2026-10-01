import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { categorySelectData } from '~/lib/categoryGroups';
import { formatPence, formatPencePlain } from '~/lib/money';
import { todayIso } from '~/lib/months';
import { useCategories, useCreateRecurring, useUpdateRecurring } from '~/lib/queries';
import {
  DEFAULT_LEAD_DAYS,
  FREQUENCY_OPTIONS,
  MAX_LEAD_DAYS,
  frequencyOf,
  monthlyPotAmount,
  validateRecurringForm,
  type RecurringFormErrors,
} from '~/lib/recurring';
import { TYPE_OPTIONS, categoryTypesFor } from '~/lib/transactionTypes';
import type { Recurring, RecurringFrequency, TransactionType } from '~/lib/types';

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

interface PotOffer {
  monthly: number;
  total: number;
  months: number;
}

function monthsBetween(frequency: RecurringFrequency): number {
  return frequency === 'YEARLY' ? 12 : 3;
}

export function RecurringForm({ opened, onClose, editing, draft }: RecurringFormProps) {
  const navigate = useNavigate();
  const { data: categories = [] } = useCategories();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState<number | string>(1);
  const [leadDays, setLeadDays] = useState<number | string>(DEFAULT_LEAD_DAYS.MONTHLY);
  const [frequency, setFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [anchorDate, setAnchorDate] = useState('');
  const [leadTouched, setLeadTouched] = useState(false);
  const [potOffer, setPotOffer] = useState<PotOffer | null>(null);
  const [potId, setPotId] = useState<string | null>(null);
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
    const sourceFrequency = editing ? frequencyOf(editing) : 'MONTHLY';
    setFrequency(sourceFrequency);
    setAnchorDate(editing?.anchorDate ?? '');
    setLeadDays(editing?.leadDays ?? DEFAULT_LEAD_DAYS[sourceFrequency]);
    setLeadTouched(editing !== null && editing !== undefined);
    setPotOffer(null);
    setPotId(null);
    setErrors({});
    setFormError(null);
  }, [opened, editing, draft]);

  const filteredCategories = categories.filter(c => categoryTypesFor(type).includes(c.type));
  const options = categorySelectData(filteredCategories);
  const pending = create.isPending || update.isPending;
  const pots = categories.filter(c => c.type === 'POT');
  const maxLead = MAX_LEAD_DAYS[frequency];

  function changeFrequency(next: RecurringFrequency): void {
    setFrequency(next);
    if (next !== 'MONTHLY' && anchorDate === '') setAnchorDate(todayIso());
    if (!leadTouched) {
      setLeadDays(DEFAULT_LEAD_DAYS[next]);
      return;
    }
    const current = typeof leadDays === 'number' ? leadDays : Number(leadDays);
    if (Number.isFinite(current) && current > MAX_LEAD_DAYS[next]) setLeadDays(MAX_LEAD_DAYS[next]);
  }

  function offerFor(input: { amount: number; type: TransactionType }): PotOffer | null {
    if (input.type !== 'EXPENSE') return null;
    const monthly = monthlyPotAmount(input.amount, frequency);
    if (monthly === null) return null;
    return { monthly, total: input.amount, months: monthsBetween(frequency) };
  }

  function openPotSettings(offer: PotOffer): void {
    if (!potId) return;
    onClose();
    navigate(`/pots?pot=${encodeURIComponent(potId)}&monthly=${offer.monthly}`);
  }

  async function handleSubmit(): Promise<void> {
    const validCategoryId = filteredCategories.some(c => c.categoryId === categoryId) ? categoryId : null;
    const result = validateRecurringForm({
      type, categoryId: validCategoryId, amount, description, dayOfMonth, leadDays, frequency, anchorDate,
    });
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
      const offer = offerFor(result.value);
      if (offer) {
        setPotOffer(offer);
        setPotId(pots[0]?.categoryId ?? null);
        return;
      }
      onClose();
    } catch (error) {
      console.error('Failed to save recurring template', { recurringId: editing?.recurringId, error });
      setFormError('Could not save. Check your connection and try again.');
    }
  }

  if (potOffer) {
    return (
      <ResponsiveSheet opened={opened} onClose={onClose} title="Saved">
        <Stack>
          <Text fw={600}>{`Put aside ${formatPence(potOffer.monthly)} a month for this?`}</Text>
          <Text size="sm" c="dimmed">
            {`Over ${potOffer.months} months that covers the ${formatPence(potOffer.total)} by the time it comes round.`}
          </Text>
          {pots.length > 0 ? (
            <Select
              label="Pot"
              data={pots.map(pot => ({ value: pot.categoryId, label: pot.name }))}
              value={potId}
              onChange={setPotId}
              allowDeselect={false}
            />
          ) : (
            <Text size="sm">You don't have a pot yet. Create one, then set its monthly amount.</Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>No thanks</Button>
            {pots.length > 0 ? (
              <Button onClick={() => openPotSettings(potOffer)}>Open pot settings</Button>
            ) : (
              <Button component={Link} to="/categories" onClick={onClose}>Create a pot</Button>
            )}
          </Group>
        </Stack>
      </ResponsiveSheet>
    );
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
          <Select
            label="Repeats"
            data={FREQUENCY_OPTIONS}
            value={frequency}
            onChange={value => { if (value) changeFrequency(value as RecurringFrequency); }}
            allowDeselect={false}
          />
          <Group grow align="flex-start">
            {frequency === 'MONTHLY' ? (
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
            ) : (
              <DateInput
                label="Date it is due"
                description="Any date it falls on works. It repeats from there."
                valueFormat="DD/MM/YYYY"
                value={anchorDate || null}
                onChange={value => setAnchorDate(value ?? '')}
                error={errors.anchorDate}
              />
            )}
            <NumberInput
              label="Remind me (days before)"
              min={0}
              max={maxLead}
              allowDecimal={false}
              clampBehavior="none"
              value={leadDays}
              onChange={value => { setLeadDays(value); setLeadTouched(true); }}
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
