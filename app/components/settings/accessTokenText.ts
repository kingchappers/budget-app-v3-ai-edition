import { ApiError } from '~/lib/apiError';
import { formatShortDate, todayIso } from '~/lib/months';
import type { AccessToken, AccessTokenExpiryDays, AccessTokenScope } from '~/lib/types';

export const SCOPE_LABELS: Record<AccessTokenScope, string> = {
  read: 'Read only',
  write: 'Read and write',
};

export const EXPIRY_OPTIONS = [
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '365 days' },
  { value: '730', label: '730 days' },
  { value: 'never', label: 'Never' },
];

export const NEVER = 'never';

export function expiryDaysFor(value: string): AccessTokenExpiryDays {
  if (value === NEVER) return null;
  return Number(value) as Exclude<AccessTokenExpiryDays, null>;
}

// Epoch seconds to "14 Feb 2027", in local time.
export function formatTokenDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${formatShortDate(todayIso(date))} ${date.getFullYear()}`;
}

export function expiryText(token: AccessToken): string {
  if (token.expiresAt === null) return 'Never expires';
  return `Expires ${formatTokenDate(token.expiresAt)}`;
}

export function lastUsedText(token: AccessToken): string {
  if (token.lastUsedAt === null) return 'Never used';
  return `Last used ${formatTokenDate(token.lastUsedAt)}`;
}

const CREATE_ERRORS: Record<number, string> = {
  403: "That password wasn't right.",
  409: 'You have 25 access tokens, the most allowed. Revoke one to make room.',
  429: 'Too many attempts. Wait a little and try again.',
};

const CREATE_FAILED = "Couldn't create the token. Check your connection and try again.";

export function createErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return CREATE_FAILED;
  return CREATE_ERRORS[error.status] ?? CREATE_FAILED;
}
