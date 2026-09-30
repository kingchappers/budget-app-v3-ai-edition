import { useEffect, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Button, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { useNoteHistory } from '~/hooks/useNoteHistory';
import { useSaveWithUndo } from '~/hooks/useSaveWithUndo';
import { useSnapshotWhileOpen } from '~/hooks/useSnapshotWhileOpen';
import type { TransactionInput } from '~/lib/api';
import { formatPencePlain, parsePounds } from '~/lib/money';
import { currentYearMonth, dateChoiceFor, todayIso, yesterdayIso, type DateChoice } from '~/lib/months';
import { categoryForNote } from '~/lib/noteMemory';
import { parseQuickAdd } from '~/lib/quickAdd';
import { useCategories, useTransactions, useUpdateTransaction } from '~/lib/queries';
import {
  EMPTY_DRAFT,
  clearTransactionDraft,
  isEmptyDraft,
  loadTransactionDraft,
  saveTransactionDraft,
  type TransactionDraftFields,
} from '~/lib/transactionDraft';
import { topCategories } from '~/lib/transactions';
import { TYPE_OPTIONS, categoryTypesFor } from '~/lib/transactionTypes';
import type { Transaction, TransactionType } from '~/lib/types';
import { CategoryChips } from './CategoryChips';

const CHIP_LIMIT = 5;

const DATE_OPTIONS: { label: string; value: DateChoice }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Other…', value: 'other' },
];

const CATEGORY_ERROR = 'Choose a category';
const DATE_ERROR = 'Enter a date, for example 27/09/2026';
const FIELD_ERROR_PROPS = { role: 'alert' };

type SaveMode = 'close' | 'addAnother';
type CategorySource = 'none' | 'memory' | 'user';
type ErrorField = 'amount' | 'category' | 'date';
type FieldErrors = Partial<Record<ErrorField, string>>;

function dateForChoice(choice: DateChoice, date: string): string {
  if (choice === 'today') return todayIso();
  if (choice === 'yesterday') return yesterdayIso();
  return date;
}

interface Validation {
  input: TransactionInput | null;
  errors: FieldErrors;
}

export interface TransactionSheetProps {
  opened: boolean;
  onClose: () => void;
  yearMonth: string;
  editing?: Transaction | null;
  preset?: { type: TransactionType; categoryId: string } | null;
  template?: Transaction | null;
  templateDate?: string;
  onSaved?: (created: Transaction) => void;
  onUndone?: () => void;
}

export function TransactionSheet({ opened, onClose, yearMonth, editing, preset, template, templateDate, onSaved, onUndone }: TransactionSheetProps) {
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  const monthTransactions = useSnapshotWhileOpen(useTransactions(currentYearMonth(), opened).data, opened);
  const noteIndex = useNoteHistory(opened);
  const update = useUpdateTransaction(yearMonth);
  const saveWithUndo = useSaveWithUndo();
  const draftOwner = useAuth0().user?.sub ?? '';
  const draftOwnerRef = useRef(draftOwner);
  draftOwnerRef.current = draftOwner;
  const isAddFlow = !editing && !template && !preset;
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [categorySource, setCategorySource] = useState<CategorySource>('none');
  const [quickAdd, setQuickAdd] = useState('');
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    createSubmittedRef.current = false;
    let draft: TransactionDraftFields | null = null;
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
      setDate(templateDate ?? todayIso());
      setDateChoice(templateDate ? dateChoiceFor(templateDate) : 'today');
      setCategorySource('user');
    } else if (preset) {
      setAmount('');
      setType(preset.type);
      setCategoryId(preset.categoryId);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
      setCategorySource('user');
    } else {
      draft = loadTransactionDraft(draftOwnerRef.current) ?? EMPTY_DRAFT;
      applyDraftFields(draft);
    }
    const templateNote = !editing && template != null && template.description !== '';
    setNoteOpen(templateNote || (draft !== null && draft.description !== ''));
    setFieldErrors({});
    setSaveError(null);
    setQuickAdd(draft?.quickAdd ?? '');
    setQuickAddError(null);
  }, [opened, editing, preset, template, templateDate]);

  useEffect(() => {
    if (!focusChipsAfterRenderRef.current) return;
    focusChipsAfterRenderRef.current = false;
    chipsRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  });

  const categoriesLoaded = categories.length > 0;
  const recalledForRef = useRef({ noteIndex, categoriesLoaded });
  useEffect(() => {
    const last = recalledForRef.current;
    if (last.noteIndex === noteIndex && last.categoriesLoaded === categoriesLoaded) return;
    recalledForRef.current = { noteIndex, categoriesLoaded };
    if (!opened || editing || categorySource === 'user' || description.trim() === '') return;

    const recalled = categoryForNote(noteIndex, description, type, categories);
    if (!recalled) return;
    setCategoryId(recalled);
    setCategorySource('memory');
  }, [noteIndex, categoriesLoaded, opened, editing, categorySource, description, type, categories]);

  const draftFields: TransactionDraftFields = { amount, type, categoryId, dateChoice, date, description, quickAdd };
  const draftKey = JSON.stringify(draftFields);
  const lastDraftKeyRef = useRef(draftKey);
  // Only a change to a field is saved. The render that opens the sheet still
  // holds the previous session's values until the effect above replaces them.
  useEffect(() => {
    if (draftKey === lastDraftKeyRef.current) return;
    lastDraftKeyRef.current = draftKey;
    if (!opened || !isAddFlow || createSubmittedRef.current) return;
    saveTransactionDraft(draftOwner, draftFields);
  }, [draftKey, opened, isAddFlow, draftOwner]);

  const eligible = categories.filter(c => categoryTypesFor(type).includes(c.type));
  const chips = topCategories(monthTransactions ?? [], categories, type, CHIP_LIMIT);

  function applyDraftFields(fields: TransactionDraftFields): void {
    setAmount(fields.amount);
    setType(fields.type);
    setCategoryId(fields.categoryId);
    setCategorySource(fields.categoryId ? 'user' : 'none');
    setDescription(fields.description);
    setDateChoice(fields.dateChoice);
    setDate(dateForChoice(fields.dateChoice, fields.date));
  }

  function handleClear(): void {
    clearTransactionDraft();
    applyDraftFields(EMPTY_DRAFT);
    setNoteOpen(false);
    setQuickAdd('');
    setQuickAddError(null);
    setFieldErrors({});
    amountRef.current?.focus();
  }

  function clearFieldError(field: ErrorField): void {
    setFieldErrors(current => (current[field] === undefined ? current : { ...current, [field]: undefined }));
  }

  function chooseDate(choice: DateChoice): void {
    setDateChoice(choice);
    clearFieldError('date');
    if (choice === 'today') setDate(todayIso());
    if (choice === 'yesterday') setDate(yesterdayIso());
  }

  function handleAmountChange(value: string): void {
    setAmount(value);
    clearFieldError('amount');
  }

  function handleDateChange(value: string | null): void {
    setDate(value ?? '');
    clearFieldError('date');
  }

  function handleCategoryChange(id: string): void {
    setCategoryId(id);
    setCategorySource('user');
    clearFieldError('category');
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
    setFieldErrors({});
    setQuickAdd('');
    setQuickAddError(null);

    if (recalled) {
      saveAnotherRef.current?.focus();
      return;
    }
    focusChipsAfterRenderRef.current = true;
  }

  function validate(): Validation {
    const parsed = parsePounds(amount);
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const categoryGone = isAddFlow && categoriesLoaded && !categories.some(c => c.categoryId === categoryId);
    const errors: FieldErrors = {};
    if (!parsed.ok) errors.amount = parsed.message;
    if (!categoryId || categoryGone) errors.category = CATEGORY_ERROR;
    if (!dateValid) errors.date = DATE_ERROR;

    if (!parsed.ok || !categoryId || categoryGone || !dateValid) return { input: null, errors };
    return { input: { amount: parsed.pence, type, categoryId, description, date }, errors };
  }

  function focusFirstError(errors: FieldErrors): void {
    if (errors.amount) {
      amountRef.current?.focus();
      return;
    }
    if (errors.category) {
      const radios = chipsRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      const target = Array.from(radios ?? []).find(radio => radio.checked) ?? radios?.[0];
      target?.focus();
      return;
    }
    if (errors.date) dateRef.current?.focus();
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
    setFieldErrors({});
    amountRef.current?.focus();
  }

  async function handleSubmit(mode: SaveMode): Promise<void> {
    const { input, errors } = validate();
    setFieldErrors(errors);
    setSaveError(null);
    if (!input) {
      focusFirstError(errors);
      return;
    }

    if (editing) {
      try {
        await update.mutateAsync({ transactionId: editing.transactionId, input });
        onClose();
      } catch (error) {
        console.error('TransactionSheet: could not update transaction', editing.transactionId, error);
        setSaveError('Could not save. Check your connection and try again.');
      }
      return;
    }

    if (createSubmittedRef.current) return;
    createSubmittedRef.current = true;
    clearTransactionDraft();
    void saveWithUndo(input, { onUndo: onUndone }).then(created => {
      if (created) onSaved?.(created);
    });
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
          onChange={e => handleAmountChange(e.currentTarget.value)}
          error={fieldErrors.amount}
          errorProps={FIELD_ERROR_PROPS}
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
            fieldError={fieldErrors.category ?? null}
          />
        </div>
        {categorySource === 'memory' && description.trim() !== '' && (
          <Text size="xs" c="dimmed" role="status">Suggested from your earlier '{description.trim()}'</Text>
        )}
        {editing ? (
          <DateInput
            label="Date"
            valueFormat="DD/MM/YYYY"
            allowDeselect
            ref={dateRef}
            value={date || null}
            onChange={handleDateChange}
            error={fieldErrors.date}
            errorProps={FIELD_ERROR_PROPS}
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
                allowDeselect
                ref={dateRef}
                value={date || null}
                onChange={handleDateChange}
                error={fieldErrors.date}
                errorProps={FIELD_ERROR_PROPS}
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
        {saveError && <Text size="sm" role="alert">{saveError}</Text>}
        <Group justify="flex-end">
          <Group gap="xs">
            {isAddFlow && !isEmptyDraft(draftFields) && (
              <Button variant="subtle" color="gray" onClick={handleClear}>Clear</Button>
            )}
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
          </Group>
          {editing ? (
            <Button type="submit" loading={update.isPending}>Save</Button>
          ) : (
            <Group gap="xs">
              <Button ref={saveAnotherRef} type="submit" variant="light">Save & add another</Button>
              <Button onClick={() => void handleSubmit('close')}>Save</Button>
            </Group>
          )}
        </Group>
      </Stack>
    </form>
  );

  const title = editing ? 'Edit transaction' : 'Add transaction';

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={title}>
      {form}
    </ResponsiveSheet>
  );
}
