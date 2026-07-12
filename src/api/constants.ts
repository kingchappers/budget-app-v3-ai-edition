export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export const VALID_TRANSACTION_TYPES = new Set([
  'EXPENSE', 'INCOME', 'INVESTMENT_GAIN', 'INVESTMENT_LOSS',
]);

export const VALID_CATEGORY_TYPES = new Set(['EXPENSE', 'INCOME', 'INVESTMENT']);

export const VALID_PERIODS = new Set(['MONTHLY', 'WEEKLY']);
