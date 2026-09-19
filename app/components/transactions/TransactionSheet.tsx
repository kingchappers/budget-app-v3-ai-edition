import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Group, Modal, SegmentedControl, Stack, Text, TextInput, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useNoteHistory } from '~/hooks/useNoteHistory';
import { useSnapshotWhileOpen } from '~/hooks/useSnapshotWhileOpen';
import type { TransactionInput } from '~/lib/api';
import { formatPence, formatPencePlain, parsePounds } from '~/lib/money';
import { currentYearMonth, dateChoiceFor, todayIso, yesterdayIso, type DateChoice } from '~/lib/months';
import { categoryForNote } from '~/lib/noteMemory';
import { parseQuickAdd } from '~/lib/quickAdd';
import {
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from '~/lib/queries';
import { topCategories } from '~/lib/transactions';
import { TYPE_OPTIONS, categoryTypeFor } from '~/lib/transactionTypes';
import type { Transaction, TransactionType } from '~/lib/types';
import { CategoryChips } from './CategoryChips';

const CHIP_LIMIT = 5;
const TOAST_MS = 5000;

const DATE_OPTIONS: { label: string; value: DateChoice }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Other…', value: 'other' },
];

type SaveMode = 'close' | 'addAnother';
type CategorySource = 'none' | 'memory' | 'user';

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
  template?: Transaction | null;
}

interface ToastActionProps {
  text: string;
  actionLabel: string;
  onAction: () => void;
}

function ToastAction({ text, actionLabel, onAction }: ToastActionProps) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm">{text}</Text>
      <Button variant="subtle" size="compact-sm" onClick={onAction}>{actionLabel}</Button>
    </Group>
  );
}

export function TransactionSheet({ opened, onClose, yearMonth, editing, template }: TransactionSheetProps) {
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  const monthTransactions = useSnapshotWhileOpen(useTransactions(currentYearMonth(), opened).data, opened);
  const noteIndex = useNoteHistory(opened);
  const create = useCreateTransaction();
  const update = useUpdateTransaction(yearMonth);
  const remove = useDeleteTransaction();
  const amountRef = useRef<HTMLInputElement>(null);
  const createSubmittedRef = useRef(false);
  const saveAnotherRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const focusChipsAfterRenderRef = useRef(false);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dateChoice, setDateChoice] = useState<DateChoice>('today');
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categorySource, setCategorySource] = useState<CategorySource>('none');
  const [quickAdd, setQuickAdd] = useState('');
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    createSubmittedRef.current = false;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
      setCategorySource('none');
    } else if (template) {
      setAmount(formatPencePlain(template.amount));
      setType(template.type);
      setCategoryId(template.categoryId);
      setDescription(template.description);
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('user');
    } else {
      setAmount('');
      setType('EXPENSE');
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('none');
    }
    setNoteOpen(!editing && template != null && template.description !== '');
    setError(null);
    setQuickAdd('');
    setQuickAddError(null);
  }, [opened, editing, template]);

  useEffect(() => {
    if (!focusChipsAfterRenderRef.current) return;
    focusChipsAfterRenderRef.current = false;
    chipsRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  });

  const eligible = categories.filter(c => c.type === categoryTypeFor(type));
  const chips = topCategories(monthTransactions ?? [], categories, type, CHIP_LIMIT);

  function chooseDate(choice: DateChoice): void {
    setDateChoice(choice);
    if (choice === 'today') setDate(todayIso());
    if (choice === 'yesterday') setDate(yesterdayIso());
  }

  function handleCategoryChange(id: string): void {
    setCategoryId(id);
    setCategorySource('user');
  }

  function handleNoteChange(note: string): void {
    setDescription(note);
    if (editing || categorySource === 'user') return;

    const recalled = categoryForNote(noteIndex, note, type, categories);
    if (recalled) {
      setCategoryId(recalled);
      setCategorySource('memory');
      return;
    }
    if (categorySource === 'memory') {
      setCategoryId(null);
      setCategorySource('none');
    }
  }

  function handleTypeChange(next: TransactionType): void {
    setType(next);
    const recalled = editing ? null : categoryForNote(noteIndex, description, next, categories);
    setCategoryId(recalled);
    setCategorySource(recalled ? 'memory' : 'none');
  }

  function handleQuickAddChange(value: string): void {
    setQuickAdd(value);
    setQuickAddError(null);
  }

  function handleQuickAddKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const parsed = parseQuickAdd(quickAdd);
    if (!parsed.ok) {
      setQuickAddError(parsed.message);
      return;
    }

    const recalled = categoryForNote(noteIndex, parsed.note, parsed.type, categories);
    setAmount(formatPencePlain(parsed.amount));
    setType(parsed.type);
    setDescription(parsed.note);
    if (parsed.note !== '') setNoteOpen(true);
    setCategoryId(recalled);
    setCategorySource(recalled ? 'memory' : 'none');
    setError(null);
    setQuickAdd('');
    setQuickAddError(null);

    if (recalled) {
      saveAnotherRef.current?.focus();
      return;
    }
    focusChipsAfterRenderRef.current = true;
  }

  function validate(): TransactionInput | null {
    const parsed = parsePounds(amount);
    if (!parsed.ok) {
      setError(parsed.message);
      return null;
    }
    if (!categoryId) {
      setError('Choose a category');
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Date must be YYYY-MM-DD');
      return null;
    }
    return { amount: parsed.pence, type, categoryId, description, date };
  }

  function describeInput(input: TransactionInput): string {
    const categoryName = categories.find(c => c.categoryId === input.categoryId)?.name ?? 'Transaction';
    return `${formatPence(input.amount)} · ${categoryName}`;
  }

  function showFailureToast(input: TransactionInput): void {
    const toastId = `failed-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      color: 'danger',
      autoClose: false,
      message: (
        <ToastAction
          text={`Couldn't save ${describeInput(input)}`}
          actionLabel="Retry"
          onAction={() => {
            notifications.hide(toastId);
            submitNew(input);
          }}
        />
      ),
    });
  }

  function submitNew(input: TransactionInput): void {
    const toastId = `saved-${crypto.randomUUID()}`;
    let undone = false;
    const outcome = create.mutateAsync(input).then(
      created => created,
      () => {
        notifications.hide(toastId);
        // A cancelled entry must not offer Retry, or one tap would re-create it.
        if (!undone) showFailureToast(input);
        return null;
      },
    );

    notifications.show({
      id: toastId,
      autoClose: TOAST_MS,
      message: (
        <ToastAction
          text={`Saved ${describeInput(input)}`}
          actionLabel="Undo"
          onAction={() => {
            undone = true;
            notifications.hide(toastId);
            void outcome.then(created => {
              if (!created) return;
              remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
            });
          }}
        />
      ),
    });
  }

  function resetForNextEntry(): void {
    createSubmittedRef.current = false;
    setAmount('');
    setCategoryId(null);
    setCategorySource('none');
    setDescription('');
    setNoteOpen(false);
    setQuickAdd('');
    setQuickAddError(null);
    setError(null);
    amountRef.current?.focus();
  }

  async function handleSubmit(mode: SaveMode): Promise<void> {
    const input = validate();
    if (!input) return;

    if (editing) {
      try {
        await update.mutateAsync({ transactionId: editing.transactionId, input });
        onClose();
      } catch {
        setError('Could not save. Check your connection and try again.');
      }
      return;
    }

    if (createSubmittedRef.current) return;
    createSubmittedRef.current = true;
    submitNew(input);
    if (mode === 'addAnother') {
      resetForNextEntry();
      return;
    }
    onClose();
  }

  const form = (
    <form onSubmit={e => { e.preventDefault(); void handleSubmit(editing ? 'close' : 'addAnother'); }}>
      <Stack>
        {!editing && (
          <TextInput
            label="Quick add"
            description="e.g. coffee 3.50 · 3.50 coffee · +2400 salary (income)"
            placeholder="coffee 3.50"
            value={quickAdd}
            error={quickAddError}
            onChange={e => handleQuickAddChange(e.currentTarget.value)}
            onKeyDown={handleQuickAddKeyDown}
          />
        )}
        <TextInput
          ref={amountRef}
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
          onChange={value => handleTypeChange(value as TransactionType)}
          data={TYPE_OPTIONS}
        />
        <div ref={chipsRef}>
          <CategoryChips
            chips={chips}
            all={eligible}
            value={categoryId}
            onChange={handleCategoryChange}
            loading={categoriesLoading}
            error={categoriesError ? 'Could not load categories' : null}
          />
        </div>
        {categorySource === 'memory' && description.trim() !== '' && (
          <Text size="xs" c="dimmed" role="status">Suggested from your earlier '{description.trim()}'</Text>
        )}
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
            onChange={e => handleNoteChange(e.currentTarget.value)}
            maxLength={200}
          />
        ) : (
          <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNoteOpen(true)}>
            + Add note
          </Button>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          {editing ? (
            <Button type="submit" loading={update.isPending}>Save</Button>
          ) : (
            <>
              <Button ref={saveAnotherRef} type="submit" variant="light">Save & add another</Button>
              <Button onClick={() => void handleSubmit('close')}>Save</Button>
            </>
          )}
        </Group>
      </Stack>
    </form>
  );

  const title = editing ? 'Edit transaction' : 'Add transaction';

  if (isDesktop) {
    return (
      <Modal opened={opened} onClose={onClose} title={title} centered size={440}>
        {form}
      </Modal>
    );
  }

  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" title={title}>
      {form}
    </Drawer>
  );
}
