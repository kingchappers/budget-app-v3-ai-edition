import { describe, it, expect } from 'vitest';
import { parsePounds, formatPence, formatPencePlain } from '../money';

describe('parsePounds', () => {
  it('parses whole pounds', () => {
    expect(parsePounds('4')).toEqual({ ok: true, pence: 400 });
  });

  it('parses pounds and pence', () => {
    expect(parsePounds('4.80')).toEqual({ ok: true, pence: 480 });
  });

  it('parses a single decimal place as tenths of a pound', () => {
    expect(parsePounds('4.8')).toEqual({ ok: true, pence: 480 });
  });

  it('handles a leading pound sign and surrounding whitespace', () => {
    expect(parsePounds(' £4.80 ')).toEqual({ ok: true, pence: 480 });
  });

  it('handles thousands separators', () => {
    expect(parsePounds('1,250.00')).toEqual({ ok: true, pence: 125000 });
  });

  it('avoids floating point drift', () => {
    expect(parsePounds('19.99')).toEqual({ ok: true, pence: 1999 });
    expect(parsePounds('0.07')).toEqual({ ok: true, pence: 7 });
    expect(parsePounds('1234.56')).toEqual({ ok: true, pence: 123456 });
  });

  it('rejects more than two decimal places', () => {
    const res = parsePounds('4.805');
    expect(res.ok).toBe(false);
  });

  it('rejects zero', () => {
    expect(parsePounds('0').ok).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(parsePounds('-5').ok).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(parsePounds('abc').ok).toBe(false);
    expect(parsePounds('').ok).toBe(false);
  });
});

describe('formatPence', () => {
  it('formats with a pound sign and two decimals', () => {
    expect(formatPence(480)).toBe('£4.80');
  });

  it('formats whole pounds with trailing zeros', () => {
    expect(formatPence(40000)).toBe('£400.00');
  });

  it('adds thousands separators', () => {
    expect(formatPence(125000)).toBe('£1,250.00');
  });

  it('formats zero', () => {
    expect(formatPence(0)).toBe('£0.00');
  });
});

describe('formatPencePlain', () => {
  it('formats without a currency symbol for form inputs', () => {
    expect(formatPencePlain(480)).toBe('4.80');
  });
});
