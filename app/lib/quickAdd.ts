import { parsePounds } from './money';

export type QuickAddResult =
  | { ok: true; amount: number; note: string; type: 'EXPENSE' | 'INCOME' }
  | { ok: false; message: string };

const MAX_NOTE_LENGTH = 200;
const AMOUNT_LIKE = /^\+?£?\d[\d,]*(\.\d*)?$/;

function findAmountIndex(tokens: string[]): number {
  const last = tokens.length - 1;
  if (last < 0) return -1;
  if (AMOUNT_LIKE.test(tokens[last])) return last;
  if (AMOUNT_LIKE.test(tokens[0])) return 0;
  return -1;
}

export function parseQuickAdd(line: string): QuickAddResult {
  const tokens = line.trim().split(/\s+/).filter(token => token !== '');
  const amountIndex = findAmountIndex(tokens);
  if (amountIndex === -1) return { ok: false, message: "Couldn't find an amount" };

  const raw = tokens[amountIndex];
  const income = raw.startsWith('+');
  const parsed = parsePounds(income ? raw.slice(1) : raw);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const note = tokens.filter((_, index) => index !== amountIndex).join(' ');
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, message: 'Note is too long' };

  return { ok: true, amount: parsed.pence, note, type: income ? 'INCOME' : 'EXPENSE' };
}
