import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from '../quickAdd';

describe('parseQuickAdd', () => {
  it('reads the amount at the end', () => {
    expect(parseQuickAdd('coffee 3.50')).toEqual({ ok: true, amount: 350, note: 'coffee', type: 'EXPENSE' });
  });

  it('reads the amount at the start', () => {
    expect(parseQuickAdd('3.50 coffee')).toEqual({ ok: true, amount: 350, note: 'coffee', type: 'EXPENSE' });
  });

  it('treats a + on the amount as income', () => {
    expect(parseQuickAdd('+2400 salary')).toEqual({ ok: true, amount: 240000, note: 'salary', type: 'INCOME' });
  });

  it('treats a + before a pound sign as income', () => {
    expect(parseQuickAdd('+£2400 salary')).toEqual({ ok: true, amount: 240000, note: 'salary', type: 'INCOME' });
  });

  it('treats a + on a trailing amount as income', () => {
    expect(parseQuickAdd('salary +2400')).toEqual({ ok: true, amount: 240000, note: 'salary', type: 'INCOME' });
  });

  it('does not treat a + separated by a space as income', () => {
    expect(parseQuickAdd('salary + 2400')).toEqual({ ok: true, amount: 240000, note: 'salary +', type: 'EXPENSE' });
  });

  it('accepts pound signs and thousands separators', () => {
    expect(parseQuickAdd('rent £1,200.50')).toEqual({ ok: true, amount: 120050, note: 'rent', type: 'EXPENSE' });
  });

  it('accepts a whole-number amount with no note', () => {
    expect(parseQuickAdd('3')).toEqual({ ok: true, amount: 300, note: '', type: 'EXPENSE' });
  });

  it('collapses extra whitespace in the note', () => {
    expect(parseQuickAdd('  flat    white   3.50  ')).toEqual({ ok: true, amount: 350, note: 'flat white', type: 'EXPENSE' });
  });

  it('prefers the last amount-like token and keeps the rest as the note', () => {
    expect(parseQuickAdd('2 coffee 3.50')).toEqual({ ok: true, amount: 350, note: '2 coffee', type: 'EXPENSE' });
  });

  it('reports a missing amount', () => {
    expect(parseQuickAdd('coffee')).toEqual({ ok: false, message: "Couldn't find an amount" });
  });

  it('reports a blank line as a missing amount', () => {
    expect(parseQuickAdd('   ')).toEqual({ ok: false, message: "Couldn't find an amount" });
  });

  it('passes on the money parser message for too many decimal places', () => {
    expect(parseQuickAdd('coffee 3.505')).toEqual({ ok: false, message: 'Use at most two decimal places' });
  });

  it('rejects a zero amount', () => {
    expect(parseQuickAdd('coffee 0')).toEqual({ ok: false, message: 'Amount must be greater than zero' });
  });

  it('rejects a note over 200 characters', () => {
    expect(parseQuickAdd(`${'a'.repeat(201)} 3.50`)).toEqual({ ok: false, message: 'Note is too long' });
  });
});
