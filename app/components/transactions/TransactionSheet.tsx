import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Button, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { useRecentTransactions } from '~/hooks/useRecentTransactions';
import { useSaveWithUndo, type SaveHandle } from '~/hooks/useSaveWithUndo';
import { useSnapshotWhileOpen } from '~/hooks/useSnapshotWhileOpen';
import type { TransactionInput } from '~/lib/api';
import { formatPencePlain, parsePounds } from '~/lib/money';
import { dateChoiceFor, formatShortDate, todayIso, yesterdayIso, type DateChoice } from '~/lib/months';
import { buildNoteIndex, categoryForNote } from '~/lib/noteMemory';
import { MAX_PINNED_CHIPS, usePreferences, type EntryMode } from '~/lib/preferences';
import { parseQuickAdd } from '~/lib/quickAdd';
import { useCategories, useUpdateTransaction } from '~/lib/queries';
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
import type { Category, Transaction, TransactionType } from '~/lib/types';
import { CategoryChips } from './CategoryChips';

const DATE_OPTIONS: { label: string; value: DateChoice }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Other…', value: 'other' },
];

const CATEGORY_ERROR = 'Choose a category';
const DATE_ERROR = 'Enter a date, for example 27/09/2026';
const FIELD_ERROR_PROPS = { role: 'alert' };

// What a category of each type is called, for "Salary isn't a spending category."
const CATEGORY_KIND: Record<TransactionType, string> = {
  EXPENSE: 'a spending category',
  INCOME: 'an income category',
  SET_ASIDE: 'a pot',
  TAKE_OUT: 'a pot',
};

type ErrorField = 'amount' | 'category' | 'date';
type FieldErrors = Partial<Record<ErrorField, string>>;
// The one value in the "Spend · Today · No note" line that is open for editing.
type OpenField = 'type' | 'date' | 'note';

const OPEN_FIELD_NAME: Record<OpenField, string> = { type: 'Type', date: 'Date', note: 'Note' };

function dateForChoice(choice: DateChoice, date: string): string {
  if (choice === 'today') return todayIso();
  if (choice === 'yesterday') return yesterdayIso();
  return date;
}

function typeLabel(type: TransactionType): string {
  return TYPE_OPTIONS.find(option => option.value === type)?.label ?? type;
}

function dateLabel(choice: DateChoice, date: string): string {
  if (choice === 'today') return 'Today';
  if (choice === 'yesterday') return 'Yesterday';
  return date ? formatShortDate(date) : 'Pick a date';
}

function noteLabel(note: string): string {
  const trimmed = note.trim();
  if (trimmed === '') return 'No note';
  return trimmed.length > 24 ? `${trimmed.slice(0, 23)}…` : trimmed;
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
  recurringId?: string;
  onSaved?: (created: Transaction) => void;
  onUndone?: () => void;
}

export function TransactionSheet({ opened, onClose, yearMonth, editing, preset, template, templateDate, recurringId, onSaved, onUndone }: TransactionSheetProps) {
  const { data: categories = [], isLoading: categoriesLoading, error: categoriesError } = useCategories();
  // Chips and category memory both learn from the same snapshot of recent
  // transactions, taken when the sheet opens, so nothing reshuffles while it's open.
  const recent = useSnapshotWhileOpen(useRecentTransactions(opened), opened);
  const noteIndex = useMemo(() => buildNoteIndex(recent ?? []), [recent]);
  const [preferences, setPreferences] = usePreferences();
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const update = useUpdateTransaction(yearMonth);
  const saveWithUndo = useSaveWithUndo();
  const draftOwner = useAuth0().user?.sub ?? '';
  const draftOwnerRef = useRef(draftOwner);
  draftOwnerRef.current = draftOwner;
  const isAddFlow = !editing && !template && !preset;
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const createSubmittedRef = useRef(false);
  const recurringLinkUsedRef = useRef(false);
  const focusAmountAfterRenderRef = useRef(false);
  const focusSaveAfterRenderRef = useRef(false);
  const focusDateAfterRenderRef = useRef(false);

  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dateChoice, setDateChoice] = useState<DateChoice>('today');
  const [openField, setOpenField] = useState<OpenField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mode, setMode] = useState<EntryMode>('form');
  const [quickAdd, setQuickAdd] = useState('');
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  // The note the quick-add line's category was remembered from, until the user changes it.
  const [filledFromNote, setFilledFromNote] = useState<string | null>(null);
  // The last save made in this sheet, so it can be undone without the notification.
  const [lastSave, setLastSave] = useState<SaveHandle | null>(null);
  // After the first save, a one-time question about what Save should do next.
  const [askKeepOpen, setAskKeepOpen] = useState(false);

  useEffect(() => {
    if (!opened) return;
    createSubmittedRef.current = false;
    let draft: TransactionDraftFields | null = null;
    recurringLinkUsedRef.current = false;
    if (editing) {
      setAmount(formatPencePlain(editing.amount));
      setType(editing.type);
      setCategoryId(editing.categoryId);
      setDescription(editing.description);
      setDate(editing.date);
      setDateChoice(dateChoiceFor(editing.date));
    } else if (template) {
      setAmount(formatPencePlain(template.amount));
      setType(template.type);
      setCategoryId(template.categoryId);
      setDescription(template.description);
      setDate(templateDate ?? todayIso());
      setDateChoice(templateDate ? dateChoiceFor(templateDate) : 'today');
    } else if (preset) {
      setAmount('');
      setType(preset.type);
      setCategoryId(preset.categoryId);
      setDescription('');
      setDate(todayIso());
      setDateChoice('today');
    } else {
      draft = loadTransactionDraft(draftOwnerRef.current) ?? EMPTY_DRAFT;
      applyDraftFields(draft);
    }
    setOpenField(!editing && template != null && template.description !== '' ? 'note' : null);
    setFieldErrors({});
    setSaveError(null);
    setQuickAdd(draft?.quickAdd ?? '');
    setQuickAddError(null);
    setFilledFromNote(null);
    setLastSave(null);
    setAskKeepOpen(false);
    setMode(!editing && !template && !preset ? preferencesRef.current.entryMode : 'form');
  }, [opened, editing, preset, template, templateDate]);

  useEffect(() => {
    if (focusAmountAfterRenderRef.current && amountRef.current) {
      focusAmountAfterRenderRef.current = false;
      amountRef.current.focus();
    }
    if (focusSaveAfterRenderRef.current && saveRef.current) {
      focusSaveAfterRenderRef.current = false;
      saveRef.current.focus();
    }
    if (focusDateAfterRenderRef.current && dateRef.current) {
      focusDateAfterRenderRef.current = false;
      dateRef.current.focus();
    }
  });

  const categoriesLoaded = categories.length > 0;

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
  const chips = topCategories(recent ?? [], categories, type, MAX_PINNED_CHIPS, preferences.pinnedCategoryIds);

  const chosen: Category | undefined = categories.find(c => c.categoryId === categoryId);
  const categoryFitsType = chosen !== undefined && eligible.some(c => c.categoryId === chosen.categoryId);
  // Changing the type never clears the category. If it no longer fits, say so
  // next to the field and let the user choose.
  const categoryMismatch = chosen !== undefined && !categoryFitsType
    ? `${chosen.name} isn't ${CATEGORY_KIND[type]}. Choose another.`
    : null;

  // Remembered from an earlier entry with the same note. Offered, never applied,
  // and dropped once the user has chosen a category of their own.
  const suggestedId = editing || categoryFitsType ? null : categoryForNote(noteIndex, description, type, categories);
  const suggestedCategory = suggestedId === null ? undefined : categories.find(c => c.categoryId === suggestedId);

  function applyDraftFields(fields: TransactionDraftFields): void {
    setAmount(fields.amount);
    setType(fields.type);
    setCategoryId(fields.categoryId);
    setDescription(fields.description);
    setDateChoice(fields.dateChoice);
    setDate(dateForChoice(fields.dateChoice, fields.date));
  }

  function handleClear(): void {
    clearTransactionDraft();
    applyDraftFields(EMPTY_DRAFT);
    setOpenField(null);
    setQuickAdd('');
    setQuickAddError(null);
    setFilledFromNote(null);
    setFieldErrors({});
    focusAmountAfterRenderRef.current = true;
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
    if (choice !== 'other' && !editing) setOpenField(null);
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
    setFilledFromNote(null);
    clearFieldError('category');
  }

  function handleTypeChange(next: TransactionType): void {
    setType(next);
    clearFieldError('category');
    if (!editing) setOpenField(null);
  }

  function toggleField(field: OpenField): void {
    setOpenField(current => (current === field ? null : field));
  }

  function switchMode(next: EntryMode): void {
    setMode(next);
    setPreferences({ entryMode: next });
    setQuickAddError(null);
    if (next === 'form') focusAmountAfterRenderRef.current = true;
  }

  function fillFromQuickAdd(): void {
    const parsed = parseQuickAdd(quickAdd);
    if (!parsed.ok) {
      setQuickAddError(parsed.message);
      return;
    }

    // Typing a line is a deliberate request to fill the form, so a remembered
    // category is applied here, and the form says where it came from.
    const recalled = categoryForNote(noteIndex, parsed.note, parsed.type, categories);
    setAmount(formatPencePlain(parsed.amount));
    setType(parsed.type);
    setDescription(parsed.note);
    setCategoryId(recalled);
    setFilledFromNote(recalled && parsed.note !== '' ? parsed.note : null);
    setOpenField(null);
    setFieldErrors({});
    setQuickAdd('');
    setQuickAddError(null);
    // Show the filled-in form for this entry without changing the remembered mode.
    setMode('form');
    // However it was filled in, the next step is always the Save button.
    focusSaveAfterRenderRef.current = true;
  }

  function validate(): Validation {
    const parsed = parsePounds(amount);
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const categoryGone = isAddFlow && categoriesLoaded && chosen === undefined;
    const errors: FieldErrors = {};
    if (!parsed.ok) errors.amount = parsed.message;
    if (!categoryId || categoryGone) errors.category = CATEGORY_ERROR;
    else if (categoryMismatch) errors.category = categoryMismatch;
    if (!dateValid) errors.date = DATE_ERROR;

    if (!parsed.ok || errors.category || !dateValid) return { input: null, errors };
    return { input: { amount: parsed.pence, type, categoryId: categoryId as string, description, date }, errors };
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
    if (errors.date) {
      if (dateRef.current) {
        dateRef.current.focus();
        return;
      }
      // The date control is tucked away in the summary line; open it, then focus it.
      focusDateAfterRenderRef.current = true;
      setOpenField('date');
    }
  }

  function resetForNextEntry(): void {
    createSubmittedRef.current = false;
    setAmount('');
    setCategoryId(null);
    setDescription('');
    setOpenField(null);
    setQuickAdd('');
    setQuickAddError(null);
    setFilledFromNote(null);
    setFieldErrors({});
    setMode(preferencesRef.current.entryMode);
    focusAmountAfterRenderRef.current = true;
  }

  async function handleSubmit(): Promise<void> {
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
    const linked = recurringId && !recurringLinkUsedRef.current ? { ...input, recurringId } : input;
    recurringLinkUsedRef.current = true;
    setLastSave(null);
    void saveWithUndo(linked, {
      onUndo: () => {
        setLastSave(null);
        onUndone?.();
      },
      onSaveStarted: setLastSave,
    }).then(created => {
      if (created) onSaved?.(created);
    });

    const keepOpen = preferences.keepSheetOpen;
    if (keepOpen === 'ask') {
      setAskKeepOpen(true);
      return;
    }
    if (keepOpen === 'yes') {
      resetForNextEntry();
      return;
    }
    onClose();
  }

  function answerKeepOpen(keep: boolean): void {
    setPreferences({ keepSheetOpen: keep ? 'yes' : 'no' });
    setAskKeepOpen(false);
    if (keep) {
      resetForNextEntry();
      return;
    }
    onClose();
  }

  const quickActive = isAddFlow && mode === 'quick';

  const dateControls = (
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
  );

  const categoryField = (
    <>
      <div ref={chipsRef}>
        <CategoryChips
          chips={chips}
          all={eligible}
          value={categoryId}
          onChange={handleCategoryChange}
          loading={categoriesLoading}
          error={categoriesError ? "We couldn't load your categories. Nothing has been lost." : null}
          fieldError={fieldErrors.category ?? categoryMismatch}
          pinnedIds={preferences.pinnedCategoryIds}
          onPinnedChange={ids => setPreferences({ pinnedCategoryIds: ids })}
        />
      </div>
      {filledFromNote !== null && (
        <Text size="sm" role="status">Category filled in from your earlier ‘{filledFromNote}’.</Text>
      )}
      {suggestedCategory && (
        <Group gap="xs" role="status">
          <Text size="sm">You used {suggestedCategory.name} for ‘{description.trim()}’ before.</Text>
          <Button size="compact-sm" variant="light" onClick={() => handleCategoryChange(suggestedCategory.categoryId)}>
            Use {suggestedCategory.name}?
          </Button>
        </Group>
      )}
    </>
  );

  const amountField = (
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
  );

  const noteField = (
    <TextInput
      label="Note (optional)"
      value={description}
      onChange={e => setDescription(e.currentTarget.value)}
      maxLength={200}
      autoFocus={openField === 'note' && !editing}
    />
  );

  const typeControl = (
    <SegmentedControl fullWidth aria-label="Type" value={type} onChange={value => handleTypeChange(value as TransactionType)} data={TYPE_OPTIONS} />
  );

  const editFields = (
    <>
      {amountField}
      {typeControl}
      {categoryField}
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
      {noteField}
    </>
  );

  const valueButton = (field: OpenField, text: string) => (
    <Button
      variant="subtle"
      size="compact-sm"
      aria-expanded={openField === field}
      aria-label={`${OPEN_FIELD_NAME[field]}: ${text}`}
      onClick={() => toggleField(field)}
    >
      {text}
    </Button>
  );

  const addFields = (
    <>
      {amountField}
      {categoryField}
      <Group gap={2} wrap="wrap" role="group" aria-label="Type, date and note">
        {valueButton('type', typeLabel(type))}
        <Text c="dimmed" aria-hidden>·</Text>
        {valueButton('date', dateLabel(dateChoice, date))}
        <Text c="dimmed" aria-hidden>·</Text>
        {valueButton('note', noteLabel(description))}
      </Group>
      {openField === 'type' && typeControl}
      {openField === 'date' && dateControls}
      {openField === 'note' && noteField}
      {fieldErrors.date && openField !== 'date' && <Text size="sm" role="alert">{fieldErrors.date}</Text>}
      {isAddFlow && (
        <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={() => switchMode('quick')}>
          Type it instead
        </Button>
      )}
    </>
  );

  const quickFields = (
    <>
      <TextInput
        label="Quick add"
        description="e.g. coffee 3.50 · 3.50 coffee · +2400 salary (income)"
        placeholder="coffee 3.50"
        autoFocus
        value={quickAdd}
        error={quickAddError}
        onChange={e => { setQuickAdd(e.currentTarget.value); setQuickAddError(null); }}
      />
      {!preferences.quickAddTipDismissed && (
        <Group gap="xs" role="note">
          <Text size="sm">Tip: type +2400 salary for income.</Text>
          <Button variant="subtle" size="compact-sm" onClick={() => setPreferences({ quickAddTipDismissed: true })}>Got it</Button>
        </Group>
      )}
      <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={() => switchMode('form')}>
        Use the form instead
      </Button>
    </>
  );

  const undoButton = lastSave && (
    <Button variant="subtle" size="compact-sm" style={{ alignSelf: 'flex-start' }} onClick={lastSave.undo}>
      Undo last save ({lastSave.label})
    </Button>
  );

  const keepOpenQuestion = (
    <Stack>
      <Text role="status">{lastSave ? `Saved ${lastSave.label}.` : 'Saved.'}</Text>
      <Text>Keep this open for the next entry?</Text>
      <Group>
        <Button onClick={() => answerKeepOpen(true)}>Yes, keep it open</Button>
        <Button variant="default" onClick={() => answerKeepOpen(false)}>No, just close</Button>
      </Group>
      {undoButton}
    </Stack>
  );

  const form = (
    <form onSubmit={e => { e.preventDefault(); if (quickActive) fillFromQuickAdd(); else void handleSubmit(); }}>
      <Stack>
        {editing ? editFields : quickActive ? quickFields : addFields}
        {saveError && <Text size="sm" role="alert">{saveError}</Text>}
        {!editing && !quickActive && undoButton}
        <Group justify="flex-end">
          <Group gap="xs">
            {isAddFlow && !isEmptyDraft(draftFields) && (
              <Button variant="subtle" color="gray" onClick={handleClear}>Clear</Button>
            )}
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
          </Group>
          {quickActive ? (
            <Button type="submit">Fill in the form</Button>
          ) : (
            <Button ref={saveRef} type="submit" loading={editing ? update.isPending : false}>Save</Button>
          )}
        </Group>
      </Stack>
    </form>
  );

  const title = editing ? 'Edit transaction' : 'Add transaction';

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={title}>
      {askKeepOpen ? keepOpenQuestion : form}
    </ResponsiveSheet>
  );
}
