const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

export function parseAmountToPence(input: string): number | null {
  if (!DECIMAL_RE.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
