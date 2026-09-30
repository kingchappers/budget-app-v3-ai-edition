import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TransactionDraftFields } from '../transactionDraft';

const KEY = 'budget.transactionDraft';

const fields: TransactionDraftFields = {
  amount: '4.80',
  type: 'EXPENSE',
  categoryId: 'cat-dining',
  dateChoice: 'other',
  date: '2026-09-27',
  description: 'Lunch',
  quickAdd: '',
};

async function freshModule(): Promise<typeof import('../transactionDraft')> {
  vi.resetModules();
  return import('../transactionDraft');
}

describe('transactionDraft', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('returns nothing when no draft was saved', async () => {
    const { loadTransactionDraft } = await freshModule();
    expect(loadTransactionDraft('user-1')).toBeNull();
  });

  it('keeps a saved draft across a page reload', async () => {
    const first = await freshModule();
    first.saveTransactionDraft('user-1', fields);

    const reloaded = await freshModule();
    expect(reloaded.loadTransactionDraft('user-1')).toEqual(fields);
  });

  it('ignores a draft saved by another user', async () => {
    const first = await freshModule();
    first.saveTransactionDraft('user-1', fields);

    const reloaded = await freshModule();
    expect(reloaded.loadTransactionDraft('user-2')).toBeNull();
  });

  it('removes the draft when cleared', async () => {
    const { saveTransactionDraft, clearTransactionDraft, loadTransactionDraft } = await freshModule();
    saveTransactionDraft('user-1', fields);
    clearTransactionDraft();
    expect(loadTransactionDraft('user-1')).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('removes the draft when an empty form is saved', async () => {
    const { saveTransactionDraft, loadTransactionDraft, EMPTY_DRAFT } = await freshModule();
    saveTransactionDraft('user-1', fields);
    saveTransactionDraft('user-1', EMPTY_DRAFT);
    expect(loadTransactionDraft('user-1')).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['an unknown type', JSON.stringify({ ...fields, owner: 'user-1', type: 'REFUND' })],
    ['an unknown date choice', JSON.stringify({ ...fields, owner: 'user-1', dateChoice: 'tomorrow' })],
    ['a malformed date', JSON.stringify({ ...fields, owner: 'user-1', date: '27/09/2026' })],
    ['an over-long note', JSON.stringify({ ...fields, owner: 'user-1', description: 'x'.repeat(201) })],
    ['a missing field', JSON.stringify({ owner: 'user-1', amount: '4.80' })],
    ['a non-object', JSON.stringify(['4.80'])],
  ])('discards a stored draft with %s', async (_label, stored) => {
    window.sessionStorage.setItem(KEY, stored);
    const { loadTransactionDraft } = await freshModule();
    expect(loadTransactionDraft('user-1')).toBeNull();
  });

  it('keeps the draft in memory when session storage cannot be written', async () => {
    const { saveTransactionDraft, loadTransactionDraft } = await freshModule();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    saveTransactionDraft('user-1', fields);
    expect(loadTransactionDraft('user-1')).toEqual(fields);
    expect(console.error).toHaveBeenCalled();
  });

  it('treats only an all-default form as empty', async () => {
    const { isEmptyDraft, EMPTY_DRAFT } = await freshModule();
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, date: '2020-01-01' })).toBe(true);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, amount: '1' })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, type: 'INCOME' })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, dateChoice: 'yesterday' })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, quickAdd: 'coffee' })).toBe(false);
  });
});
