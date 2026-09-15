import { describe, it, expect } from 'vitest';
import { normaliseEbTransaction, sanitiseDescription } from '../providers/enableBankingNormalise';
import { ProviderError } from '../errors';

function raw(overrides: Record<string, unknown> = {}) {
  return {
    entry_reference: 'ref-1',
    transaction_amount: { amount: '12.34', currency: 'GBP' },
    credit_debit_indicator: 'DBIT',
    booking_date: '2026-09-10',
    remittance_information: ['TESCO STORES 1234'],
    creditor: { name: 'Tesco' },
    status: 'BOOK',
    ...overrides,
  };
}

describe('sanitiseDescription', () => {
  it('strips control characters, collapses whitespace and trims', () => {
    expect(sanitiseDescription('  TESCO \n  STORES\t ')).toBe('TESCO STORES');
  });

  it('caps length at 200 characters', () => {
    expect(sanitiseDescription('x'.repeat(250))).toHaveLength(200);
  });
});

describe('normaliseEbTransaction', () => {
  it('maps a debit to an OUT transaction in pence', () => {
    expect(normaliseEbTransaction(raw(), '2026-09-01')).toEqual({
      entryReference: 'ref-1',
      amountPence: 1234,
      direction: 'OUT',
      bookingDate: '2026-09-10',
      description: 'TESCO STORES 1234',
      currency: 'GBP',
      fallbackBasis: '2026-09-10|1234|OUT|TESCO STORES 1234',
    });
  });

  it('maps a credit to IN and falls back to the debtor name', () => {
    const t = normaliseEbTransaction(
      raw({ credit_debit_indicator: 'CRDT', remittance_information: [], debtor: { name: 'ACME LTD' } }),
      '2026-09-01',
    );
    expect(t).toMatchObject({ direction: 'IN', description: 'ACME LTD' });
  });

  it('uses a generic description when nothing else is available', () => {
    const t = normaliseEbTransaction(raw({ remittance_information: null, creditor: null }), '2026-09-01');
    expect(t?.description).toBe('Bank transaction');
  });

  it('treats an empty entry reference as missing', () => {
    expect(normaliseEbTransaction(raw({ entry_reference: '' }), '2026-09-01')?.entryReference).toBeNull();
  });

  it('accepts a negative amount string because direction comes from the indicator', () => {
    const t = normaliseEbTransaction(raw({ transaction_amount: { amount: '-12.34', currency: 'GBP' } }), '2026-09-01');
    expect(t?.amountPence).toBe(1234);
  });

  it('falls back to value_date when booking_date is missing', () => {
    const t = normaliseEbTransaction(raw({ booking_date: null, value_date: '2026-09-11' }), '2026-09-01');
    expect(t?.bookingDate).toBe('2026-09-11');
  });

  it('skips non-GBP transactions', () => {
    expect(normaliseEbTransaction(raw({ transaction_amount: { amount: '5.00', currency: 'EUR' } }), '2026-09-01')).toBeNull();
  });

  it('skips transactions booked before the start date', () => {
    expect(normaliseEbTransaction(raw({ booking_date: '2026-08-31' }), '2026-09-01')).toBeNull();
  });

  it('skips zero-value transactions', () => {
    expect(normaliseEbTransaction(raw({ transaction_amount: { amount: '0.00', currency: 'GBP' } }), '2026-09-01')).toBeNull();
  });

  it.each([
    ['missing amount object', { transaction_amount: undefined }],
    ['unknown indicator', { credit_debit_indicator: 'X' }],
    ['bad date', { booking_date: '10/09/2026', value_date: undefined }],
    ['non-decimal amount', { transaction_amount: { amount: '1e3', currency: 'GBP' } }],
  ])('rejects %s as an invalid response', (_label, overrides) => {
    expect(() => normaliseEbTransaction(raw(overrides), '2026-09-01')).toThrow(ProviderError);
  });
});