import type { DateChoice } from '~/lib/months';
import type { TransactionType } from '~/lib/types';

export const TRANSACTION_DRAFT_KEY = 'budget.transactionDraft';

const TYPES: readonly TransactionType[] = ['EXPENSE', 'INCOME', 'SET_ASIDE', 'TAKE_OUT'];
const DATE_CHOICES: readonly DateChoice[] = ['today', 'yesterday', 'other'];
const MAX_TEXT_LENGTH = 200;

export interface TransactionDraftFields {
  amount: string;
  type: TransactionType;
  categoryId: string | null;
  dateChoice: DateChoice;
  date: string;
  description: string;
  quickAdd: string;
}

interface StoredDraft extends TransactionDraftFields {
  owner: string;
}

export const EMPTY_DRAFT: TransactionDraftFields = {
  amount: '',
  type: 'EXPENSE',
  categoryId: null,
  dateChoice: 'today',
  date: '',
  description: '',
  quickAdd: '',
};

// undefined until session storage has been read; null once there is no draft.
let memory: StoredDraft | null | undefined;

export function isEmptyDraft(fields: TransactionDraftFields): boolean {
  return fields.amount === ''
    && fields.type === EMPTY_DRAFT.type
    && fields.categoryId === null
    && fields.dateChoice === EMPTY_DRAFT.dateChoice
    && fields.description === ''
    && fields.quickAdd === '';
}

function isShortText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return isShortText(draft.owner)
    && isShortText(draft.amount)
    && TYPES.includes(draft.type as TransactionType)
    && (draft.categoryId === null || isShortText(draft.categoryId))
    && DATE_CHOICES.includes(draft.dateChoice as DateChoice)
    && typeof draft.date === 'string'
    && (draft.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(draft.date))
    && isShortText(draft.description)
    && isShortText(draft.quickAdd);
}

function fieldsOf(draft: StoredDraft): TransactionDraftFields {
  const { amount, type, categoryId, dateChoice, date, description, quickAdd } = draft;
  return { amount, type, categoryId, dateChoice, date, description, quickAdd };
}

function readStored(): StoredDraft | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(TRANSACTION_DRAFT_KEY);
  } catch (error) {
    console.error('transactionDraft: could not read the saved draft', error);
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStoredDraft(parsed)) return parsed;
    console.error('transactionDraft: discarded a saved draft with an unexpected shape');
  } catch (error) {
    console.error('transactionDraft: discarded a saved draft that is not valid JSON', error);
  }
  return null;
}

function writeStored(draft: StoredDraft): void {
  try {
    window.sessionStorage.setItem(TRANSACTION_DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    console.error('transactionDraft: could not save the draft to session storage', error);
  }
}

function removeStored(): void {
  try {
    window.sessionStorage.removeItem(TRANSACTION_DRAFT_KEY);
  } catch (error) {
    console.error('transactionDraft: could not remove the draft from session storage', error);
  }
}

export function loadTransactionDraft(owner: string): TransactionDraftFields | null {
  if (memory === undefined) memory = readStored();
  if (memory === null || memory.owner !== owner) return null;
  return fieldsOf(memory);
}

export function saveTransactionDraft(owner: string, fields: TransactionDraftFields): void {
  if (isEmptyDraft(fields)) {
    clearTransactionDraft();
    return;
  }
  memory = { ...fields, owner };
  writeStored(memory);
}

export function clearTransactionDraft(): void {
  memory = null;
  removeStored();
}
