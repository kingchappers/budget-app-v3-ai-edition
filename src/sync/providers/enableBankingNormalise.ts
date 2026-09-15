import { isRecord, DATE_RE } from '../../api/body';
import { parseAmountToPence } from '../amount';
import { ProviderError } from '../errors';
import type { Direction, ProviderTransaction } from '../types';

const DESCRIPTION_MAX = 200;
const FALLBACK_DESCRIPTION = 'Bank transaction';

export function sanitiseDescription(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DESCRIPTION_MAX);
}

function partyName(value: unknown): string {
  return isRecord(value) && typeof value.name === 'string' ? value.name : '';
}

function remittanceText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((part): part is string => typeof part === 'string').join(' ');
}

function invalid(reason: string): ProviderError {
  return new ProviderError('INVALID_RESPONSE', `Enable Banking transaction ${reason}`);
}

export function normaliseEbTransaction(raw: unknown, startDate: string): ProviderTransaction | null {
  if (!isRecord(raw) || !isRecord(raw.transaction_amount)) throw invalid('is missing transaction_amount');

  const { amount, currency } = raw.transaction_amount;
  const indicator = raw.credit_debit_indicator;
  const bookingDate = typeof raw.booking_date === 'string' ? raw.booking_date : raw.value_date;

  if (typeof amount !== 'string' || typeof currency !== 'string') throw invalid('has a malformed amount');
  if (indicator !== 'CRDT' && indicator !== 'DBIT') throw invalid('has an unknown credit_debit_indicator');
  if (typeof bookingDate !== 'string' || !DATE_RE.test(bookingDate)) throw invalid('has no valid booking date');

  if (currency !== 'GBP' || bookingDate < startDate) return null;

  const amountPence = parseAmountToPence(amount.startsWith('-') ? amount.slice(1) : amount);
  if (amountPence === null) throw invalid('amount is not a decimal');
  if (amountPence === 0) return null;

  const direction: Direction = indicator === 'CRDT' ? 'IN' : 'OUT';
  const counterparty = direction === 'OUT' ? partyName(raw.creditor) : partyName(raw.debtor);
  const description = sanitiseDescription(remittanceText(raw.remittance_information))
    || sanitiseDescription(counterparty)
    || FALLBACK_DESCRIPTION;
  const entryReference = typeof raw.entry_reference === 'string' && raw.entry_reference !== ''
    ? raw.entry_reference
    : null;

  return {
    entryReference,
    amountPence,
    direction,
    bookingDate,
    description,
    currency,
    fallbackBasis: [bookingDate, amountPence, direction, description].join('|'),
  };
}
