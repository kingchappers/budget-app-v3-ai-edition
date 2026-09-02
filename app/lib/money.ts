export type ParseResult =
  | { ok: true; pence: number }
  | { ok: false; message: string };

export function parsePounds(input: string): ParseResult {
  const cleaned = input.trim().replace(/^£/, '').replace(/,/g, '').trim();

  if (cleaned === '') {
    return { ok: false, message: 'Enter an amount' };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    if (/^\d+\.\d{3,}$/.test(cleaned)) {
      return { ok: false, message: 'Use at most two decimal places' };
    }
    return { ok: false, message: 'Enter a valid amount' };
  }

  const [whole, fraction = ''] = cleaned.split('.');
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (pence <= 0) {
    return { ok: false, message: 'Amount must be greater than zero' };
  }

  return { ok: true, pence };
}

const formatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

export function formatPence(pence: number): string {
  return formatter.format(pence / 100);
}

export function formatPencePlain(pence: number): string {
  return (pence / 100).toFixed(2);
}
