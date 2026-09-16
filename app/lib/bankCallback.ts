export const BANK_CALLBACK_PATH = '/banks/callback';

const STORAGE_KEY = 'budget.bankCallback';
const MAX_MESSAGE_LENGTH = 200;
const DEFAULT_ERROR_MESSAGE = 'The bank connection was cancelled or failed.';

// TrueLayer's redirect query parameters are unconfirmed (no `code` to
// exchange — the backend resolves the connection from `state` alone via
// `completeBankCallback`). We only look for an error-style param; anything
// else is treated as "proceed to check status", not as confirmed success.
export type BankCallbackParams =
  | { kind: 'unknown' }
  | { kind: 'error'; message: string };

export interface StashedBankCallback {
  state: string;
}

export function readBankCallback(search: string): BankCallbackParams {
  const params = new URLSearchParams(search);
  if (params.get('error')) {
    const message = (params.get('error_description') ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
    return { kind: 'error', message: message || DEFAULT_ERROR_MESSAGE };
  }
  return { kind: 'unknown' };
}

export function stashBankCallback(storage: Storage, params: StashedBankCallback): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ state: params.state }));
}

// Non-destructive: React StrictMode calls state initializers twice.
export function readStashedBankCallback(storage: Storage): StashedBankCallback | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'state' in parsed && typeof parsed.state === 'string') {
      return { state: parsed.state };
    }
    return null;
  } catch {
    // A corrupted stash is ignored; the callback page shows the "start again" error.
    return null;
  }
}

export function clearStashedBankCallback(storage: Storage): void {
  storage.removeItem(STORAGE_KEY);
}

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}
