export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export const VALID_TRANSACTION_TYPES = new Set([
  'EXPENSE', 'INCOME', 'SET_ASIDE', 'TAKE_OUT',
]);

export const VALID_CATEGORY_TYPES = new Set(['EXPENSE', 'INCOME', 'POT']);
export const VALID_CATEGORY_GROUPS = new Set(['BILLS', 'SINKING_FUNDS', 'EVERYDAY', 'SAVING_INVESTMENT']);
export const POT_GROUPS = new Set(['SINKING_FUNDS', 'SAVING_INVESTMENT']);

export const VALID_PERIODS = new Set(['MONTHLY', 'WEEKLY']);

export const MAX_AMOUNT_PENCE = 1_000_000_000;
